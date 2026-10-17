/**
 * Isolated E2E backend.
 *
 * Run: `pnpm --filter @aoi/api exec tsx src/e2e-server.ts`
 * (or `pnpm test:e2e`, which supervises it). Serves the REAL Hono app over
 * HTTP with a per-run file-backed D1, an in-memory R2 shim, the E2E auth
 * bootstrap enabled, and seeded Alice/Bob test accounts sharing one Space.
 *
 * Object uploads need no cloud: the media store is overridden so presigned
 * PUTs point back at this server (`/v1/e2e/uploads/*`, HMAC-signed with the
 * per-run secret, expiry-checked, `If-None-Match: *` enforced with a real
 * 412). Reservation, finalisation, manifests, tombstones, and reads all run
 * unmodified production code; only the byte transport terminates locally,
 * with the same conditional-create semantics real R2 provides (proven
 * against a real bucket by tests/integration/r2-conditional-put.test.ts).
 *
 * Env:
 *   PORT (default 8787), AOI_E2E_RUN_ID (default random),
 *   AOI_E2E_DATA_DIR (default .expo/aoi-e2e/<run>),
 *   AOI_E2E_SECRET (default random, printed), AOI_E2E_PUBLIC_BASE_URL
 *   (what devices should reach us at; default http://127.0.0.1:<port> —
 *   CI sets http://10.0.2.2:<port> for the emulator).
 * Prints a JSON manifest line `AOI_E2E_MANIFEST={...}` on stdout for the
 * runner, and writes it to <data-dir>/manifest.json.
 */
import { createHash, createHmac, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';

import { createApp } from './create-app';
import { makeTestHarness } from './effects/test-harness';
import type { MediaStoreService } from './services/media-store';

const PORT = parseInt(process.env.PORT ?? '8787', 10);
const RUN_ID = process.env.AOI_E2E_RUN_ID ?? randomUUID().slice(0, 8);
const DATA_DIR =
  process.env.AOI_E2E_DATA_DIR ?? path.join(process.cwd(), '..', '..', '.expo', 'aoi-e2e', RUN_ID);
const SECRET = process.env.AOI_E2E_SECRET ?? randomUUID().replaceAll('-', '');
const ALICE_EMAIL = process.env.AOI_E2E_ALICE_EMAIL ?? 'alice.e2e@example.com';
const BOB_EMAIL = process.env.AOI_E2E_BOB_EMAIL ?? 'bob.e2e@example.com';
const SPACE_ID = `space-e2e-${RUN_ID}`;
const NOW = Date.now();
const UPLOAD_TTL_MS = 60 * 60 * 1000;

fs.mkdirSync(DATA_DIR, { recursive: true });

let publicBaseUrl = process.env.AOI_E2E_PUBLIC_BASE_URL ?? `http://127.0.0.1:${PORT}`;

function signUpload(key: string, expiresAt: number): string {
  return createHmac('sha256', SECRET).update(`${key}:${expiresAt}`).digest('hex');
}

const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

const e2eMediaStore: MediaStoreService = {
  bucket: null as never,
  bucketName: 'aoi-e2e',
  presignPutUrl: async (key, contentType, _sizeBytes, options) => {
    const expiresAt = Date.now() + UPLOAD_TTL_MS;
    const url =
      `${publicBaseUrl}/v1/e2e/uploads/${encodeURIComponent(key)}` +
      `?expiresAt=${expiresAt}&sig=${signUpload(key, expiresAt)}`;
    return {
      url,
      headers: {
        'Content-Type': contentType,
        ...(options?.ifNoneMatch ? { 'If-None-Match': '*' } : {}),
      },
    };
  },
  head: async (key) => {
    const entry = objects.get(key);
    if (!entry) return null;
    return {
      key,
      size: entry.bytes.byteLength,
      httpEtag: `etag-${createHash('md5').update(entry.bytes).digest('hex')}`,
      uploaded: new Date(0),
      writeHttpMetadata() {},
    };
  },
  get: async (key) => {
    const entry = objects.get(key);
    if (!entry) return null;
    const bytes = entry.bytes;
    return {
      key,
      size: bytes.byteLength,
      httpEtag: `etag-${key}`,
      uploaded: new Date(0),
      httpMetadata: { contentType: entry.contentType },
      writeHttpMetadata() {},
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    };
  },
  put: async (key, value, options) => {
    const bytes =
      typeof value === 'string'
        ? new TextEncoder().encode(value)
        : value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : value instanceof Uint8Array
            ? value
            : new Uint8Array(await new Response(value as ReadableStream).arrayBuffer());
    objects.set(key, {
      bytes,
      contentType: options?.httpMetadata?.contentType ?? 'application/octet-stream',
    });
    return { key, size: bytes.byteLength, httpEtag: `etag-${key}`, uploaded: new Date(0), writeHttpMetadata() {} };
  },
  delete: async (key) => {
    objects.delete(key);
  },
  list: async () => ({ objects: [], truncated: false }),
};

const harness = makeTestHarness({
  filename: path.join(DATA_DIR, 'd1.sqlite'),
  config: { AOI_E2E_MODE: 'true', AOI_E2E_SECRET: SECRET },
  mediaStore: e2eMediaStore,
});

function seed(): void {
  const d1 = harness.d1;
  const user = (id: string, email: string, name: string) =>
    d1.runSync(
      'insert into users (id, email, name, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?) on conflict(id) do nothing',
      id,
      email,
      name,
      NOW,
      NOW
    );
  const aliceId = `00000000-0000-4000-8000-00000000e201`;
  const bobId = `00000000-0000-4000-8000-00000000e202`;
  user(aliceId, ALICE_EMAIL, 'Alice E2E');
  user(bobId, BOB_EMAIL, 'Bob E2E');
  d1.runSync(
    `insert into spaces (id, name, partner_name, relationship_start_date, created_by_user_id, created_at, updated_at)
     values (?, 'E2E Space', 'Partner', '2026-01-01', ?, ?, ?) on conflict(id) do nothing`,
    SPACE_ID,
    aliceId,
    NOW,
    NOW
  );
  d1.runSync(
    `insert into space_members (space_id, user_id, role, state, joined_at) values (?, ?, 'you', 'active', ?) on conflict(space_id, user_id) do nothing`,
    SPACE_ID,
    aliceId,
    NOW
  );
  d1.runSync(
    `insert into space_members (space_id, user_id, role, state, joined_at) values (?, ?, 'partner', 'active', ?) on conflict(space_id, user_id) do nothing`,
    SPACE_ID,
    bobId,
    NOW
  );
}

seed();

const app = createApp(harness.layer);

// Local byte transport for presigned uploads (see header). Verifies the
// HMAC + expiry this server minted, then enforces the conditional create.
const uploads = new Hono();
uploads.put('/v1/e2e/uploads/:key', async (c) => {
  const key = decodeURIComponent(c.req.param('key'));
  const expiresAt = Number(c.req.query('expiresAt') ?? '0');
  const sig = c.req.query('sig') ?? '';
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Upload URL expired' } }, 400);
  }
  const expected = signUpload(key, expiresAt);
  if (sig.length !== expected.length) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Bad upload signature' } }, 403);
  }
  let different = 0;
  for (let index = 0; index < expected.length; index += 1) {
    different |= sig.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  if (different !== 0) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Bad upload signature' } }, 403);
  }
  if ((c.req.header('if-none-match') ?? '').trim() === '*' && objects.has(key)) {
    return c.json({ error: { code: 'CONFLICT', message: 'Object exists' } }, 412);
  }
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  objects.set(key, {
    bytes,
    contentType: c.req.header('content-type') ?? 'application/octet-stream',
  });
  return c.json({ ok: true });
});
app.route('/', uploads);

const server = serve({ fetch: app.fetch, port: PORT });
server.once('listening', () => {
  const address = server.address();
  const boundPort = typeof address === 'object' && address !== null ? address.port : PORT;
  if (!process.env.AOI_E2E_PUBLIC_BASE_URL) {
    publicBaseUrl = `http://127.0.0.1:${boundPort}`;
  }
  const manifest = {
    baseUrl: `http://127.0.0.1:${boundPort}`,
    publicBaseUrl,
    runId: RUN_ID,
    secret: SECRET,
    aliceEmail: ALICE_EMAIL,
    bobEmail: BOB_EMAIL,
    spaceId: SPACE_ID,
    dataDir: DATA_DIR,
  };
  fs.writeFileSync(path.join(DATA_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`AOI_E2E_MANIFEST=${JSON.stringify(manifest)}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
