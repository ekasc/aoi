// `pnpm test:e2e` — the executable E2E harness for album flows A–E.
//
// Runs the ACTUAL native test build (Expo dev-client/E2E bundle served by
// Metro) against a CONTROLLED isolated backend (packages/api/src/e2e-server,
// per-run D1 file + per-run secret), driving the REAL app UI with Maestro.
// No mocked album transport, no mocked SecureStore, no fake decryption, no
// bypassed enrollment.
//
// Fails EXPLICITLY (nonzero exit) when the runtime is unavailable: no Maestro
// binary, no booted device(s), unreachable backend/Metro, or app not
// installed. A Metro compile or a YAML syntax check never counts as a pass.
//
// Usage:
//   pnpm test:e2e [--alice-device S] [--bob-device S]
//                  [--flows a,b1,b2,b2b,b3,c,e,d] [--backend-url URL]
//                  [--metro-url URL] [--app-id com.ekasc.aoi]
//                  [--keep-data] [--artifacts-dir DIR]
//
// Two-device flows (B) need two booted emulators/devices; single-device
// flows run on the Alice device. Backend data is namespaced per run
// (AOI_E2E_RUN_ID), so reruns never collide.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FAIL = 2;

function arg(name, fallback = undefined) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}
function flag(name) {
  return process.argv.includes(`--${name}`);
}

const APP_ID = arg('app-id', 'com.ekasc.aoi');
const METRO_URL = arg('metro-url', 'http://127.0.0.1:8081');
const ARTIFACTS = arg('artifacts-dir', join(root, '.expo', 'aoi-e2e', 'artifacts'));
const RUN_ID = `e2e-${Date.now().toString(36)}`;
const requestedFlows = (arg('flows', 'a,b1,b2,b2b,b3,c,e,d') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

function fail(message) {
  console.error(`[test:e2e] FATAL: ${message}`);
  process.exit(FAIL);
}

function haveBin(name) {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'command', ['-v', name], { stdio: 'ignore' });
  return result.status === 0;
}

// ── 1. Maestro present? ──────────────────────────────────────────────────
if (!haveBin('maestro')) {
  fail('Maestro is not installed. Install it (https://maestro.mobile.dev), boot an emulator/device, then rerun. Nothing was executed.');
}

// ── 2. Devices ───────────────────────────────────────────────────────────
function listDevices() {
  // `maestro devices` prints connected devices; fall back to adb.
  try {
    const out = execFileSync('maestro', ['devices'], { encoding: 'utf8', timeout: 30_000 });
    return out.split('\n').map((l) => l.trim()).filter((l) => l && !/^list/i.test(l));
  } catch {
    return [];
  }
}
let devices = listDevices();
if (devices.length === 0 && haveBin('adb')) {
  try {
    const out = execFileSync('adb', ['devices'], { encoding: 'utf8', timeout: 30_000 });
    devices = out.split('\n').slice(1).map((l) => l.split('\t')[0].trim()).filter((l) => l && l !== 'offline');
  } catch {
    devices = [];
  }
}
const aliceDevice = arg('alice-device', devices[0]);
const bobDevice = arg('bob-device', devices[1] ?? devices[0]);
if (!aliceDevice) fail('No booted emulator/device found. Boot one (Android emulator orExpo Go dev-client build), then rerun. Nothing was executed.');
const needsTwo = requestedFlows.some((f) => ['b1', 'b2', 'b2b', 'b3'].includes(f));
if (needsTwo && !devices[1] && !arg('bob-device')) {
  fail(`Flow B needs two device instances (Alice + Bob); only one is connected (${aliceDevice}). Boot a second emulator, or pass --bob-device. Nothing was executed.`);
}
console.log(`[test:e2e] devices: alice=${aliceDevice} bob=${bobDevice}`);

// ── 3. Backend (controlled, isolated) ────────────────────────────────────
let backendUrl = arg('backend-url', undefined);
let backendChild = null;
let manifest = null;
if (!backendUrl) {
  const port = '8787';
  backendChild = spawn('pnpm', ['--filter', '@aoi/api', 'exec', 'tsx', 'src/e2e-server.ts'], {
    cwd: root,
    env: { ...process.env, PORT: port, AOI_E2E_RUN_ID: RUN_ID },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  backendUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  let healthy = false;
  while (!healthy && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      healthy = (await fetch(`${backendUrl}/healthz`)).ok;
    } catch {
      healthy = false;
    }
  }
  if (!healthy) {
    backendChild.kill();
    fail(`Isolated backend on ${backendUrl} never became healthy. Nothing was executed.`);
  }
  const manifestPath = join(root, '.expo', 'aoi-e2e', RUN_ID, 'manifest.json');
  if (existsSync(manifestPath)) manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} else {
  const response = await fetch(`${backendUrl}/healthz`).catch(() => null);
  if (!response?.ok) fail(`External backend ${backendUrl} is not healthy. Nothing was executed.`);
  const secret = arg('e2e-secret');
  const aliceEmail = arg('alice-email', 'alice.e2e@example.com');
  const bobEmail = arg('bob-email', 'bob.e2e@example.com');
  if (!secret) fail('With --backend-url, pass --e2e-secret (and --alice-email/--bob-email if non-default).');
  manifest = { baseUrl: backendUrl, publicBaseUrl: backendUrl, runId: 'external', secret, aliceEmail, bobEmail, spaceId: arg('space-id', '') };
}
if (!manifest) fail('Backend manifest unavailable; cannot configure the app under test.');
console.log(`[test:e2e] backend: ${manifest.publicBaseUrl} run=${manifest.runId} space=${manifest.spaceId}`);

// ── 4. Metro serving the E2E bundle? ─────────────────────────────────────
try {
  const response = await fetch(`${METRO_URL}/status`);
  const text = await response.text();
  if (!text.includes('packager-status:running')) throw new Error('unexpected status body');
} catch {
  backendChild?.kill();
  fail(`Metro is not serving at ${METRO_URL} (need an E2E dev build: EXPO_PUBLIC_E2E_MODE=true EXPO_PUBLIC_E2E_API_URL=<backend> expo start). A successful backend boot does not count.`);
}

// ── 5. App installed? ────────────────────────────────────────────────────
if (haveBin('adb')) {
  const targets = [...new Set([aliceDevice, bobDevice])];
  for (const serial of targets) {
    try {
      const out = execFileSync('adb', ['-s', serial, 'shell', 'pm', 'list', 'packages'], { encoding: 'utf8', timeout: 30_000 });
      if (!out.includes(APP_ID)) {
        backendChild?.kill();
        fail(`App ${APP_ID} is not installed on ${serial}. Install the E2E dev build first. Nothing was executed.`);
      }
    } catch (error) {
      console.warn(`[test:e2e] WARN: could not verify install on ${serial}: ${error.message}`);
    }
  }
} else {
  console.warn('[test:e2e] WARN: adb unavailable; skipping install check (Maestro will fail loudly if the app is missing).');
}

// ── 6. Fixture ───────────────────────────────────────────────────────────
const fixture = join(root, 'assets', 'e2e-test-photo.png');
if (!existsSync(fixture)) {
  execFileSync('node', [join(root, 'scripts', 'make-e2e-fixture.mjs')], { stdio: 'inherit' });
}

mkdirSync(ARTIFACTS, { recursive: true });
const results = [];

function maestroEnv(extra = {}) {
  return {
    ...process.env,
    E2E_RUN_ID: manifest.runId,
    E2E_BACKEND_URL: manifest.publicBaseUrl,
    E2E_ACCOUNT_BUTTON: 'Sign in as Alice (E2E)',
    E2E_ACCOUNT_EMAIL: manifest.aliceEmail,
    ...extra,
  };
}

function runFlow(name, device, extraEnv = {}) {
  const file = join(root, 'e2e', 'maestro', `${name}.yaml`);
  const logPath = join(ARTIFACTS, `${name}-${device}.log`);
  console.log(`[test:e2e] flow ${name} on ${device}`);
  const env = maestroEnv(extraEnv);
  const args = ['test', file, '--device', device];
  const started = Date.now();
  try {
    const out = execFileSync('maestro', args, {
      encoding: 'utf8',
      timeout: 420_000,
      env,
      cwd: root,
    });
    writeFileSync(logPath, `$ maestro ${args.join(' ')}\n\n${out}`);
    results.push({ flow: name, device, ok: true, ms: Date.now() - started });
    console.log(`[test:e2e] PASS ${name} (${Date.now() - started}ms)`);
  } catch (error) {
    writeFileSync(logPath, `$ maestro ${args.join(' ')}\n\n${error.stdout ?? ''}\n${error.stderr ?? ''}\n${error.message}`);
    results.push({ flow: name, device, ok: false, ms: Date.now() - started, error: error.message });
    console.error(`[test:e2e] FAIL ${name} on ${device} — log: ${logPath}`);
  }
}

function hierarchy(device) {
  for (const args of [['hierarchy', '--device', device], ['hierarchy']]) {
    try {
      return execFileSync('maestro', args, { encoding: 'utf8', timeout: 60_000, cwd: root });
    } catch {
      continue;
    }
  }
  fail(`Could not dump the view hierarchy on ${device}; fingerprint/phrase comparison is impossible.`);
}

const FINGERPRINT_RE = /\b([0-9a-f]{5}(?: [0-9a-f]{5}){11})\b/i;
function extractFingerprint(dump, device) {
  const match = String(dump).match(FINGERPRINT_RE);
  if (!match) fail(`No verification fingerprint visible in the hierarchy on ${device}; cannot prove both sides match.`);
  return match[1].toLowerCase().replace(/\s+/g, ' ');
}

const MEDIA_RE = /Archive: (?:uploaded ([0-9a-f-]{36})|(\d+) photos, first (\S+))/i;
function extractMediaId(dump, device) {
  const match = String(dump).match(MEDIA_RE);
  const id = match?.[1] ?? (match?.[2] !== '0' ? match?.[3] : null);
  if (!id || id === 'none') fail(`No uploaded media id visible in the hierarchy on ${device}.`);
  return id;
}

function extractPhrase(dump) {
  const words = [];
  for (let n = 1; n <= 24; n += 1) {
    const match = String(dump).match(new RegExp(`Word ${n} of 24:\\s*([a-z]+)`, 'i'));
    if (!match) fail(`Recovery phrase word ${n} not found in the hierarchy; cannot drive Flow E.`);
    words.push(match[1].toLowerCase());
  }
  return words.join(' ');
}

async function backendToken(email) {
  const response = await fetch(`${manifest.baseUrl}/v1/auth/e2e/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, secret: manifest.secret }),
  });
  if (!response.ok) fail(`Backend refused E2E session for ${email}: ${response.status}.`);
  return response.json();
}

async function waitForClaim(deviceIdHint, timeoutMs = 60_000) {
  const { token } = await backendToken(manifest.aliceEmail);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const snapshot = await (await fetch(`${manifest.baseUrl}/v1/spaces/current/album/protocol`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    const claim = (snapshot.claims ?? []).find((c) => c.deviceId !== deviceIdHint);
    if (claim) return claim.deviceId;
    if (Date.now() > deadline) fail("Bob's claim never appeared in Alice's snapshot within 60s.");
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// ── Flow sequence ────────────────────────────────────────────────────────
const want = (f) => requestedFlows.includes(f);
const aliceEnv = { E2E_ACCOUNT_BUTTON: 'Sign in as Alice (E2E)', E2E_ACCOUNT_EMAIL: manifest.aliceEmail };
const bobEnv = { E2E_ACCOUNT_BUTTON: 'Sign in as Bob (E2E)', E2E_ACCOUNT_EMAIL: manifest.bobEmail };
let aliceMediaId = null;

if (want('a')) runFlow('album-a-creation', aliceDevice, aliceEnv);

if (want('b1')) runFlow('album-b1-bob-requests', bobDevice, bobEnv);
if (want('b2') || want('b2b') || want('b3')) {
  // Controlled retry: Bob's claim must be visible before Alice looks.
  const bobDeviceId = await waitForClaim('device-alice').catch((e) => fail(e.message));
  const claimButton = `Device ${String(bobDeviceId).slice(0, 8)}`;
  if (want('b2')) runFlow('album-b2-alice-sees-request', aliceDevice, { ...aliceEnv, E2E_CLAIM_BUTTON: claimButton });
  if (want('b2') || want('b2b')) {
    const bobPrint = extractFingerprint(hierarchy(bobDevice), `bob (${bobDevice})`);
    const alicePrint = extractFingerprint(hierarchy(aliceDevice), `alice (${aliceDevice})`);
    if (bobPrint !== alicePrint) {
      results.push({ flow: 'fingerprint-match', ok: false, error: `Mismatch: bob=${bobPrint} alice=${alicePrint}` });
      console.error('[test:e2e] FAIL fingerprint-match: displayed codes differ; refusing to approve.');
    } else {
      results.push({ flow: 'fingerprint-match', ok: true });
      console.log('[test:e2e] PASS fingerprint-match');
      if (want('b2b')) runFlow('album-b2b-alice-approves', aliceDevice, { ...aliceEnv, E2E_CLAIM_BUTTON: claimButton });
    }
  }
  if (want('b3')) runFlow('album-b3-bob-accepts', bobDevice, bobEnv);
}

if (want('c')) {
  runFlow('album-c-media', aliceDevice, aliceEnv);
  aliceMediaId = extractMediaId(hierarchy(aliceDevice), `alice (${aliceDevice})`);
  runFlow('album-c-media', bobDevice, bobEnv);
  const bobMediaId = extractMediaId(hierarchy(bobDevice), `bob (${bobDevice})`);
  if (bobMediaId !== aliceMediaId) {
    results.push({ flow: 'media-id-match', ok: false, error: `alice=${aliceMediaId} bob=${bobMediaId}` });
    console.error('[test:e2e] FAIL media-id-match: Bob does not see Alice’s photo.');
  } else {
    results.push({ flow: 'media-id-match', ok: true });
    console.log('[test:e2e] PASS media-id-match');
  }
  // Unauthorized identity: unknown account gets nothing; bad token gets 401.
  const ghost = await fetch(`${manifest.baseUrl}/v1/auth/e2e/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'ghost@example.com', secret: manifest.secret }),
  });
  const badObject = await fetch(
    `${manifest.baseUrl}/v1/spaces/current/album/protocol/media/${aliceMediaId}/object`,
    { headers: { Authorization: 'Bearer not-a-token' } }
  );
  if (ghost.status === 404 && badObject.status === 401) {
    results.push({ flow: 'unauthorized-identity', ok: true });
    console.log('[test:e2e] PASS unauthorized-identity (unknown account 404, bad token 401)');
  } else {
    results.push({ flow: 'unauthorized-identity', ok: false, error: `ghost=${ghost.status} badToken=${badObject.status}` });
    console.error('[test:e2e] FAIL unauthorized-identity');
  }
}

if (want('e')) {
  // Extract Alice's phrase from the real recovery-phrase screen first.
  runFlow('album-e0-show-phrase', aliceDevice, aliceEnv);
  const phrase = extractPhrase(hierarchy(aliceDevice));
  runFlow('album-e-recovery', aliceDevice, { ...aliceEnv, E2E_PHRASE: phrase });
}

if (want('d')) {
  runFlow('album-d-deletion', aliceDevice, aliceEnv);
  runFlow('album-d-deletion', bobDevice, bobEnv);
}

// ── Report ───────────────────────────────────────────────────────────────
const matrixPath = join(ARTIFACTS, `matrix-${RUN_ID}.json`);
writeFileSync(matrixPath, JSON.stringify({ runId: RUN_ID, backend: manifest.publicBaseUrl, results }, null, 2));
console.log('\n[test:e2e] matrix');
for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.flow}${r.device ? ` (${r.device})` : ''}${r.error ? ` — ${r.error}` : ''}`);
console.log(`[test:e2e] artifacts: ${ARTIFACTS} matrix: ${matrixPath}`);

if (!flag('keep-data')) console.log(`[test:e2e] backend data kept at ${manifest.dataDir ?? '(external backend)'}`);
backendChild?.kill();

if (results.some((r) => !r.ok)) {
  console.error('[test:e2e] RESULT: FAIL');
  process.exit(1);
}
console.log('[test:e2e] RESULT: PASS');
