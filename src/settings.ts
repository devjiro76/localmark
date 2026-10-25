import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { LocalmarkSettings, Platform, PlatformSettings } from './types.js';

export const MIN_INTERVAL_SECONDS = 300;
export const MAX_INTERVAL_SECONDS = 604800;

export function defaultSettings(): LocalmarkSettings {
  return {
    version: 1,
    autoSync: false,
    platforms: {
      x: { enabled: true, account: '', browser: 'ego', intervalSeconds: 21600, surfaces: { bookmarks: true, likes: false } },
      threads: { enabled: true, account: '', browser: 'ego', intervalSeconds: 21600, surfaces: { saved: true, reposts: true, likes: false } },
    },
  };
}

export function settingsPath(dataDir: string) { return join(dataDir, 'settings.json'); }
export function statePath(dataDir: string) { return join(dataDir, '.localmark', 'state.json'); }

export function atomicWrite(path: string, content: string, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, content, { encoding: 'utf8', mode });
  renameSync(temp, path);
}

function validatePlatform(value: PlatformSettings, platform: Platform) {
  const allowed = platform === 'x' ? ['bookmarks', 'likes'] : ['saved', 'reposts', 'likes'];
  if (typeof value.enabled !== 'boolean' || typeof value.account !== 'string' || !['ego', 'chrome'].includes(value.browser)
    || !Number.isSafeInteger(value.intervalSeconds) || value.intervalSeconds < MIN_INTERVAL_SECONDS
    || value.intervalSeconds > MAX_INTERVAL_SECONDS || !value.surfaces || typeof value.surfaces !== 'object') {
    throw new Error(`Invalid ${platform} settings`);
  }
  for (const key of allowed) if (typeof value.surfaces[key] !== 'boolean') throw new Error(`Invalid ${platform} surface: ${key}`);
  if (!/^[A-Za-z0-9_]*$/.test(value.account)) throw new Error(`Invalid ${platform} account`);
}

export function parseSettings(input: unknown): LocalmarkSettings {
  if (!input || typeof input !== 'object') throw new Error('Invalid settings');
  const value = input as LocalmarkSettings;
  if (value.version !== 1 || typeof value.autoSync !== 'boolean' || !value.platforms) throw new Error('Invalid settings');
  for (const platform of ['x', 'threads'] as const) validatePlatform(value.platforms[platform], platform);
  return value;
}

export function loadSettings(dataDir: string): LocalmarkSettings {
  const path = settingsPath(dataDir);
  if (!existsSync(path)) return defaultSettings();
  return parseSettings(JSON.parse(readFileSync(path, 'utf8')));
}

export function saveSettings(dataDir: string, input: unknown) {
  const settings = parseSettings(input);
  atomicWrite(settingsPath(dataDir), JSON.stringify(settings, null, 2) + '\n');
  return settings;
}
