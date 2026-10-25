import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { applyIdeaVaultMigration } from '../src/idea-vault-migration.js';
import { loadState } from '../src/store.js';
import { loadSettings } from '../src/settings.js';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

test('idea-vault apply creates only a new vault and preserves merged metadata and raw archives', t => {
  const root = mkdtempSync(join(tmpdir(), 'localmark-migration-apply-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'idea-vault.sqlite'), target = join(root, 'new-vault');
  const db = new DatabaseSync(source);
  db.exec(`
    CREATE TABLE records(url TEXT PRIMARY KEY, summary TEXT NOT NULL, raw TEXT NOT NULL, published_at TEXT, first_seen TEXT, reaction_at TEXT, imported_at TEXT NOT NULL, eligible INTEGER NOT NULL);
    CREATE TABLE source_observations(hash TEXT PRIMARY KEY, url TEXT NOT NULL, text TEXT NOT NULL, text_sha256 TEXT NOT NULL, provenance TEXT NOT NULL);
    CREATE TABLE observations(hash TEXT PRIMARY KEY, url TEXT, raw TEXT);
    CREATE TABLE relations(source TEXT, target TEXT, kind TEXT, quote TEXT, status TEXT);
    CREATE TABLE collector_extras(url TEXT NOT NULL, kind TEXT NOT NULL, json TEXT NOT NULL, origin TEXT NOT NULL, json_hash TEXT NOT NULL);
  `);
  const record = db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?,?,?)');
  const add = (url: string, summary: string, raw: object, publishedAt: string | null = '2026-10-24T00:00:00.000Z') => {
    record.run(url, summary, JSON.stringify(raw), publishedAt, null, null, '2026-10-24T01:00:00.000Z', 0);
  };
  const chosen = 'Chosen original', stale = 'A longer but stale observation that must not win';
  add('https://x.com/writer/status/1', chosen, {
    author_name: 'Writer', source_text_sha256: sha256(chosen),
    reactions: [{ reaction: 'save', account: 'owner' }, { reaction: 'like', account: 'owner' }],
  });
  add('https://twitter.com/writer/status/1', 'Duplicate summary', { membership_keys: ['owner|saved|X:1'] });
  add('https://www.threads.com/@writer/post/abc', 'Threads summary', {
    root_text: 'Threads body', reactions: [{ surface: 'reposts', account: 'u1' }],
  }, null);
  add('https://x.com/writer/status/2', 'Summary only', {});
  add('https://x.com/writer/status/3', '', {});
  add('https://example.com/note', 'Note', { source_type: 'keep_summary' });
  const observation = db.prepare('INSERT INTO source_observations VALUES(?,?,?,?,?)');
  observation.run('a', 'https://x.com/writer/status/1', chosen, sha256(chosen), JSON.stringify({ observed_scope: 'rendered_body_partial' }));
  observation.run('b', 'https://x.com/writer/status/1', stale, sha256(stale), '{}');
  db.prepare('INSERT INTO observations VALUES(?,?,?)').run('history', 'https://x.com/writer/status/1', '{}');
  db.prepare('INSERT INTO relations VALUES(?,?,?,?,?)').run('a', 'b', 'related', '', 'active');
  db.prepare('INSERT INTO collector_extras VALUES(?,?,?,?,?)').run('https://x.com/writer/status/1', 'asset', '{}', 'test', 'c');
  db.close();

  const sourceBefore = readFileSync(source);
  const report = applyIdeaVaultMigration(source, target, new Date('2026-10-24T09:00:00.000Z'));
  assert.deepEqual(report.totals, {
    socialRecords: 5,
    createdDocuments: 3,
    updatedDocuments: 0,
    unchangedDocuments: 0,
    duplicateSourceRecords: 1,
    missingTextRecords: 1,
    unsupportedRecords: 1,
    documentsByPlatform: { x: 2, threads: 1 },
  });
  assert.deepEqual(report.warnings, {
    summaryFallbackDocuments: 1,
    missingReactionDocuments: 1,
    missingPublishedAtDocuments: 1,
    multipleSourceVersionDocuments: 1,
  });
  assert.equal(report.rawArchive.records, 6);
  assert.equal(report.rawArchive.sourceObservations, 2);
  assert.equal(report.rawArchive.historicalObservations, 1);
  assert.equal(report.rawArchive.relations, 1);
  assert.equal(report.rawArchive.collectorExtras, 1);
  assert.deepEqual(readFileSync(source), sourceBefore);
  assert.equal(loadSettings(target).autoSync, false);

  const state = loadState(target);
  assert.equal(Object.keys(state.documents).length, 3);
  const x1 = readFileSync(join(target, state.documents['x:1']!.path), 'utf8');
  assert.match(x1, /Chosen original/);
  assert.doesNotMatch(x1, /stale observation/);
  assert.match(x1, /  - like\n  - save/);
  assert.match(x1, /migrated_from: "idea-vault"/);
  assert.match(x1, /migration_text_source: "observed_text"/);
  assert.match(x1, new RegExp(`source_observation_sha256: "${sha256(chosen)}"`));

  const threads = readFileSync(join(target, state.documents['threads:abc']!.path), 'utf8');
  assert.match(threads, /collector_account: "u1"/);
  assert.match(threads, /  - repost/);
  assert.match(threads, /published_at: ""/);
  assert.match(threads, /observation_scope: "legacy_root_text"/);

  const summary = readFileSync(join(target, state.documents['x:2']!.path), 'utf8');
  assert.match(summary, /collected_as: \[\]/);
  assert.match(summary, /observation_scope: "summary_only_unverified"/);
  assert.match(summary, /Summary only/);

  const archive = JSON.parse(readFileSync(join(target, report.rawArchive.path), 'utf8'));
  assert.equal(archive.records.length, 6);
  assert.equal(archive.source_observations.length, 2);
  assert.equal(archive.observations.length, 1);
  assert.equal(archive.relations.length, 1);
  assert.equal(archive.collector_extras.length, 1);
  assert.throws(() => applyIdeaVaultMigration(source, target), /new or empty/);
  assert.equal(readdirSync(root).filter(name => name.includes('.migration-')).length, 0);
});
