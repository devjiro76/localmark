import { resolve } from 'node:path';
import { atomicWrite, loadSettings, saveSettings, settingsPath } from './settings.js';
import { loadState, MarkdownStore } from './store.js';
import { sync } from './sync.js';
import { createCollector } from './collector/index.js';
import { platformCapabilities } from './capabilities.js';
import { configureQmd, qmdMcpConfig, qmdPaths, qmdStatus, setupQmd, updateQmdIfEnabled } from './qmd.js';
import { applyIdeaVaultMigration, planIdeaVaultMigration } from './idea-vault-migration.js';
import type { Platform } from './types.js';

const [command, ...args] = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const dataDir = resolve(option('--data') ?? process.env.LOCALMARK_DATA_DIR ?? 'data');

try {
  switch (command) {
    case 'init': {
      if (args.some(arg => !['--data', option('--data')].includes(arg))) throw new Error('init [--data PATH]');
      const store = new MarkdownStore(dataDir);
      store.initialize();
      saveSettings(dataDir, loadSettings(dataDir));
      store.saveState(loadState(dataDir));
      console.log(JSON.stringify({ dataDir, settings: settingsPath(dataDir) }, null, 2));
      break;
    }
    case 'settings': {
      const setIndex = args.indexOf('--set');
      if (setIndex >= 0) console.log(JSON.stringify(saveSettings(dataDir, JSON.parse(args[setIndex + 1] ?? '')), null, 2));
      else console.log(JSON.stringify(loadSettings(dataDir), null, 2));
      break;
    }
    case 'sync': {
      const platform = option('--platform'), browser = option('--browser');
      if (platform && !['x', 'threads'].includes(platform)) throw new Error('Invalid platform');
      if (browser && !['ego', 'chrome'].includes(browser)) throw new Error('Invalid browser');
      const dryRun = args.includes('--dry-run');
      const results = await sync(dataDir, { platform: platform as Platform | undefined, browser: browser as 'ego' | 'chrome' | undefined, dryRun, scheduled: args.includes('--scheduled') });
      if (!dryRun && results.some(result => result.created + result.updated > 0)) updateQmdIfEnabled(dataDir);
      console.log(JSON.stringify(results, null, 2));
      break;
    }
    case 'accounts': {
      const platform = option('--platform');
      if (!platform || !['x', 'threads'].includes(platform)) throw new Error('accounts --platform x|threads [--browser ego|chrome] [--data PATH]');
      const configuredBrowser = loadSettings(dataDir).platforms[platform as Platform].browser;
      const browser = option('--browser') ?? configuredBrowser;
      if (!['ego', 'chrome'].includes(browser)) throw new Error('Invalid browser');
      const account = await createCollector(browser as 'ego' | 'chrome').identify(platform as Platform);
      console.log(JSON.stringify({ platform, browser, account }, null, 2));
      break;
    }
    case 'rag': {
      if (args.includes('--print-mcp')) {
        configureQmd(dataDir);
        console.log(JSON.stringify(qmdMcpConfig(dataDir), null, 2));
      } else {
        setupQmd(dataDir);
        console.log(JSON.stringify({ dataDir, qmd: qmdPaths(dataDir) }, null, 2));
      }
      break;
    }
    case 'migrate-idea-vault': {
      const source = option('--from'), reportPath = option('--report');
      const dryRun = args.includes('--dry-run'), apply = args.includes('--apply');
      if (!source || dryRun === apply) throw new Error('migrate-idea-vault --from VAULT_SQLITE (--dry-run | --apply) [--data PATH] [--report PATH]');
      if (reportPath && resolve(reportPath) === resolve(source)) throw new Error('Report path must not overwrite the source database');
      const report = dryRun ? planIdeaVaultMigration(source, dataDir) : applyIdeaVaultMigration(source, dataDir);
      if (reportPath) atomicWrite(resolve(reportPath), JSON.stringify(report, null, 2) + '\n');
      console.log(JSON.stringify({ ...report, reportPath: reportPath ? resolve(reportPath) : null }, null, 2));
      break;
    }
    case 'status': {
      console.log(JSON.stringify({ dataDir, settings: loadSettings(dataDir), state: loadState(dataDir), capabilities: platformCapabilities, qmd: qmdStatus(dataDir) }, null, 2));
      break;
    }
    default:
      console.log('Localmark — collect X and Threads posts as Obsidian-compatible Markdown\n');
      console.log('Usage:');
      console.log('  yarn cli init [--data PATH]');
      console.log('  yarn cli settings [--data PATH] [--set JSON]');
      console.log('  yarn cli sync [--data PATH] [--platform x|threads] [--browser ego|chrome] [--dry-run] [--scheduled]');
      console.log('  yarn cli accounts --platform x|threads [--browser ego|chrome] [--data PATH]');
      console.log('  yarn cli rag [--data PATH] [--print-mcp]');
      console.log('  yarn cli migrate-idea-vault --from VAULT_SQLITE (--dry-run | --apply) [--data PATH] [--report PATH]');
      console.log('  yarn cli status [--data PATH]');
      if (command) process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Localmark command failed');
  process.exitCode = 1;
}
