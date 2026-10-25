import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { emptyState, loadState, MarkdownStore } from './store.js';
import { atomicWrite, defaultSettings, saveSettings } from './settings.js';
import type { CollectedPost, Platform, Reaction } from './types.js';

interface IdeaRecord {
  url: string;
  summary: string;
  raw: string;
  published_at: string | null;
}

interface SourceObservation {
  url: string;
  text: string;
  text_sha256: string;
  provenance: string;
}

interface ParsedPostUrl {
  platform: Platform;
  id: string;
  key: string;
  authorHandle: string;
}

type TextSource = 'observed_text' | 'collector_item_text' | 'embedded_observation' | 'root_text' | 'summary_fallback' | 'missing';

interface PlannedRecord {
  record: IdeaRecord;
  post: ParsedPostUrl;
  raw: Record<string, unknown>;
  textSource: TextSource;
  reactions: Set<Reaction>;
  sourceVersionCount: number;
  reviewReasons: string[];
}

const platforms: Platform[] = ['x', 'threads'];
const reactions: Reaction[] = ['like', 'save', 'repost'];
const sampleLimit = 10;

function emptyPlatformCount() {
  return { records: 0, convertibleRecords: 0, uniqueDocuments: 0, duplicateSourceRecords: 0, existingTargetDocuments: 0, newDocuments: 0 };
}

function parsePostUrl(value: string): ParsedPostUrl | null {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase().replace(/^(www|mobile)\./, '');
    if (['x.com', 'twitter.com'].includes(host)) {
      const match = url.pathname.match(/^\/([^/]+)\/status\/(\d+)(?:\/|$)/);
      if (!match) return null;
      return { platform: 'x', id: match[2]!, key: `x:${match[2]}`, authorHandle: decodeURIComponent(match[1]!).replace(/^@/, '') };
    }
    if (['threads.com', 'threads.net'].includes(host)) {
      const match = url.pathname.match(/^\/@([^/]+)\/post\/([A-Za-z0-9_-]+)(?:\/|$)/);
      if (!match) return null;
      const handle = decodeURIComponent(match[1]!), id = match[2]!;
      return { platform: 'threads', id, key: `threads:${id}`, authorHandle: handle };
    }
    return null;
  } catch {
    return null;
  }
}

function parseRaw(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function objectValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function textValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function reactionValue(value: unknown): Reaction | null {
  if (value === 'like' || value === 'likes') return 'like';
  if (value === 'save' || value === 'saved' || value === 'bookmarks') return 'save';
  if (value === 'repost' || value === 'reposts') return 'repost';
  return null;
}

function collectReactions(raw: Record<string, unknown>) {
  const found = new Set<Reaction>();
  if (Array.isArray(raw.reactions)) {
    for (const entry of raw.reactions) {
      const value = objectValue(entry);
      const reaction = reactionValue(value?.reaction) ?? reactionValue(value?.surface);
      if (reaction) found.add(reaction);
    }
  }
  if (Array.isArray(raw.membership_keys)) {
    for (const entry of raw.membership_keys) {
      if (typeof entry !== 'string') continue;
      const reaction = reactionValue(entry.split('|')[1]);
      if (reaction) found.add(reaction);
    }
  }
  return found;
}

function scalarCount(db: DatabaseSync, table: 'records' | 'source_observations' | 'observations' | 'relations' | 'collector_extras') {
  return Number(db.prepare(`SELECT count(*) AS count FROM ${table}`).get()!.count);
}

function addSample(samples: Record<string, string[]>, reason: string, url: string) {
  const list = samples[reason] ??= [];
  if (list.length < sampleLimit) list.push(url);
}

export function planIdeaVaultMigration(sourcePath: string, dataDir: string, now = new Date()) {
  const absoluteSource = resolve(sourcePath);
  const db = new DatabaseSync(absoluteSource, { readOnly: true });
  let report;
  try {
    db.exec('PRAGMA query_only = ON');
    db.exec('BEGIN TRANSACTION');
    const records = db.prepare('SELECT url, summary, raw, published_at FROM records').all() as unknown as IdeaRecord[];
    const sourceObservations = db.prepare('SELECT url, text, text_sha256, provenance FROM source_observations').all() as unknown as SourceObservation[];
    const preservation = {
      sourceObservations: scalarCount(db, 'source_observations'),
      historicalObservations: scalarCount(db, 'observations'),
      collectorExtras: scalarCount(db, 'collector_extras'),
      relations: scalarCount(db, 'relations'),
    };
    const observationsByUrl = new Map<string, SourceObservation[]>();
    for (const observation of sourceObservations) {
      if (!observation.text.trim()) continue;
      const list = observationsByUrl.get(observation.url) ?? [];
      list.push(observation);
      observationsByUrl.set(observation.url, list);
    }

    const state = loadState(dataDir), targetKeys = new Set(Object.keys(state.documents));
    const planned: PlannedRecord[] = [], unsupported: IdeaRecord[] = [];
    const textSources = Object.fromEntries(['observed_text', 'collector_item_text', 'embedded_observation', 'root_text', 'summary_fallback', 'missing'].map(key => [key, 0])) as Record<TextSource, number>;
    const collectionReactions = Object.fromEntries(reactions.map(key => [key, 0])) as Record<Reaction, number>;
    const warningCounts = { missingText: 0, summaryOnly: 0, missingReaction: 0, missingPublishedAt: 0, invalidPublishedAt: 0, multipleSourceVersions: 0, invalidRaw: 0 };
    const samples: Record<string, string[]> = {};

    for (const record of records) {
      const post = parsePostUrl(record.url);
      if (!post) {
        unsupported.push(record);
        continue;
      }
      const raw = parseRaw(record.raw);
      if (!Object.keys(raw).length && record.raw.trim() !== '{}') {
        warningCounts.invalidRaw++;
        addSample(samples, 'invalidRaw', record.url);
      }
      const observed = observationsByUrl.get(record.url) ?? [];
      const collectorText = textValue(objectValue(raw.collector_item)?.text);
      const embeddedText = textValue(objectValue(raw.source_observation)?.text);
      const rootText = textValue(raw.root_text);
      const summary = textValue(record.summary);
      const textSource: TextSource = observed.length ? 'observed_text'
        : collectorText ? 'collector_item_text'
          : embeddedText ? 'embedded_observation'
            : rootText ? 'root_text'
              : summary ? 'summary_fallback' : 'missing';
      textSources[textSource]++;
      const foundReactions = collectReactions(raw);
      for (const reaction of foundReactions) collectionReactions[reaction]++;
      const reviewReasons: string[] = [];
      if (textSource === 'missing') {
        warningCounts.missingText++;
        reviewReasons.push('missingText');
        addSample(samples, 'missingText', record.url);
      }
      if (textSource === 'summary_fallback') {
        warningCounts.summaryOnly++;
        reviewReasons.push('summaryOnly');
        addSample(samples, 'summaryOnly', record.url);
      }
      if (!foundReactions.size) {
        warningCounts.missingReaction++;
        reviewReasons.push('missingReaction');
        addSample(samples, 'missingReaction', record.url);
      }
      if (!record.published_at) {
        warningCounts.missingPublishedAt++;
        reviewReasons.push('missingPublishedAt');
        addSample(samples, 'missingPublishedAt', record.url);
      } else if (!Number.isFinite(Date.parse(record.published_at))) {
        warningCounts.invalidPublishedAt++;
        reviewReasons.push('invalidPublishedAt');
        addSample(samples, 'invalidPublishedAt', record.url);
      }
      if (observed.length > 1) {
        warningCounts.multipleSourceVersions++;
        reviewReasons.push('multipleSourceVersions');
        addSample(samples, 'multipleSourceVersions', record.url);
      }
      planned.push({ record, post, raw, textSource, reactions: foundReactions, sourceVersionCount: observed.length, reviewReasons });
    }

    const byPlatform = Object.fromEntries(platforms.map(platform => [platform, emptyPlatformCount()])) as Record<Platform, ReturnType<typeof emptyPlatformCount>>;
    const uniqueSocial = new Map<string, PlannedRecord[]>();
    for (const item of planned) {
      const list = uniqueSocial.get(item.post.key) ?? [];
      list.push(item);
      uniqueSocial.set(item.post.key, list);
      byPlatform[item.post.platform].records++;
      if (item.textSource !== 'missing') byPlatform[item.post.platform].convertibleRecords++;
    }
    for (const [key, items] of uniqueSocial) {
      if (items.length > 1) addSample(samples, 'duplicateSource', `${key}: ${items.map(item => item.record.url).join(', ')}`);
    }
    const convertibleKeys = new Set(planned.filter(item => item.textSource !== 'missing').map(item => item.post.key));
    for (const platform of platforms) {
      const platformItems = planned.filter(item => item.post.platform === platform);
      const keys = new Set(platformItems.map(item => item.post.key));
      const usableKeys = new Set(platformItems.filter(item => item.textSource !== 'missing').map(item => item.post.key));
      byPlatform[platform].uniqueDocuments = usableKeys.size;
      byPlatform[platform].duplicateSourceRecords = platformItems.length - keys.size;
      byPlatform[platform].existingTargetDocuments = [...usableKeys].filter(key => targetKeys.has(key)).length;
      byPlatform[platform].newDocuments = [...usableKeys].filter(key => !targetKeys.has(key)).length;
    }
    const unsupportedBySourceType: Record<string, number> = {};
    for (const item of unsupported) {
      const sourceType = parseRaw(item.raw).source_type;
      const key = typeof sourceType === 'string' && sourceType ? sourceType : 'unknown';
      unsupportedBySourceType[key] = (unsupportedBySourceType[key] ?? 0) + 1;
      addSample(samples, 'unsupportedRecord', item.url);
    }
    const duplicateSourceRecords = planned.length - uniqueSocial.size;
    const existingTargetDocuments = [...convertibleKeys].filter(key => targetKeys.has(key)).length;

    report = {
      schema: 'localmark-idea-vault-dry-run-v1',
      mode: 'dry-run',
      generatedAt: now.toISOString(),
      source: { path: absoluteSource, records: records.length },
      target: { dataDir: resolve(dataDir), existingStateDocuments: targetKeys.size },
      totals: {
        socialRecords: planned.length,
        convertibleRecords: planned.filter(item => item.textSource !== 'missing').length,
        unconvertibleRecords: planned.filter(item => item.textSource === 'missing').length,
        uniqueConvertibleDocuments: convertibleKeys.size,
        duplicateSourceRecords,
        existingTargetDocuments,
        newDocuments: convertibleKeys.size - existingTargetDocuments,
        recordsNeedingReview: planned.filter(item => item.reviewReasons.length > 0).length,
        unsupportedRecords: unsupported.length,
      },
      platforms: byPlatform,
      textSources,
      collectionReactions,
      warnings: warningCounts,
      preservation: { ...preservation, nonSocialRecords: unsupported.length, policy: 'archive-original-json-without-treating-analysis-as-source-text' },
      unsupportedBySourceType,
      samples,
      writes: { sourceDatabase: false, targetVault: false, markdown: false },
    };
    db.exec('COMMIT');
  } finally {
    db.close();
  }
  return report;
}

interface MigrationCandidate {
  record: IdeaRecord;
  post: ParsedPostUrl;
  raw: Record<string, unknown>;
  text: string;
  textSource: Exclude<TextSource, 'missing'>;
  observationScope: string;
  sourceObservationSha256?: string;
  sourceVersionCount: number;
  matchRank: number;
}

const textSourceRank: Record<MigrationCandidate['textSource'], number> = {
  observed_text: 5,
  collector_item_text: 4,
  embedded_observation: 4,
  root_text: 3,
  summary_fallback: 2,
};

function validDate(value: unknown) {
  return typeof value === 'string' && value && Number.isFinite(Date.parse(value)) ? value : null;
}

function sourceScope(raw: Record<string, unknown>, observation?: SourceObservation) {
  const provenance = observation ? parseRaw(observation.provenance) : null;
  return textValue(provenance?.observed_scope) ?? textValue(objectValue(raw.read_scope)?.root_body) ?? 'observed_text';
}

function selectObservation(record: IdeaRecord, raw: Record<string, unknown>, observations: SourceObservation[]) {
  const expectedHash = textValue(raw.source_text_sha256), summaryHash = createHash('sha256').update(record.summary).digest('hex');
  return [...observations].sort((a, b) => {
    const aMatch = a.text_sha256 === expectedHash ? 2 : a.text_sha256 === summaryHash ? 1 : 0;
    const bMatch = b.text_sha256 === expectedHash ? 2 : b.text_sha256 === summaryHash ? 1 : 0;
    return bMatch - aMatch || b.text.length - a.text.length || a.text_sha256.localeCompare(b.text_sha256);
  }).map(observation => ({
    observation,
    matchRank: observation.text_sha256 === expectedHash ? 2 : observation.text_sha256 === summaryHash ? 1 : 0,
  }))[0];
}

function migrationCandidate(record: IdeaRecord, post: ParsedPostUrl, observations: SourceObservation[]): MigrationCandidate | null {
  const raw = parseRaw(record.raw), selected = selectObservation(record, raw, observations);
  if (selected) return {
    record, post, raw, text: selected.observation.text, textSource: 'observed_text',
    observationScope: sourceScope(raw, selected.observation), sourceObservationSha256: selected.observation.text_sha256,
    sourceVersionCount: observations.length, matchRank: selected.matchRank,
  };
  const collectorText = textValue(objectValue(raw.collector_item)?.text);
  if (collectorText) return { record, post, raw, text: collectorText, textSource: 'collector_item_text', observationScope: 'collector_item_text', sourceVersionCount: 0, matchRank: 0 };
  const embeddedText = textValue(objectValue(raw.source_observation)?.text);
  if (embeddedText) return { record, post, raw, text: embeddedText, textSource: 'embedded_observation', observationScope: 'embedded_observation', sourceVersionCount: 0, matchRank: 0 };
  const rootText = textValue(raw.root_text);
  if (rootText) return { record, post, raw, text: rootText, textSource: 'root_text', observationScope: 'legacy_root_text', sourceVersionCount: 0, matchRank: 0 };
  const summary = textValue(record.summary);
  if (summary) return { record, post, raw, text: summary, textSource: 'summary_fallback', observationScope: 'summary_only_unverified', sourceVersionCount: 0, matchRank: 0 };
  return null;
}

function preferCandidate(a: MigrationCandidate, b: MigrationCandidate) {
  const sourceDifference = textSourceRank[b.textSource] - textSourceRank[a.textSource];
  if (sourceDifference) return sourceDifference;
  const matchDifference = b.matchRank - a.matchRank;
  if (matchDifference) return matchDifference;
  const dateDifference = Number(Boolean(validDate(b.record.published_at))) - Number(Boolean(validDate(a.record.published_at)));
  return dateDifference || b.text.length - a.text.length || a.record.url.localeCompare(b.record.url);
}

function migrationAccounts(candidate: MigrationCandidate) {
  const accounts = new Set<string>();
  const add = (value: unknown) => {
    const account = textValue(value);
    if (!account) return;
    accounts.add(account);
  };
  if (Array.isArray(candidate.raw.reactions)) for (const entry of candidate.raw.reactions) add(objectValue(entry)?.account);
  if (Array.isArray(candidate.raw.membership_keys)) for (const entry of candidate.raw.membership_keys) {
    if (typeof entry === 'string') add(entry.split('|')[0]);
  }
  add(candidate.raw.account);
  add(candidate.raw.browser_account);
  return accounts;
}

function candidateAuthorName(candidate: MigrationCandidate) {
  const collector = objectValue(candidate.raw.collector_item), author = objectValue(candidate.raw.author);
  return textValue(candidate.raw.author_name) ?? textValue(collector?.author_name)
    ?? textValue(candidate.raw.author) ?? textValue(author?.name);
}

function candidateHandle(candidate: MigrationCandidate) {
  const collector = objectValue(candidate.raw.collector_item);
  return (textValue(candidate.raw.author_handle) ?? textValue(collector?.author_handle) ?? candidate.post.authorHandle).replace(/^@/, '');
}

function canonicalPostUrl(candidate: MigrationCandidate, handle: string) {
  return candidate.post.platform === 'x'
    ? `https://x.com/${handle}/status/${candidate.post.id}`
    : `https://www.threads.com/@${handle}/post/${candidate.post.id}`;
}

export function applyIdeaVaultMigration(sourcePath: string, dataDir: string, now = new Date()) {
  const absoluteSource = resolve(sourcePath), target = resolve(dataDir);
  const targetExisted = existsSync(target);
  if (targetExisted && (!statSync(target).isDirectory() || readdirSync(target).length > 0)) {
    throw new Error('Target vault must be a new or empty directory');
  }

  const db = new DatabaseSync(absoluteSource, { readOnly: true });
  let records: IdeaRecord[], sourceObservations: SourceObservation[];
  let historicalObservations: Record<string, unknown>[], relations: Record<string, unknown>[], collectorExtras: Record<string, unknown>[];
  try {
    db.exec('PRAGMA query_only = ON');
    db.exec('BEGIN TRANSACTION');
    records = db.prepare('SELECT * FROM records').all() as unknown as IdeaRecord[];
    sourceObservations = db.prepare('SELECT * FROM source_observations').all() as unknown as SourceObservation[];
    historicalObservations = db.prepare('SELECT * FROM observations').all() as unknown as Record<string, unknown>[];
    relations = db.prepare('SELECT * FROM relations').all() as unknown as Record<string, unknown>[];
    collectorExtras = db.prepare('SELECT * FROM collector_extras').all() as unknown as Record<string, unknown>[];
    db.exec('COMMIT');
  } finally {
    db.close();
  }

  const observationsByUrl = new Map<string, SourceObservation[]>();
  for (const observation of sourceObservations) {
    if (!observation.text.trim()) continue;
    const list = observationsByUrl.get(observation.url) ?? [];
    list.push(observation);
    observationsByUrl.set(observation.url, list);
  }
  const groups = new Map<string, MigrationCandidate[]>(), socialKeys = new Set<string>();
  let socialRecords = 0, unsupportedRecords = 0, missingTextRecords = 0;
  for (const record of records) {
    const post = parsePostUrl(record.url);
    if (!post) {
      unsupportedRecords++;
      continue;
    }
    socialRecords++;
    socialKeys.add(post.key);
    const candidate = migrationCandidate(record, post, observationsByUrl.get(record.url) ?? []);
    if (!candidate) {
      missingTextRecords++;
      continue;
    }
    const list = groups.get(post.key) ?? [];
    list.push(candidate);
    groups.set(post.key, list);
  }

  const posts: CollectedPost[] = [];
  for (const candidates of groups.values()) {
    const selected = [...candidates].sort(preferCandidate)[0]!;
    const all = [selected, ...candidates.filter(candidate => candidate !== selected)];
    const handle = candidateHandle(selected);
    const reactions = [...new Set(all.flatMap(candidate => [...collectReactions(candidate.raw)]))].sort() as Reaction[];
    const accounts = [...new Set(all.flatMap(candidate => [...migrationAccounts(candidate)]))].sort();
    const authorName = all.map(candidateAuthorName).find((value): value is string => Boolean(value)) ?? null;
    const postedAt = all.map(candidate => validDate(candidate.record.published_at) ?? validDate(candidate.raw.published_at)).find((value): value is string => Boolean(value)) ?? null;
    posts.push({
      platform: selected.post.platform,
      id: selected.post.id,
      sourceUrl: canonicalPostUrl(selected, handle),
      authorHandle: handle,
      authorName,
      text: selected.text,
      postedAt,
      reaction: null,
      collectedAs: reactions,
      collectorAccount: accounts[0] ?? '',
      collectorAccounts: accounts,
      observationScope: selected.observationScope,
      migration: {
        source: 'idea-vault',
        textSource: selected.textSource,
        ...(selected.sourceObservationSha256 ? { sourceObservationSha256: selected.sourceObservationSha256 } : {}),
      },
    });
  }
  posts.sort((a, b) => `${a.platform}:${a.id}`.localeCompare(`${b.platform}:${b.id}`));

  const staging = join(dirname(target), `.${basename(target)}.migration-${process.pid}-${Date.now()}`);
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  try {
    const store = new MarkdownStore(staging), state = emptyState();
    store.initialize();
    saveSettings(staging, defaultSettings());
    const counts = store.save(posts, state, now);
    store.saveState(state);

    const archive = {
      schema: 'localmark-idea-vault-archive-v1',
      migratedAt: now.toISOString(),
      source: absoluteSource,
      records,
      source_observations: sourceObservations,
      observations: historicalObservations,
      relations,
      collector_extras: collectorExtras,
    };
    const archiveJson = JSON.stringify(archive, null, 2) + '\n';
    const archiveSha256 = createHash('sha256').update(archiveJson).digest('hex');
    const archiveRelativePath = `raw/${archiveSha256}.json`;
    writeFileSync(join(staging, archiveRelativePath), archiveJson, { flag: 'wx', mode: 0o400 });

    const documentsByPlatform = Object.fromEntries(platforms.map(platform => [platform, posts.filter(post => post.platform === platform).length]));
    const report = {
      schema: 'localmark-idea-vault-apply-v1',
      mode: 'apply',
      migratedAt: now.toISOString(),
      source: { path: absoluteSource, records: records.length },
      target: { dataDir: target },
      totals: {
        socialRecords,
        createdDocuments: counts.created,
        updatedDocuments: counts.updated,
        unchangedDocuments: counts.unchanged,
        duplicateSourceRecords: socialRecords - socialKeys.size,
        missingTextRecords,
        unsupportedRecords,
        documentsByPlatform,
      },
      warnings: {
        summaryFallbackDocuments: posts.filter(post => post.migration?.textSource === 'summary_fallback').length,
        missingReactionDocuments: posts.filter(post => !post.collectedAs?.length).length,
        missingPublishedAtDocuments: posts.filter(post => !post.postedAt).length,
        multipleSourceVersionDocuments: [...groups.values()].filter(candidates => candidates.reduce((sum, candidate) => sum + candidate.sourceVersionCount, 0) > 1).length,
      },
      rawArchive: {
        path: archiveRelativePath,
        sha256: archiveSha256,
        bytes: Buffer.byteLength(archiveJson),
        records: records.length,
        sourceObservations: sourceObservations.length,
        historicalObservations: historicalObservations.length,
        relations: relations.length,
        collectorExtras: collectorExtras.length,
      },
      writes: { sourceDatabase: false, targetVault: true, markdown: true },
    };
    atomicWrite(join(staging, '.localmark', 'migration.json'), JSON.stringify(report, null, 2) + '\n');
    if (targetExisted) rmdirSync(target);
    renameSync(staging, target);
    return report;
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}
