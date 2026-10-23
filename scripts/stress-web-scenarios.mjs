import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export async function runWebStress(root, output) {
  const session = `aoi-stress-${Date.now()}`;
  function browser(args, input) {
    const result = spawnSync('agent-browser', ['--session', session, ...args], { input, encoding: 'utf8', timeout: 120000, maxBuffer: 20 * 1024 * 1024 });
    if (result.error || result.status !== 0) throw result.error || new Error(result.stderr || result.stdout);
    return result.stdout.trim();
  }
  try {
    browser(['--args', '--no-sandbox', 'open', 'http://127.0.0.1:8081']);
    browser(['wait', '15000']);
    writeFileSync(resolve(output, 'web-before.txt'), browser(['snapshot']));
    const source = readFileSync(resolve(root, 'scripts/stress-device-scenarios.js'), 'utf8');
    const raw = browser(['eval', '--stdin'], source);
    const result = JSON.parse(raw);
    browser(['screenshot', resolve(output, 'web-after.png')]);
    const snapshot = browser(['snapshot']);
    writeFileSync(resolve(output, 'web-after.txt'), snapshot);
    const errorOverlay = /Uncaught Error|renderToImageAsync is not available/.test(snapshot);
    return { ...result, ok: result.ok && !errorOverlay, errorOverlay, platform: 'Chrome web; not native phone', page: 'real app routes and remote repositories' };
  } finally { browser(['close']); }
}
