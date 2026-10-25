import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { configureQmd, qmdIndexPath, qmdStatus } from '../src/qmd.js';
import { atomicWrite } from '../src/settings.js';

const temporaryVault = () => mkdtempSync(join(tmpdir(), 'localmark-qmd-status-'));

test('QMD status reports not installed, disabled and unindexed on a fresh vault', t => {
  const dataDir = temporaryVault();
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  assert.deepEqual(qmdStatus(dataDir, () => false), {
    installed: false, enabled: false, indexed: false, available: false,
  });
});

test('QMD status becomes available only when binary, config and index all exist', t => {
  const dataDir = temporaryVault();
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  configureQmd(dataDir);
  assert.deepEqual(qmdStatus(dataDir, () => true), {
    installed: true, enabled: true, indexed: false, available: false,
  });
  atomicWrite(qmdIndexPath(dataDir), 'index');
  assert.deepEqual(qmdStatus(dataDir, () => true), {
    installed: true, enabled: true, indexed: true, available: true,
  });
});

test('QMD status stays unavailable without a runnable binary even with an index', t => {
  const dataDir = temporaryVault();
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  configureQmd(dataDir);
  atomicWrite(qmdIndexPath(dataDir), 'index');
  assert.deepEqual(qmdStatus(dataDir, () => false), {
    installed: false, enabled: true, indexed: true, available: false,
  });
});
