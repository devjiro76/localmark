import { loadSettings, saveSettings } from './settings.js';
import { loadState, MarkdownStore } from './store.js';
import { createCollector } from './collector/index.js';
import type { Browser, Collector, Platform, SyncResult } from './types.js';

export async function sync(dataDir: string, options: { platform?: Platform; browser?: Browser; dryRun?: boolean; scheduled?: boolean; collector?: Collector } = {}) {
  const settings = loadSettings(dataDir), state = loadState(dataDir), store = new MarkdownStore(dataDir);
  const results: SyncResult[] = [];
  for (const platform of ['x', 'threads'] as const) {
    if (options.platform && options.platform !== platform) continue;
    const platformSettings = settings.platforms[platform];
    if (!platformSettings.enabled || !Object.values(platformSettings.surfaces).some(Boolean)) continue;
    const collector = options.collector ?? createCollector(options.browser ?? platformSettings.browser);
    const lastSuccess = state.platforms[platform]?.lastSuccess;
    if (options.scheduled && lastSuccess && Date.now() - Date.parse(lastSuccess) < platformSettings.intervalSeconds * 1000) continue;
    try {
      const posts = await collector.collect(platform, platformSettings);
      const account = posts[0]?.collectorAccount
        ?? ('detectedAccounts' in collector ? (collector.detectedAccounts as Partial<Record<Platform, string>>)[platform] : undefined)
        ?? platformSettings.account;
      if (!options.dryRun) {
        const counts = store.save(posts, state);
        if (account && account !== platformSettings.account) {
          platformSettings.account = account;
          saveSettings(dataDir, settings);
        }
        state.platforms[platform] = { lastSuccess: new Date().toISOString(), lastError: null };
        store.saveState(state);
        results.push({ platform, discovered: posts.length, account, ...counts });
      } else {
        results.push({ platform, discovered: posts.length, account, created: 0, updated: 0, unchanged: 0 });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown collection error';
      if (!options.dryRun) {
        state.platforms[platform] = { lastSuccess: state.platforms[platform]?.lastSuccess ?? null, lastError: message };
        store.saveState(state);
      }
      results.push({ platform, discovered: 0, account: platformSettings.account, created: 0, updated: 0, unchanged: 0 });
      console.error(`${platform}: ${message}`);
      process.exitCode = 1;
    }
  }
  return results;
}
