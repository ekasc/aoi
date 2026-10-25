import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { labPaths } from '../src/lib/paths.mjs';

const paths = labPaths();

function files(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'runs' || entry === 'artifacts') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(root);
  return out;
}

test('lab sources, seeds, scenarios, and configs contain no secret-like values', () => {
  const patterns = [/sk-[A-Za-z0-9]{10,}/, /ghp_[A-Za-z0-9]{10,}/, /AKIA[0-9A-Z]{12,}/, /Bearer\s+[A-Za-z0-9._-]{8,}/];
  for (const file of files(paths.labRoot)) {
    if (file.endsWith('.log') || file.includes('/reports/artifacts/')) continue;
    if (file.includes('/tests/')) continue;
    const text = readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      assert.equal(pattern.test(text), false, `${file} contains a secret-like value`);
    }
  }
});

test('the documented MiroFish base URL is loopback only', () => {
  const config = JSON.parse(readFileSync(join(paths.configDir, 'lab.example.json'), 'utf8'));
  assert.match(config.mirofish.baseUrl, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
  const readme = readFileSync(join(paths.labRoot, 'README.md'), 'utf8');
  assert.equal(/--host\s+0\.0\.0\.0/.test(readme), false);
});

test('docs and scripts make no host-specific assumption', () => {
  const readme = readFileSync(join(paths.labRoot, 'README.md'), 'utf8');
  const scripts = readdirSync(join(paths.labRoot, 'scripts'))
    .map((name) => readFileSync(join(paths.labRoot, 'scripts', name), 'utf8'))
    .join('\n');
  const text = `${readme}\n${scripts}`;
  assert.equal(/bootstrap-ubuntu|stop-ubuntu|MIROFISH_LAB_HOST|on Ubuntu/i.test(text), false);
  assert.match(readme, /macOS or Linux/);
  assert.match(readme, /No host is assumed/);
});
