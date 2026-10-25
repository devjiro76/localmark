import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { planIdeaVaultMigration } from '../src/idea-vault-migration.js';
import { emptyState, MarkdownStore } from '../src/store.js';

test('idea-vault dry-run counts conversion, duplicates, gaps, and preserved data without writes', t => {
  const root = mkdtempSync(join(tmpdir(), 'localmark-migration-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'idea-vault.sqlite'), target = join(root, 'target');
  const db = new DatabaseSync(source);
  db.exec(`
    CREATE TABLE records(url TEXT PRIMARY KEY, summary TEXT NOT NULL, raw TEXT NOT NULL, published_at TEXT);
    CREATE TABLE source_observations(url TEXT, text TEXT, text_sha256 TEXT, provenance TEXT);
    CREATE TABLE observations(hash TEXT);
    CREATE TABLE relations(source TEXT);
    CREATE TABLE collector_extras(url TEXT);
  `);
  const record = db.prepare('INSERT INTO records VALUES(?,?,?,?)');
  const observation = db.prepare('INSERT INTO source_observations VALUES(?,?,?,?)');
  const add = (url: string, summary: string, raw: object, publishedAt: string | null = '2026-10-24T00:00:00.000Z') => {
    record.run(url, summary, JSON.stringify(raw), publishedAt);
  };
  add('https://x.com/writer/status/1', 'observed', { reactions: [{ reaction: 'save', account: 'owner' }, { reaction: 'like', account: 'owner' }] });
  observation.run('https://x.com/writer/status/1', 'Original body', 'a'.repeat(64), '{}');
  add('https://twitter.com/writer/status/1', 'duplicate', { membership_keys: ['owner|saved|X:1'] });
  observation.run('https://twitter.com/writer/status/1', 'Original body', 'a'.repeat(64), '{}');
  add('https://www.threads.com/@writer/post/abc', 'summary', { root_text: 'Threads body', reactions: [{ surface: 'reposts', account: 'u1' }] }, null);
  add('https://x.com/writer/status/2', 'Summary only', { membership_keys: [] });
  add('https://x.com/writer/status/3', '', {});
  add('https://example.com/note', 'Note', { source_type: 'keep_summary' });
  db.prepare('INSERT INTO observations VALUES(?)').run('historical');
  db.prepare('INSERT INTO relations VALUES(?)').run('source');
  db.prepare('INSERT INTO collector_extras VALUES(?)').run('https://x.com/writer/status/1');
  db.close();

  const state = emptyState();
  state.documents['x:1'] = { path: 'posts/x/2026/10/1.md', contentHash: 'old', reactions: ['save'] };
  new MarkdownStore(target).saveState(state);
  const sourceBefore = readFileSync(source), targetBefore = readdirSync(target, { recursive: true });
  const report = planIdeaVaultMigration(source, target, new Date('2026-10-24T09:00:00.000Z'));

  assert.equal(report.source.records, 6);
  assert.deepEqual(report.totals, {
    socialRecords: 5,
    convertibleRecords: 4,
    unconvertibleRecords: 1,
    uniqueConvertibleDocuments: 3,
    duplicateSourceRecords: 1,
    existingTargetDocuments: 1,
    newDocuments: 2,
    recordsNeedingReview: 3,
    unsupportedRecords: 1,
  });
  assert.deepEqual(report.textSources, {
    observed_text: 2,
    collector_item_text: 0,
    embedded_observation: 0,
    root_text: 1,
    summary_fallback: 1,
    missing: 1,
  });
  assert.deepEqual(report.collectionReactions, { like: 1, save: 2, repost: 1 });
  assert.deepEqual(report.platforms.x, {
    records: 4,
    convertibleRecords: 3,
    uniqueDocuments: 2,
    duplicateSourceRecords: 1,
    existingTargetDocuments: 1,
    newDocuments: 1,
  });
  assert.deepEqual(report.preservation, {
    sourceObservations: 2,
    historicalObservations: 1,
    collectorExtras: 1,
    relations: 1,
    nonSocialRecords: 1,
    policy: 'archive-original-json-without-treating-analysis-as-source-text',
  });
  assert.deepEqual(report.samples.missingText, ['https://x.com/writer/status/3']);
  assert.deepEqual(report.samples.summaryOnly, ['https://x.com/writer/status/2']);
  assert.deepEqual(report.samples.duplicateSource, ['x:1: https://x.com/writer/status/1, https://twitter.com/writer/status/1']);
  assert.deepEqual(report.samples.unsupportedRecord, ['https://example.com/note']);
  assert.deepEqual(report.writes, { sourceDatabase: false, targetVault: false, markdown: false });
  assert.deepEqual(readFileSync(source), sourceBefore);
  assert.deepEqual(readdirSync(target, { recursive: true }), targetBefore);
});
