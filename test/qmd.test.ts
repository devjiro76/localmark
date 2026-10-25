import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  QMD_MULTILINGUAL_EMBED_MODEL,
  configureQmd,
  isQmdEnabled,
  qmdEnvironment,
  qmdMcpConfig,
  qmdPaths,
  setupQmd,
  updateQmdIfEnabled,
} from '../src/qmd.js';

const temporaryVault = () => join(mkdtempSync(join(tmpdir(), 'localmark-qmd-')), "vault'one");

test('QMD config stays inside the selected vault and escapes YAML paths', t => {
  const dataDir = temporaryVault();
  t.after(() => rmSync(dirnameForCleanup(dataDir), { recursive: true, force: true }));
  const paths = configureQmd(dataDir);
  const config = readFileSync(paths.configPath, 'utf8');
  assert.equal(isQmdEnabled(dataDir), true);
  assert.ok(paths.configPath.startsWith(join(dataDir, '.localmark')));
  assert.match(config, /path: '.*vault''one'/);
  assert.match(config, /pattern: '\*\*\/\*\.md'/);
  assert.match(config, /Qwen3-Embedding-0\.6B/);
});

test('QMD setup updates the Markdown index and embeddings', t => {
  const dataDir = temporaryVault();
  t.after(() => rmSync(dirnameForCleanup(dataDir), { recursive: true, force: true }));
  const calls: string[][] = [];
  setupQmd(dataDir, args => { calls.push(args); return ''; });
  assert.deepEqual(calls, [['update'], ['embed']]);
  assert.deepEqual(qmdEnvironment(dataDir), {
    QMD_CONFIG_DIR: qmdPaths(dataDir).configDir,
    XDG_CACHE_HOME: qmdPaths(dataDir).cacheDir,
    QMD_EMBED_MODEL: QMD_MULTILINGUAL_EMBED_MODEL,
  });
});

test('QMD auto-update is opt-in and does nothing before setup', t => {
  const dataDir = temporaryVault();
  t.after(() => rmSync(dirnameForCleanup(dataDir), { recursive: true, force: true }));
  let count = 0;
  assert.equal(updateQmdIfEnabled(dataDir, () => { count += 1; return ''; }), false);
  assert.equal(count, 0);
  configureQmd(dataDir);
  assert.equal(updateQmdIfEnabled(dataDir, () => { count += 1; return ''; }), true);
  assert.equal(count, 2);
});

test('MCP config reuses the same isolated index and multilingual model', t => {
  const dataDir = temporaryVault();
  t.after(() => rmSync(dirnameForCleanup(dataDir), { recursive: true, force: true }));
  assert.deepEqual(qmdMcpConfig(dataDir), {
    mcpServers: {
      localmark: {
        command: 'qmd',
        args: ['mcp'],
        env: qmdEnvironment(dataDir),
      },
    },
  });
});

function dirnameForCleanup(dataDir: string) {
  return dataDir.slice(0, -"/vault'one".length);
}
