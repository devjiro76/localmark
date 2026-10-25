import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MARKER = 'LOCALMARK_JSON:';
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => (...args: any[]) => Promise<any>;

type CdpTarget = { id: string; webSocketDebuggerUrl: string };
type CdpResult = { result?: any; exceptionDetails?: any; errorText?: string };

function chromeExecutable() {
  const candidates = [
    process.env.LOCALMARK_CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    join(homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
  ].filter((value): value is string => Boolean(value));
  const executable = candidates.find(path => existsSync(path));
  if (!executable) throw new Error('Google Chrome을 찾을 수 없습니다. Chrome을 설치하거나 LOCALMARK_CHROME_BIN을 지정하세요.');
  return executable;
}

function chromePort() {
  const value = Number(process.env.LOCALMARK_CHROME_PORT ?? 9222);
  if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new Error('LOCALMARK_CHROME_PORT는 1024–65535 사이의 정수여야 합니다.');
  return value;
}

async function cdpRequest<T>(port: number, path: string, method = 'GET'): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Chrome DevTools 요청 실패 (${response.status})`);
  return await response.json() as T;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function ensureChrome(port: number) {
  try {
    await cdpRequest(port, '/json/version');
    return;
  } catch { /* Launch the dedicated Localmark profile below. */ }

  const profile = process.env.LOCALMARK_CHROME_PROFILE
    ?? join(homedir(), 'Library', 'Application Support', 'Localmark', 'chrome-profile');
  mkdirSync(profile, { recursive: true, mode: 0o700 });
  const child = spawn(chromeExecutable(), [
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-session-crashed-bubble',
    '--hide-crash-restore-bubble',
    'about:blank',
  ], { detached: true, stdio: 'ignore' });
  child.unref();

  for (let attempt = 0; attempt < 75; attempt++) {
    await sleep(200);
    try {
      await cdpRequest(port, '/json/version');
      return;
    } catch { /* Chrome is still starting. */ }
  }
  throw new Error('Chrome 수집 프로필을 시작하지 못했습니다. 해당 Chrome 창을 닫은 뒤 다시 시도하세요.');
}

class CdpSocket {
  private nextId = 0;
  private readonly pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (typeof message.id !== 'number') return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message ?? 'Chrome DevTools 명령 실패'));
      else pending.resolve(message.result);
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Chrome DevTools 연결이 종료되었습니다.'));
      }
      this.pending.clear();
    });
  }

  static async connect(url: string) {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Chrome DevTools 연결 시간 초과')), 10000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Chrome DevTools에 연결하지 못했습니다.')); }, { once: true });
    });
    return new CdpSocket(socket);
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Chrome DevTools 명령 시간 초과: ${method}`));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() { this.socket.close(); }
}

class ChromePage {
  private constructor(private readonly cdp: CdpSocket) {}

  static async create(cdp: CdpSocket) {
    const page = new ChromePage(cdp);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    return page;
  }

  async goto(url: string) {
    const result = await this.cdp.send('Page.navigate', { url }) as CdpResult;
    if (result.errorText) throw new Error(`Chrome 페이지 이동 실패: ${result.errorText}`);
  }

  async evaluate(fn: () => any) {
    const response = await this.cdp.send('Runtime.evaluate', {
      expression: `(${fn.toString()})()`,
      awaitPromise: true,
      returnByValue: true,
    }) as CdpResult;
    if (response.exceptionDetails) {
      const description = response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? '페이지 평가 실패';
      throw new Error(description);
    }
    return response.result?.value;
  }

  async url() { return await this.evaluate(() => location.href) as string; }
}

export async function runChromeBody(body: string) {
  const port = chromePort();
  await ensureChrome(port);
  const target = await cdpRequest<CdpTarget>(port, `/json/new?${encodeURIComponent('about:blank')}`, 'PUT');
  const cdp = await CdpSocket.connect(target.webSocketDebuggerUrl);
  let keepOpenForLogin = false;
  const emit = (value: unknown) => {
    if (value && typeof value === 'object' && (('handle' in value && value.handle === null) || ('error' in value && value.error === 'reauth_required'))) keepOpenForLogin = true;
    console.log(MARKER + JSON.stringify(value));
  };
  try {
    const page = await ChromePage.create(cdp);
    const task = new AsyncFunction('page', 'emit', 'sleep', body);
    await task(page, emit, sleep);
  } finally {
    cdp.close();
    if (!keepOpenForLogin) {
      try { await cdpRequest(port, `/json/close/${target.id}`); } catch { /* Best-effort tab cleanup. */ }
    }
  }
}
