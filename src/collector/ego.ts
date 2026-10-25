import { spawn } from 'node:child_process';
import type { CollectedPost, Collector, Platform, PlatformSettings } from '../types.js';
import { assembleThread } from '../thread.js';

const MARKER = 'LOCALMARK_JSON:';

function runProcess(code: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn('ego-browser', ['nodejs', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Browser collection timed out')); }, 240000);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(new Error(`ego-browser is unavailable: ${error.message}`)); });
    child.on('close', exitCode => {
      clearTimeout(timer);
      const lines = (stdout + '\n' + stderr).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').split(/\r?\n/).reverse();
      for (const line of lines) {
        const offset = line.lastIndexOf(MARKER);
        if (offset < 0) continue;
        try { return resolve(JSON.parse(line.slice(offset + MARKER.length))); } catch { /* try an earlier complete marker */ }
      }
      reject(new Error(exitCode ? `Browser collection failed (${exitCode})` : 'Browser returned no collection result'));
    });
  });
}

const wrap = (body: string) => body;

const egoWrap = (body: string) => String.raw`
const sleep = ms => new Promise(r => setTimeout(r, ms));
const emit = value => console.log('${MARKER}' + JSON.stringify(value));
const task = await taskSpace('localmark-' + Date.now());
const page = task.page('p1');
try {${body}} finally { try { await task.finish({keep: []}); } catch {} }`;

const identityScript = (platform: Platform) => wrap(platform === 'x' ? String.raw`
await page.goto('https://x.com/home'); await sleep(4000);
emit({handle: await page.evaluate(() => document.querySelector('a[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href')?.replace(/^\//, '') || null)});` : String.raw`
await page.goto('https://www.threads.com/'); await sleep(4000);
emit({handle: await page.evaluate(() => { const a = [...document.querySelectorAll('a[href^="/@"]')].find(a => /^(프로필|Profile)/i.test((a.innerText || '').trim())); return a ? a.getAttribute('href').slice(2).split('/')[0] : null; })});`);

const SCROLL_LOOP = String.raw`
const items = new Map(); let idle = 0;
for (let round = 0; round < ROUNDS && idle < 3; round++) {
  let added = 0;
  for (const item of await page.evaluate(EXTRACT)) {
    if (!items.has(item.id)) { items.set(item.id, item); added++; }
  }
  idle = added ? 0 : idle + 1;
  await page.evaluate(() => window.scrollBy(0, 1400)); await sleep(1300);
}`;

const xScript = (surface: string) => wrap(String.raw`
const ROUNDS = 30;
const EXTRACT = () => [...document.querySelectorAll('article')].map(article => {
  const link = article.querySelector('time')?.closest('a');
  const match = link?.getAttribute('href')?.match(/^\/([^/]+)\/status\/(\d+)/);
  if (!match) return null;
  const quoteBox = article.querySelector('div[role="link"]');
  const texts = [...article.querySelectorAll('[data-testid="tweetText"]')];
  const own = texts.find(element => !quoteBox?.contains(element));
  const quote = texts.find(element => quoteBox?.contains(element));
  return {
    id: match[2], authorHandle: match[1],
    authorName: article.querySelector('[data-testid="User-Name"]')?.innerText.split('\n')[0] || null,
    sourceUrl: 'https://x.com/' + match[1] + '/status/' + match[2],
    postedAt: article.querySelector('time')?.getAttribute('datetime') || null,
    text: own?.innerText || '',
    quoted: quote ? {authorHandle: (quoteBox.querySelector('[data-testid="User-Name"]')?.innerText.match(/@(\w+)/) || [])[1] || null, text: quote.innerText} : undefined
  };
}).filter(Boolean);
await page.goto(${JSON.stringify(surface === 'likes' ? 'LIKES_URL' : 'https://x.com/i/bookmarks')}); await sleep(4500);
if (/login|onboarding|logout/.test(await page.url())) { emit({error:'reauth_required'}); } else {
  ${SCROLL_LOOP}
  emit({items:[...items.values()]});
}`);

const threadsScript = (surface: string, account: string) => wrap(String.raw`
const ROUNDS = 12;
const EXTRACT = () => [...document.querySelectorAll('div[data-pressable-container="true"]')].map(container => {
  const link = [...container.querySelectorAll('a[href*="/post/"]')].find(a => /^\/@[^/]+\/post\/[\w-]+/.test(a.getAttribute('href')));
  if (!link) return null;
  const match = link.getAttribute('href').match(/^\/@([^/]+)\/post\/([\w-]+)/);
  return {id:match[2], authorHandle:match[1], authorName:null,
    sourceUrl:'https://www.threads.com/@' + match[1] + '/post/' + match[2],
    postedAt:container.querySelector('time')?.getAttribute('datetime') || null, raw:container.innerText};
}).filter(Boolean);
const surface = ${JSON.stringify(surface)};
const urls = {
  saved: 'https://www.threads.com/saved',
  likes: 'https://www.threads.com/liked',
  reposts: 'https://www.threads.com/@' + ${JSON.stringify(account)} + '/reposts'
};
await page.goto(urls[surface]); await sleep(4500);
${SCROLL_LOOP}
const route = await page.evaluate(() => ({path:location.pathname,title:document.title,body:document.body.innerText}));
const matched = surface === 'saved'
  ? route.path.startsWith('/saved') && route.title.includes('저장됨')
  : surface === 'likes'
    ? route.path.startsWith('/liked') && route.title.includes('좋아요')
    : route.path.includes('/reposts');
const empty = /저장한 게시물이 여기에 표시됩니다|리포스트한 게시물이 여기에 표시됩니다|좋아요한 게시물이 여기에 표시됩니다|아직 저장한 게시물이 없습니다|아직 리포스트가 없습니다|아직 좋아요한 게시물이 없습니다/.test(route.body);
if (!matched || !empty && !items.size) { emit({error:'ui_drift'}); } else { emit({items:[...items.values()]}); }
`);

const THREAD_VISIT_LOOP = (platform: Platform) => String.raw`
const platform = ${JSON.stringify(platform)};
const threads = {};
for (const target of targets) {
  try {
    await page.goto(target.sourceUrl); await sleep(2500);
    const initial = await page.evaluate(EXTRACT);
    const focalIndex = initial.findIndex(entry => entry.id === target.id);
    if (focalIndex < 0) { threads[target.id] = []; continue; }
    const handle = initial[focalIndex].authorHandle;
    const sameAuthor = entry => entry.authorHandle?.toLowerCase() === handle?.toLowerCase();
    const selfChain = (entries, index) => {
      const chain = [];
      for (let at = index; at >= 0 && sameAuthor(entries[at]); at--) chain.unshift(entries[at]);
      return chain;
    };
    const connected = new Map(selfChain(initial, focalIndex).map(entry => [entry.id, entry]));
    const queue = initial.slice(focalIndex + 1).filter(sameAuthor);
    const queued = new Set(queue.map(entry => entry.id));
    let visits = 0;
    while (queue.length && visits++ < 40) {
      const candidate = queue.shift();
      if (connected.has(candidate.id)) continue;
      const url = platform === 'x'
        ? 'https://x.com/' + candidate.authorHandle + '/status/' + candidate.id
        : 'https://www.threads.com/@' + candidate.authorHandle + '/post/' + candidate.id;
      await page.goto(url); await sleep(1200);
      const detail = await page.evaluate(EXTRACT);
      const index = detail.findIndex(entry => entry.id === candidate.id);
      if (index < 0) continue;
      const chain = selfChain(detail, index);
      if (!chain.some(entry => connected.has(entry.id))) continue;
      for (const entry of chain) connected.set(entry.id, entry);
      for (const entry of detail.slice(index + 1)) {
        if (sameAuthor(entry) && !queued.has(entry.id)) { queue.push(entry); queued.add(entry.id); }
      }
    }
    threads[target.id] = [...connected.values()].sort((a, b) => {
      const at = Date.parse(a.postedAt || ''), bt = Date.parse(b.postedAt || '');
      return Number.isFinite(at) && Number.isFinite(bt) ? at - bt : 0;
    });
  } catch { threads[target.id] = []; }
}
emit({threads});`;

const xThreadScript = (targets: { id: string; sourceUrl: string }[]) => wrap(String.raw`
const targets = ${JSON.stringify(targets)};
const EXTRACT = () => [...document.querySelectorAll('article')].map(article => {
  const link = article.querySelector('time')?.closest('a');
  const match = link?.getAttribute('href')?.match(/^\/([^/]+)\/status\/(\d+)/);
  if (!match) return null;
  const quoteBox = article.querySelector('div[role="link"]');
  const texts = [...article.querySelectorAll('[data-testid="tweetText"]')];
  const own = texts.find(element => !quoteBox?.contains(element));
  return {id:match[2], authorHandle:match[1], postedAt:article.querySelector('time')?.getAttribute('datetime') || null, text:own?.innerText || ''};
}).filter(Boolean);
${THREAD_VISIT_LOOP('x')}`);

const threadsThreadScript = (targets: { id: string; sourceUrl: string }[]) => wrap(String.raw`
const targets = ${JSON.stringify(targets)};
const EXTRACT = () => [...document.querySelectorAll('div[data-pressable-container="true"]')].map(container => {
  const link = [...container.querySelectorAll('a[href*="/post/"]')].find(a => /^\/@[^/]+\/post\/[\w-]+/.test(a.getAttribute('href')));
  if (!link) return null;
  const match = link.getAttribute('href').match(/^\/@([^/]+)\/post\/([\w-]+)/);
  return {id:match[2], authorHandle:match[1], postedAt:container.querySelector('time')?.getAttribute('datetime') || null, raw:container.innerText};
}).filter(Boolean);
${THREAD_VISIT_LOOP('threads')}`);

type BodyRunner = (body: string) => Promise<any>;

async function expandThreads(platform: Platform, posts: CollectedPost[], run: BodyRunner) {
  const targets = posts.filter(post => post.authorHandle);
  // Candidate replies require extra detail visits, so keep each browser run small.
  for (let offset = 0; offset < targets.length; offset += 5) {
    const batch = targets.slice(offset, offset + 5);
    let result: any;
    try {
      result = await run(platform === 'x' ? xThreadScript(batch) : threadsThreadScript(batch));
    } catch { continue; } // thread expansion is best-effort and must not fail collection
    for (const post of batch) {
      const entries = result?.threads?.[post.id];
      if (!Array.isArray(entries)) continue;
      const cleaned = entries.map((entry: any) => ({
        id: String(entry.id ?? ''),
        authorHandle: entry.authorHandle ?? null,
        postedAt: entry.postedAt ?? null,
        text: platform === 'threads' ? cleanThreadsBlock(entry.authorHandle ?? '', entry.raw ?? '') : entry.text ?? '',
      }));
      const thread = assembleThread(cleaned, { id: post.id, authorHandle: post.authorHandle!, platform });
      if (thread) post.thread = thread;
    }
  }
}

function cleanThreadsBlock(handle: string, raw: string) {
  const date = /^(\d{4}-\d{2}-\d{2}|\d+\s*(분|시간|일|주)|방금)$/;
  const lines = raw.split('\n').map(line => line.trim()).filter(Boolean);
  const at = lines.slice(0, 4).findIndex(line => date.test(line));
  if (at >= 0 && lines.slice(0, at).every(line => line.length <= 40)) lines.splice(0, at + 1);
  else if (lines[0]?.toLowerCase() === handle.toLowerCase()) lines.shift();
  while (lines.length && /^([\d.,]+[KMkm천만]?|·|작성자|번역 보기)$/.test(lines[lines.length - 1]!)) lines.pop();
  return lines.join('\n');
}

export class DomCollector implements Collector {
  readonly detectedAccounts: Partial<Record<Platform, string>> = {};

  constructor(private readonly run: BodyRunner, private readonly browserLabel: string) {}

  async identify(platform: Platform): Promise<string> {
    const identity = await this.run(identityScript(platform));
    if (!identity.handle) throw new Error(`${platform}: login required in ${this.browserLabel}`);
    this.detectedAccounts[platform] = identity.handle;
    return identity.handle;
  }

  async collect(platform: Platform, settings: PlatformSettings): Promise<CollectedPost[]> {
    const account = await this.identify(platform);
    if (settings.account && account !== settings.account) throw new Error(`${platform}: expected @${settings.account}, found @${account}`);
    const requestedLimit = Number(process.env.LOCALMARK_MAX_POSTS);
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? requestedLimit : undefined;
    const posts: CollectedPost[] = [];
    for (const [surface, enabled] of Object.entries(settings.surfaces)) {
      if (!enabled) continue;
      const script = platform === 'x'
        ? xScript(surface).replace('LIKES_URL', `https://x.com/${account}/likes`)
        : threadsScript(surface, account);
      const result = await this.run(script);
      if (result.error) throw new Error(`${platform}/${surface}: ${result.error}`);
      if (!Array.isArray(result.items)) throw new Error(`${platform}/${surface}: invalid browser result`);
      const surfacePosts: CollectedPost[] = [];
      const items = limit ? result.items.slice(0, limit) : result.items;
      for (const item of items) {
        const text = platform === 'threads' ? cleanThreadsBlock(item.authorHandle ?? '', item.raw ?? '') : item.text;
        if (!item.id || !item.sourceUrl || typeof text !== 'string') throw new Error(`${platform}/${surface}: ui_drift`);
        surfacePosts.push({
          platform, id: String(item.id), sourceUrl: item.sourceUrl,
          authorHandle: item.authorHandle ?? null, authorName: item.authorName ?? null,
          text, postedAt: item.postedAt ?? null,
          reaction: surface === 'likes' ? 'like' : surface === 'reposts' ? 'repost' : 'save',
          collectorAccount: account, quoted: item.quoted,
        });
      }
      await expandThreads(platform, surfacePosts, this.run);
      posts.push(...surfacePosts);
    }
    return posts;
  }
}

export class EgoCollector extends DomCollector {
  constructor() {
    super(body => runProcess(egoWrap(body)), 'ego lite');
  }
}
