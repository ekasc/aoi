// Isolated E2E backend supervisor (used by scripts/run-e2e.mjs).
// Spawns packages/api/src/e2e-server.ts under tsx, waits for /healthz,
// prints the manifest line, and supervises shutdown. Usable standalone:
//   node scripts/e2e-backend.mjs [--port 8787] [--run-id demo]
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

const port = arg('port', '8787');
const runId = arg('run-id', `run-${Date.now().toString(36)}`);

const child = spawn(
  'pnpm',
  ['--filter', '@aoi/api', 'exec', 'tsx', 'src/e2e-server.ts'],
  {
    cwd: root,
    env: { ...process.env, PORT: port, AOI_E2E_RUN_ID: runId },
    stdio: ['ignore', 'pipe', 'inherit'],
  }
);

child.stdout.on('data', (chunk) => {
  const text = String(chunk);
  process.stdout.write(text);
});

const baseUrl = `http://127.0.0.1:${port}`;
const deadline = Date.now() + 60_000;
let healthy = false;
while (!healthy && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  try {
    const response = await fetch(`${baseUrl}/healthz`);
    healthy = response.ok;
  } catch {
    healthy = false;
  }
}
if (!healthy) {
  child.kill();
  console.error(`[e2e-backend] backend on ${baseUrl} never became healthy`);
  process.exit(2);
}

function shutdown() {
  child.kill();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
await new Promise(() => {});
