import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { defaultSettings, loadSettings, saveSettings } from '../src/settings.js';

test('settings default to manual sync with independent platforms', () => {
  const settings = defaultSettings();
  assert.equal(settings.autoSync, false);
  assert.notEqual(settings.platforms.x, settings.platforms.threads);
  assert.equal(settings.platforms.x.surfaces.bookmarks, true);
  assert.equal(settings.platforms.threads.surfaces.reposts, true);
});

test('settings round-trip and accept Threads likes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'localmark-settings-'));
  saveSettings(dir, defaultSettings());
  assert.deepEqual(loadSettings(dir), defaultSettings());
  const enabled = defaultSettings();
  enabled.platforms.threads.surfaces.likes = true;
  enabled.platforms.threads.browser = 'chrome';
  saveSettings(dir, enabled);
  assert.equal(loadSettings(dir).platforms.threads.surfaces.likes, true);
  assert.equal(loadSettings(dir).platforms.threads.browser, 'chrome');
});
