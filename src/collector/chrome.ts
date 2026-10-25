import { spawn } from 'node:child_process';
import { DomCollector } from './ego.js';

const MARKER = 'LOCALMARK_JSON:';
const runtimeModule = new URL('./chrome-runtime.js', import.meta.url).href;

function runProcess(body: string): Promise<any> {
  const code = `import { runChromeBody } from ${JSON.stringify(runtimeModule)}; await runChromeBody(${JSON.stringify(body)});`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Chrome collection timed out')); }, 240000);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(new Error(`Chrome collector is unavailable: ${error.message}`)); });
    child.on('close', exitCode => {
      clearTimeout(timer);
      const lines = (stdout + '\n' + stderr).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').split(/\r?\n/).reverse();
      for (const line of lines) {
        const offset = line.lastIndexOf(MARKER);
        if (offset < 0) continue;
        try { return resolve(JSON.parse(line.slice(offset + MARKER.length))); } catch { /* Try an earlier complete marker. */ }
      }
      const errorLines = stderr.trim().split(/\r?\n/).filter(line => !line.includes('ExperimentalWarning') && !line.includes('--trace-warnings'));
      const detail = errorLines.find(line => /^(?:Error|SyntaxError|TypeError):/.test(line))?.replace(/^(?:Error|SyntaxError|TypeError):\s*/, '') ?? errorLines.at(-1);
      reject(new Error(detail || (exitCode ? `Chrome collection failed (${exitCode})` : 'Chrome returned no collection result')));
    });
  });
}

export class ChromeCollector extends DomCollector {
  constructor() {
    super(runProcess, 'Chrome');
  }
}
