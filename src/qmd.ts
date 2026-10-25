import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { atomicWrite } from './settings.js';

export const QMD_MULTILINGUAL_EMBED_MODEL = 'hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf';

export type QmdRunner = (args: string[], env: NodeJS.ProcessEnv) => string;

export function qmdPaths(dataDir: string) {
  const root = join(dataDir, '.localmark', 'qmd');
  const configDir = join(root, 'config');
  const cacheDir = join(root, 'cache');
  return { root, configDir, cacheDir, configPath: join(configDir, 'index.yml') };
}

export function qmdEnvironment(dataDir: string): NodeJS.ProcessEnv {
  const paths = qmdPaths(dataDir);
  return {
    QMD_CONFIG_DIR: paths.configDir,
    XDG_CACHE_HOME: paths.cacheDir,
    QMD_EMBED_MODEL: QMD_MULTILINGUAL_EMBED_MODEL,
  };
}

const yamlString = (value: string) => `'${value.replaceAll("'", "''")}'`;

export function configureQmd(dataDir: string) {
  const paths = qmdPaths(dataDir);
  const config = `models:\n  embed: ${yamlString(QMD_MULTILINGUAL_EMBED_MODEL)}\ncollections:\n  localmark:\n    path: ${yamlString(dataDir)}\n    pattern: '**/*.md'\n    ignore:\n      - '.localmark/**'\n      - 'raw/**'\n    context:\n      '/': 'Social posts saved from X and Threads. YAML metadata includes author, source URL, platform, and publication time.'\n      '/annotations': 'User-created notes connected to the collected posts.'\n`;
  atomicWrite(paths.configPath, config);
  return paths;
}

export function isQmdEnabled(dataDir: string) {
  return existsSync(qmdPaths(dataDir).configPath);
}

export interface QmdStatus {
  installed: boolean;
  enabled: boolean;
  indexed: boolean;
  available: boolean;
}

export function qmdIndexPath(dataDir: string) {
  return join(qmdPaths(dataDir).cacheDir, 'qmd', 'index.sqlite');
}

export function qmdBinaryAvailable(): boolean {
  const result = spawnSync(process.env.LOCALMARK_QMD_BIN ?? 'qmd', ['--version'], { encoding: 'utf8', timeout: 5000 });
  return !result.error && result.status === 0;
}

export function qmdStatus(dataDir: string, probe: () => boolean = qmdBinaryAvailable): QmdStatus {
  const installed = probe();
  const enabled = isQmdEnabled(dataDir);
  const indexed = existsSync(qmdIndexPath(dataDir));
  return { installed, enabled, indexed, available: installed && enabled && indexed };
}

const spawnQmd: QmdRunner = (args, environment) => {
  const result = spawnSync(process.env.LOCALMARK_QMD_BIN ?? 'qmd', args, {
    env: { ...process.env, ...environment },
    encoding: 'utf8',
  });
  if (result.error) {
    if ('code' in result.error && result.error.code === 'ENOENT') {
      throw new Error('QMD를 찾을 수 없습니다. npm install -g @tobilu/qmd 로 설치하거나 LOCALMARK_QMD_BIN을 지정하세요.');
    }
    throw result.error;
  }
  if (result.status !== 0) throw new Error(result.stderr.trim() || `QMD exited with status ${result.status}`);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.stdout;
};

export function updateQmd(dataDir: string, runner: QmdRunner = spawnQmd) {
  if (!isQmdEnabled(dataDir)) throw new Error('QMD 설정이 없습니다. 먼저 yarn cli rag --data PATH를 실행하세요.');
  const environment = qmdEnvironment(dataDir);
  const output = [runner(['update'], environment), runner(['embed'], environment)].filter(Boolean).join('\n');
  if (output) process.stderr.write(output.endsWith('\n') ? output : `${output}\n`);
}

export function setupQmd(dataDir: string, runner: QmdRunner = spawnQmd) {
  configureQmd(dataDir);
  updateQmd(dataDir, runner);
}

export function updateQmdIfEnabled(dataDir: string, runner: QmdRunner = spawnQmd) {
  if (!isQmdEnabled(dataDir)) return false;
  updateQmd(dataDir, runner);
  return true;
}

export function qmdMcpConfig(dataDir: string) {
  return {
    mcpServers: {
      localmark: {
        command: process.env.LOCALMARK_QMD_BIN ?? 'qmd',
        args: ['mcp'],
        env: qmdEnvironment(dataDir),
      },
    },
  };
}
