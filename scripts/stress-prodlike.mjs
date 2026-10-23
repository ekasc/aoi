import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assessStressReport } from './stress-assess.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const profile = option('--profile', 'established');
if (!['established', 'heavy'].includes(profile)) throw new Error('Use established or heavy');
const host = option('--host', '127.0.0.1');
if (!/^(127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)$/.test(host)) throw new Error('Private IPv4 host required');
const port = Number(option('--port', '8092'));
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port');
const output = resolve(root, `.expo/aoi-debug/performance/prodlike-${profile}-${Date.now()}`);
mkdirSync(output, { recursive: true });
const configPath = resolve(root, 'features/dev/local-stress-config.json');
const originalConfig = readFileSync(configPath, 'utf8');
if (originalConfig.trim() !== 'null') throw new Error('An existing stress configuration is active; refusing to overwrite it');
const backendLog = resolve(output, 'backend.log');
const child = spawn('pnpm', ['--filter', '@aoi/api', 'exec', 'tsx', 'src/stress-server.ts'], {
  cwd: root,
  env: { ...process.env, PORT: String(port), AOI_STRESS_PROFILE: profile, AOI_STRESS_PUBLIC_URL: `http://${host}:${port}`, AOI_STRESS_OUTPUT: output },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', bytes => { log += bytes; writeFileSync(backendLog, log); });
child.stderr.on('data', bytes => { log += bytes; writeFileSync(backendLog, log); });
const closed = new Promise(resolve => child.once('close', code => resolve(code)));
let manifest;
let report;
let activated = false;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function dev(command, input) {
  const args = ['scripts/dev-agent.mjs', command];
  if (input) args.push('--stdin', '--timeout', process.argv.includes('--diagnostic') ? '600000' : '180000');
  const result = spawnSync(process.execPath, args, { cwd: root, input, encoding: 'utf8', timeout: 610000, maxBuffer: 40 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw result.error || new Error(result.stderr || result.stdout);
  return input ? JSON.parse(result.stdout.trim()) : result.stdout;
}
try {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (child.exitCode !== null) throw new Error(`Backend exited: ${log}`);
    if (existsSync(resolve(output, 'manifest.json'))) {
      manifest = JSON.parse(readFileSync(resolve(output, 'manifest.json'), 'utf8'));
      const response = await fetch(`${manifest.loopbackUrl}/__stress/manifest`, { signal: AbortSignal.timeout(1000) }).catch(() => null);
      if (response?.ok && (await response.json()).run === manifest.run) break;
      manifest = null;
    }
    await sleep(200);
  }
  if (!manifest) throw new Error(`Backend readiness failed: ${log}`);
  console.log(JSON.stringify({ profile, counts: manifest.counts, seedMs: manifest.seedMs, pictureBytes: manifest.pictureBytes[0], output }));
  report = { profile, counts: manifest.counts, api: [], integrity: null, device: null };
  const request = async (path, client, options = {}) => {
    const response = await fetch(`${manifest.loopbackUrl}${path}`, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${client.token}` }, signal: AbortSignal.timeout(15000) });
    const bytes = await response.arrayBuffer();
    return { status: response.status, bytes: bytes.byteLength, body: JSON.parse(new TextDecoder().decode(bytes)) };
  };
  const first = manifest.clients[0];
  const seen = new Set();
  let cursor;
  let pages = 0;
  const pagingStart = performance.now();
  do {
    const page = await request(`/v1/spaces/current/moments?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, first);
    if (page.status !== 200) throw new Error(`Pagination returned ${page.status}`);
    for (const moment of page.body.moments) {
      if (seen.has(moment.id)) throw new Error('Pagination duplicated a memory');
      seen.add(moment.id);
    }
    cursor = page.body.nextCursor;
    pages++;
    if (pages > 1000) throw new Error('Pagination did not terminate');
  } while (cursor);
  if (seen.size !== manifest.counts.moments) throw new Error(`Archive incomplete: ${seen.size}`);
  report.integrity = { memories: seen.size, pages, ms: Math.round(performance.now() - pagingStart), duplicateIds: 0 };
  console.log(JSON.stringify(report.integrity));
  const range = `from=${encodeURIComponent(new Date(Date.now() - 30 * 86400000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 30 * 86400000).toISOString())}`;
  const readPaths = ['/v1/spaces/current/moments?limit=100', '/v1/spaces/current/collections', `/v1/spaces/current/calendar/events?${range}`, '/v1/spaces/current/letters'];
  const writeIds = [];
  for (const concurrency of process.argv.includes('--ui-only') ? [] : [1, 10, 50, 100]) {
    const total = concurrency === 1 ? 40 : concurrency * 10;
    const timings = [];
    const failures = [];
    let bytes = 0;
    let next = 0;
    const start = performance.now();
    await Promise.all(Array.from({ length: concurrency }, async (_, worker) => {
      while (next < total) {
        const index = next++;
        const client = index % 3 === 0 ? first : manifest.clients[(worker + index) % manifest.clients.length];
        const before = performance.now();
        const write = index % 5 === 0;
        const path = write ? '/v1/spaces/current/moments' : readPaths[index % readPaths.length];
        const clientId = `stress-${manifest.run.slice(0, 8)}-${concurrency}-${index}`;
        try {
          const result = await request(path, client, write ? { method: 'POST', body: JSON.stringify({ type: 'note', title: 'Stress write', body: 'Synthetic test content', clientId }) } : {});
          bytes += result.bytes;
          if (![200, 201].includes(result.status)) failures.push({ path, status: result.status });
          if (write && result.body.id) writeIds.push({ id: result.body.id, client, clientId });
        } catch (error) { failures.push({ path, error: error.message }); }
        timings.push(performance.now() - before);
      }
    }));
    timings.sort((a, b) => a - b);
    const elapsed = performance.now() - start;
    const row = { concurrency, requests: total, writeShare: 0.2, p50Ms: Math.round(timings[Math.floor(timings.length * 0.5)]), p95Ms: Math.round(timings[Math.floor(timings.length * 0.95)]), p99Ms: Math.round(timings[Math.min(timings.length - 1, Math.floor(timings.length * 0.99))]), maxMs: Math.round(timings.at(-1)), requestsPerSecond: Number((total / elapsed * 1000).toFixed(1)), responseBytes: bytes, failures };
    report.api.push(row);
    console.log(JSON.stringify(row));
  }
  const writesByClient = new Map();
  for (const write of writeIds) {
    const group = writesByClient.get(write.client.token) || { client: write.client, ids: new Set() };
    group.ids.add(write.id);
    writesByClient.set(write.client.token, group);
  }
  for (const group of writesByClient.values()) {
    let readCursor;
    let attempts = 0;
    do {
      const check = await request(`/v1/spaces/current/moments?limit=100${readCursor ? `&cursor=${encodeURIComponent(readCursor)}` : ''}`, group.client);
      if (check.status !== 200) throw new Error('Write verification read failed');
      for (const moment of check.body.moments) group.ids.delete(moment.id);
      readCursor = check.body.nextCursor;
      if (++attempts > 10) throw new Error('Write verification exceeded page limit');
    } while (group.ids.size && readCursor);
    if (group.ids.size) throw new Error('Written memories did not persist');
  }
  for (const write of writeIds.slice(0, 20)) {
    const duplicate = await request('/v1/spaces/current/moments', write.client, { method: 'POST', body: JSON.stringify({ type: 'note', title: 'Stress write', body: 'Synthetic test content', clientId: write.clientId }) });
    if (duplicate.body.id !== write.id) throw new Error('Retry created a second memory');
  }
  report.integrity.persistedWrites = writeIds.length;
  report.integrity.allWritesReadBack = true;
  report.integrity.idempotentRetriesChecked = Math.min(writeIds.length, 20);
  writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  if (process.argv.includes('--device') || process.argv.includes('--web')) {
    writeFileSync(configPath, JSON.stringify({ baseUrl: manifest.baseUrl, profile, session: { user: { id: first.userId, email: `${first.userId}@stress.invalid`, displayName: 'Maya Stress' }, tokens: { accessToken: first.token } } }, null, 2) + '\n');
    activated = true;
    if (process.argv.includes('--device')) {
      let reloaded = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        try { dev('reload'); reloaded = true; break; } catch {
          await sleep(500);
        }
      }
      if (!reloaded) throw new Error('The phone disconnected during stress-profile activation');
      await sleep(12000);
      report.device = dev('eval', readFileSync(resolve(root, process.argv.includes('--diagnostic') ? 'scripts/feed-diagnostic.js' : 'scripts/stress-device-scenarios.js'), 'utf8'));
      console.log(JSON.stringify(report.device));
    }
    if (process.argv.includes('--web')) {
      const { runWebStress } = await import('./stress-web-scenarios.mjs');
      report.web = await runWebStress(root, output);
      console.log(JSON.stringify(report.web));
    }
  }
  report.performance = assessStressReport(report);
  writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  try {
    const metrics = await fetch(`${manifest.loopbackUrl}/__stress/metrics`, { headers: { Authorization: `Bearer ${manifest.controlToken}` }, signal: AbortSignal.timeout(5000) });
    writeFileSync(resolve(output, 'requests.json'), await metrics.text());
  } catch (error) {
    if (!existsSync(resolve(output, 'requests.json'))) throw error;
    report.metricsCollectionNote = 'Used the backend shutdown snapshot after the live metrics request failed';
    writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  }
  console.log(`Saved ${resolve(output, 'report.json')}`);
  if (report.api.some(row => row.failures.length) || report.device?.ok === false || report.device?.results?.some(row => !row.ok) || report.web?.ok === false || !report.performance.passed) {
    console.error(JSON.stringify({ exitReason: 'assessment-failed', violations: report.performance.violations }, null, 2));
    process.exitCode = 1;
  }
} catch (error) {
  if (report) {
    report.failure = error.message;
    if (activated && process.argv.includes('--device')) {
      // Positional expression, not --stdin: the stdin path mis-parses this one.
      const partial = spawnSync(process.execPath, ['scripts/dev-agent.mjs', 'eval', '--timeout', '10000', 'globalThis.__aoiDiagPartial ?? null'], { cwd: root, encoding: 'utf8', timeout: 20000 });
      try { report.devicePartial = JSON.parse(partial.stdout.trim()); } catch { report.devicePartial = { raw: partial.stdout?.slice(0, 300) ?? null }; }
    }
    writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  }
  throw error;
} finally {
  if (activated) {
    writeFileSync(configPath, originalConfig);
    if (process.argv.includes('--device')) {
      try { dev('reload'); } catch (error) { console.error(`Device restoration failed: ${error.message}`); }
    }
  }
  if (manifest) {
    await fetch(`${manifest.loopbackUrl}/__stress/shutdown`, { method: 'POST', headers: { Authorization: `Bearer ${manifest.controlToken}` }, signal: AbortSignal.timeout(2000) }).catch(() => {});
    const outcome = await Promise.race([closed.then(code => ({ code })), sleep(15000).then(() => ({ timeout: true }))]);
    if (outcome.timeout) throw new Error('Test backend did not exit; its ten-minute lifetime limit remains active');
  }
}
