import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

import { createProxyServer } from './opencode-proxy.mjs';

const configIndex = process.argv.indexOf('--config');
if (configIndex < 0) throw new Error('--config is required');
const configPath = resolve(process.argv[configIndex + 1]);
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const root = resolve(import.meta.dirname, '../../..');
const reviewedFiles = [
  'features/session/session-context.tsx', 'features/api-client.ts', 'features/request-deadline.ts',
  'features/auth/types.ts', 'packages/shared/src/auth.ts',
  'features/auth/auth-api.ts', 'features/auth/oauth-client.ts',
  'features/space/space-context.tsx', 'features/space/space-snapshot.ts',
  'features/space/remote-space-repository.ts', 'features/push/push-api.ts',
  'packages/api/src/domains/auth.ts', 'packages/api/src/domains/spaces.ts',
  'packages/api/src/middleware/session.ts', 'packages/api/src/routes/session-auth.ts',
  'packages/api/src/auth/better-auth.ts',
  'tests/unit/session/session-signout.test.tsx', 'tests/unit/session/session-restore.test.tsx',
  'tests/unit/auth/api-client-tokens.test.ts', 'tests/unit/space/space-context-refresh.test.tsx',
  'tests/unit/push/push-api.test.ts',
  'tests/unit/push/push-context.test.tsx', 'tests/unit/navigation/us-entry-tabs.test.tsx',
  'tests/unit/push/push-session-boundary.test.tsx',
  'tests/unit/auth/remote-auth-api.test.ts', 'packages/api/src/__tests__/routes/session-auth.test.ts',
  'tools/mirofish-lab/src/auth-subject.mjs', 'tools/mirofish-lab/src/run-auth-swarm.mjs',
];
const fingerprint = () => Object.fromEntries(reviewedFiles.map((file) => [file, createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex')]));
const before = fingerprint();
writeFileSync(`${configPath}.${Date.now()}.inputs.json`, `${JSON.stringify({ capturedAt: new Date().toISOString(), before }, null, 2)}\n`);
if (config.model?.name !== 'deepseek-v4.1-flash') throw new Error('This runner is restricted to DeepSeek V4.1 Flash');
const key = process.env.OPENCODE_GO_API_KEY ?? (process.env.MIROFISH_KEY_FILE ? readFileSync(process.env.MIROFISH_KEY_FILE, 'utf8').trim() : null);
if (!key) throw new Error('Supply OPENCODE_GO_API_KEY or MIROFISH_KEY_FILE; no project secret files are loaded');
const proxy = createProxyServer();
await new Promise((done) => proxy.listen(0, '127.0.0.1', done));
const baseUrl = `http://127.0.0.1:${proxy.address().port}/v1`;
let child;
let transcript = '';
try {
  child = spawn(process.execPath, [resolve(homedir(), '.agents/skills/mirofish-swarm/scripts/run.mjs'), ...process.argv.slice(2)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, OPENCODE_GO_API_KEY: key, LLM_API_KEY: key, LLM_BASE_URL: baseUrl, LLM_MODEL_NAME: 'deepseek-v4.1-flash', CAMEL_LOGGING_LEVEL: 'WARNING' },
  });
  for (const [stream, output] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    stream.setEncoding('utf8');
    stream.on('data', (text) => {
      const safe = text.replaceAll(key, '[redacted]');
      if (stream === child.stdout) transcript += safe;
      output.write(safe);
    });
  }
  const timer = setTimeout(() => child.kill('SIGTERM'), 20 * 60 * 1000);
  try {
    process.exitCode = await new Promise((done, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => done(code ?? 1));
    });
  } finally {
    clearTimeout(timer);
  }
  const directory = transcript.match(/"runDir":\s*"([^"]+)"/)?.[1];
  const after = fingerprint();
  const unchanged = JSON.stringify(before) === JSON.stringify(after);
  if (directory) writeFileSync(resolve(directory, 'source-manifest.json'), `${JSON.stringify({ before, after, unchanged }, null, 2)}\n`);
  if (process.exitCode === 0) {
    const run = directory ? JSON.parse(readFileSync(resolve(directory, 'run.json'), 'utf8')) : null;
    const incomplete = run?.cohorts.some((cohort) => run.groups.some((group) => {
      const bundle = JSON.parse(readFileSync(resolve(directory, cohort, group, 'bundle.json'), 'utf8'));
      return !bundle.actions?.length || !bundle.observations?.length;
    }));
    if (!run || run.model !== 'deepseek-v4.1-flash' || run.errors?.length || incomplete || !unchanged) {
      process.stderr.write('Swarm incomplete: require the exact model, actions and discussion from every cohort, unchanged source, and no runner errors.\n');
      process.exitCode = 2;
    }
  }
} finally {
  if (child && child.exitCode === null) child.kill('SIGTERM');
  proxy.closeAllConnections();
  await new Promise((done) => proxy.close(done));
}
