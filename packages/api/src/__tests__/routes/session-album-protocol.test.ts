import { describe, expect, it } from 'vitest';

import { encodeBase64 } from '@aoi/shared';

import { createApp } from '../../create-app';
import { albumMediaKey } from '../../domains/album';
import { makeTestHarness, type ShimD1 } from '../../effects/test-harness';

/**
 * Route-level contract tests for the protocol router
 * (`routes/session-album-protocol.ts`). Domain semantics live in
 * domains/album-protocol.test.ts; here the wire shapes, the status codes, and
 * the fact that every route is authenticated.
 */

const USER_A = '00000000-0000-4000-8000-000000000001';
const USER_B = '00000000-0000-4000-8000-000000000002';
const SPACE_1 = '00000000-0000-4000-8000-000000000010';
const TOKEN_A = 'token-a';
const TOKEN_B = 'token-b';
const NOW = Date.parse('2026-01-15T00:00:00.000Z');
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const AT = '2026-01-15T00:00:00.000Z';

const KEY = encodeBase64(new Uint8Array(32).fill(1));
const SIG = encodeBase64(new Uint8Array(64).fill(2));
const NONCE = encodeBase64(new Uint8Array(12).fill(3));
const WRAPPED = encodeBase64(new Uint8Array(48).fill(4));

const BASE = '/v1/spaces/current/album/protocol';

const anchor = (overrides: Record<string, unknown> = {}) => ({
  spaceId: SPACE_1,
  rootDeviceId: 'device-root',
  rootSigningPublicKey: KEY,
  recoverySigningPublicKey: KEY,
  createdAt: AT,
  rootSignature: SIG,
  recoverySignature: SIG,
  ...overrides,
});

const record = (deviceId: string, overrides: Record<string, unknown> = {}) => ({
  deviceId,
  spaceId: SPACE_1,
  signingPublicKey: KEY,
  agreementPublicKey: KEY,
  authorisedBy: { kind: 'self' },
  revision: 1,
  createdAt: AT,
  authorisation: SIG,
  ...overrides,
});

function insertUser(d1: ShimD1, id: string, email: string, name: string): void {
  d1.runSync(
    'insert into users (id, email, name, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?)',
    id,
    email,
    name,
    NOW,
    NOW
  );
}

function insertSession(d1: ShimD1, id: string, userId: string, token: string): void {
  d1.runSync(
    'insert into user_sessions (id, user_id, token, expires_at, created_at, updated_at) values (?, ?, ?, ?, ?, ?)',
    id,
    userId,
    token,
    NOW + YEAR_MS,
    NOW,
    NOW
  );
}

function makeApp() {
  const harness = makeTestHarness();
  const app = createApp(harness.layer);

  insertUser(harness.d1, USER_A, 'a@example.com', 'Alice');
  insertUser(harness.d1, USER_B, 'b@example.com', 'Bob');
  insertSession(harness.d1, 'sess-a', USER_A, TOKEN_A);
  insertSession(harness.d1, 'sess-b', USER_B, TOKEN_B);
  harness.d1.runSync(
    `insert into spaces (id, name, partner_name, relationship_start_date, created_by_user_id, created_at, updated_at)
     values (?, 'Our Space', 'Partner', '2026-01-01', ?, ?, ?)`,
    SPACE_1,
    USER_A,
    NOW,
    NOW
  );
  harness.d1.runSync(
    `insert into space_members (space_id, user_id, role, state, joined_at) values (?, ?, 'you', 'active', ?)`,
    SPACE_1,
    USER_A,
    NOW
  );
  harness.d1.runSync(
    `insert into space_members (space_id, user_id, role, state, joined_at) values (?, ?, 'partner', 'active', ?)`,
    SPACE_1,
    USER_B,
    NOW
  );

  return { harness, app };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function put(app: ReturnType<typeof makeApp>['app'], path: string, token: string, body: unknown) {
  return app.request(path, {
    method: 'PUT',
    headers: { ...auth(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** A device claims its id and keys before anything is signed for it. */
async function claim(
  app: ReturnType<typeof makeApp>['app'],
  token: string,
  deviceId: string
) {
  return app.request(`${BASE}/device-claims`, {
    method: 'POST',
    headers: { ...auth(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, signingPublicKey: KEY, agreementPublicKey: KEY }),
  });
}

describe('the protocol snapshot route', () => {
  it('returns the empty shape for a Space with nothing written', async () => {
    const { app } = makeApp();
    const response = await app.request(BASE, { headers: auth(TOKEN_A) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      anchor: null,
      records: [],
      claims: [],
      offers: [],
      tombstones: [],
      envelopes: [],
      recoveryEnvelopes: [],
    });
  });

  it('requires a session', async () => {
    const { app } = makeApp();
    expect((await app.request(BASE)).status).toBe(401);
  });
});

describe('the anchor route', () => {
  it('creates once and returns the wire shape', async () => {
    const { app } = makeApp();
    const response = await put(app, `${BASE}/anchor`, TOKEN_A, anchor());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ anchor: anchor() });
  });

  it('returns the same anchor on an identical retry', async () => {
    const { app } = makeApp();
    await put(app, `${BASE}/anchor`, TOKEN_A, anchor());
    const again = await put(app, `${BASE}/anchor`, TOKEN_A, anchor());
    expect(again.status).toBe(201);
    expect(await again.json()).toEqual({ anchor: anchor() });
  });

  it('conflicts on a different anchor', async () => {
    const { app } = makeApp();
    await put(app, `${BASE}/anchor`, TOKEN_A, anchor());
    const changed = await put(app, `${BASE}/anchor`, TOKEN_A, anchor({ rootDeviceId: 'device-other' }));
    expect(changed.status).toBe(409);
  });

  it('refuses a member who did not create the Space', async () => {
    const { app } = makeApp();
    expect((await put(app, `${BASE}/anchor`, TOKEN_B, anchor())).status).toBe(403);
  });

  it('refuses a malformed body', async () => {
    const { app } = makeApp();
    expect((await put(app, `${BASE}/anchor`, TOKEN_A, { spaceId: SPACE_1 })).status).toBe(400);
  });

  it('requires a session', async () => {
    const { app } = makeApp();
    const response = await app.request(`${BASE}/anchor`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(anchor()),
    });
    expect(response.status).toBe(401);
  });
});

describe('the device claim route', () => {
  it('claims an id and returns the wire shape', async () => {
    const { app } = makeApp();
    const response = await claim(app, TOKEN_A, 'device-a');
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      claim: {
        spaceId: SPACE_1,
        deviceId: 'device-a',
        signingPublicKey: KEY,
        agreementPublicKey: KEY,
        createdAt: expect.any(String),
      },
    });
  });

  it('refuses the partner claiming the same id', async () => {
    const { app } = makeApp();
    await claim(app, TOKEN_A, 'device-a');
    expect((await claim(app, TOKEN_B, 'device-a')).status).toBe(403);
  });

  it('requires a session', async () => {
    const { app } = makeApp();
    const response = await app.request(`${BASE}/device-claims`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: 'device-a', signingPublicKey: KEY, agreementPublicKey: KEY }),
    });
    expect(response.status).toBe(401);
  });
});

describe('the device route', () => {
  it('creates a record and returns the wire shape', async () => {
    const { app } = makeApp();
    await claim(app, TOKEN_A, 'device-a');
    const response = await put(app, `${BASE}/devices/device-a`, TOKEN_A, record('device-a'));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ record: record('device-a') });
  });

  it('refuses a record for a device that has not claimed its id', async () => {
    const { app } = makeApp();
    expect((await put(app, `${BASE}/devices/device-a`, TOKEN_A, record('device-a'))).status).toBe(400);
  });

  it('lets the partner own their own device', async () => {
    const { app } = makeApp();
    await claim(app, TOKEN_A, 'device-a');
    await claim(app, TOKEN_B, 'device-b');
    expect((await put(app, `${BASE}/devices/device-a`, TOKEN_A, record('device-a'))).status).toBe(201);
    expect((await put(app, `${BASE}/devices/device-b`, TOKEN_B, record('device-b'))).status).toBe(201);
  });

  it('refuses the partner writing someone else’s device', async () => {
    const { app } = makeApp();
    await claim(app, TOKEN_A, 'device-a');
    await put(app, `${BASE}/devices/device-a`, TOKEN_A, record('device-a'));
    const theirs = await put(app, `${BASE}/devices/device-a`, TOKEN_B, record('device-a', { revision: 2 }));
    expect(theirs.status).toBe(403);
  });

  it('refuses a revision that does not move forward', async () => {
    const { app } = makeApp();
    await claim(app, TOKEN_A, 'device-a');
    await put(app, `${BASE}/devices/device-a`, TOKEN_A, record('device-a', { revision: 2 }));
    expect((await put(app, `${BASE}/devices/device-a`, TOKEN_A, record('device-a', { revision: 2 }))).status).toBe(409);
    expect((await put(app, `${BASE}/devices/device-a`, TOKEN_A, record('device-a', { revision: 1 }))).status).toBe(409);
  });
});

describe('the tombstone route', () => {
  it('accepts one from the owner of the revoking device', async () => {
    const { app } = makeApp();
    await claim(app, TOKEN_A, 'device-a');
    await put(app, `${BASE}/devices/device-a`, TOKEN_A, record('device-a'));

    const response = await app.request(`${BASE}/device-tombstones`, {
      method: 'POST',
      headers: { ...auth(TOKEN_A), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spaceId: SPACE_1,
        targetDeviceId: 'device-b',
        revision: 2,
        revokedBy: { kind: 'device', deviceId: 'device-a' },
        revokedAt: AT,
        signature: SIG,
      }),
    });
    expect(response.status).toBe(201);
  });

  it('requires a session', async () => {
    const { app } = makeApp();
    const response = await app.request(`${BASE}/device-tombstones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(401);
  });
});

describe('the envelope routes', () => {
  it('seals for a registered recipient', async () => {
    const { app } = makeApp();
    await claim(app, TOKEN_A, 'device-a');
    await claim(app, TOKEN_B, 'device-b');
    await put(app, `${BASE}/devices/device-a`, TOKEN_A, record('device-a'));
    await put(app, `${BASE}/devices/device-b`, TOKEN_B, record('device-b'));

    const response = await put(app, `${BASE}/envelopes`, TOKEN_A, {
      spaceId: SPACE_1,
      generation: 1,
      recipientDeviceId: 'device-b',
      authoriserDeviceId: 'device-a',
      recipientRevision: 1,
      nonce: NONCE,
      ciphertext: WRAPPED,
    });
    expect(response.status).toBe(201);
  });

  it('cuts a recovery envelope for a generation', async () => {
    const { app } = makeApp();
    const response = await put(app, `${BASE}/recovery-envelopes/1`, TOKEN_A, {
      spaceId: SPACE_1,
      generation: 1,
      nonce: NONCE,
      ciphertext: WRAPPED,
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      recoveryEnvelope: { spaceId: SPACE_1, generation: 1, nonce: NONCE, ciphertext: WRAPPED },
    });
  });

  it('refuses a generation the path does not agree with', async () => {
    const { app } = makeApp();
    const response = await put(app, `${BASE}/recovery-envelopes/2`, TOKEN_A, {
      spaceId: SPACE_1,
      generation: 1,
      nonce: NONCE,
      ciphertext: WRAPPED,
    });
    expect(response.status).toBe(400);
  });

  it('refuses a later generation outright, because rotation does not exist', async () => {
    const { app } = makeApp();
    const response = await put(app, `${BASE}/recovery-envelopes/2`, TOKEN_A, {
      spaceId: SPACE_1,
      generation: 2,
      nonce: NONCE,
      ciphertext: WRAPPED,
    });
    expect(response.status).toBe(400);
  });

  it('refuses a non-numeric generation', async () => {
    const { app } = makeApp();
    const response = await put(app, `${BASE}/recovery-envelopes/not-a-number`, TOKEN_A, {
      spaceId: SPACE_1,
      generation: 1,
      nonce: NONCE,
      ciphertext: WRAPPED,
    });
    expect(response.status).toBe(400);
  });
});

const MEDIA_BASE = `${BASE}/media`;
const TOMBSTONE_PATH = `${BASE}/media-tombstones`;
const MEDIA_1 = '00000000-0000-4000-8000-000000000101';
const MEDIA_2 = '00000000-0000-4000-8000-000000000102';

const reservationBody = (mediaId: string, overrides: Record<string, unknown> = {}) => ({
  mediaId,
  generation: 1,
  uploaderDeviceId: 'device-a',
  byteLength: 3,
  ...overrides,
});

const manifestBody = (mediaId: string, overrides: Record<string, unknown> = {}) => ({
  mediaId,
  spaceId: SPACE_1,
  generation: 1,
  revision: 1,
  wrappedKey: { nonce: NONCE, ciphertext: WRAPPED },
  sealedNonce: NONCE,
  byteLength: 3,
  mimeType: 'image/jpeg',
  uploaderDeviceId: 'device-a',
  createdAt: AT,
  signature: SIG,
  ...overrides,
});

const tombstoneBody = (mediaId: string) => ({
  spaceId: SPACE_1,
  mediaId,
  revision: 2,
  deletedAt: AT,
  deletedByDeviceId: 'device-a',
  signature: SIG,
});

async function post(app: ReturnType<typeof makeApp>['app'], path: string, token: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { ...auth(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Enrol Alice's uploader, then reserve → upload → finalise one media. */
async function publishableMedia(
  harness: ReturnType<typeof makeApp>['harness'],
  app: ReturnType<typeof makeApp>['app'],
  mediaId: string
) {
  await claim(app, TOKEN_A, 'device-a');
  await put(app, `${BASE}/devices/device-a`, TOKEN_A, record('device-a'));
  expect((await post(app, MEDIA_BASE, TOKEN_A, reservationBody(mediaId))).status).toBe(201);
  harness.r2.putSync(
    albumMediaKey(SPACE_1, mediaId),
    new Uint8Array(3).fill(9),
    'application/octet-stream'
  );
  expect((await post(app, `${MEDIA_BASE}/${mediaId}/complete`, TOKEN_A, {})).status).toBe(200);
}

describe('the media protocol route', () => {
  it('returns the empty shape and requires a session', async () => {
    const { app } = makeApp();
    const response = await app.request(MEDIA_BASE, { headers: auth(TOKEN_A) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ manifests: [], nextCursor: null, tombstones: [] });
    expect((await app.request(MEDIA_BASE)).status).toBe(401);
  });

  it('reserves, finalises, publishes a manifest, and reads it back', async () => {
    const { harness, app } = makeApp();
    await publishableMedia(harness, app, MEDIA_1);

    const created = await put(
      app,
      `${MEDIA_BASE}/${MEDIA_1}/manifest`,
      TOKEN_A,
      manifestBody(MEDIA_1)
    );
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ manifest: manifestBody(MEDIA_1) });

    const read = await app.request(MEDIA_BASE, { headers: auth(TOKEN_A) });
    expect(await read.json()).toEqual({
      manifests: [manifestBody(MEDIA_1)],
      nextCursor: null,
      tombstones: [],
    });
  });

  it('refuses a reservation with a malformed id, and one with no session', async () => {
    const { harness, app } = makeApp();
    await claim(app, TOKEN_A, 'device-a');
    await put(app, `${BASE}/devices/device-a`, TOKEN_A, record('device-a'));

    expect((await post(app, MEDIA_BASE, TOKEN_A, reservationBody('media-1'))).status).toBe(400);
    const anon = await app.request(MEDIA_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reservationBody(MEDIA_1)),
    });
    expect(anon.status).toBe(401);
  });

  it('refuses a manifest whose body and path disagree, and a malformed body', async () => {
    const { harness, app } = makeApp();
    await publishableMedia(harness, app, MEDIA_1);
    expect(
      (await put(app, `${MEDIA_BASE}/${MEDIA_2}/manifest`, TOKEN_A, manifestBody(MEDIA_1))).status
    ).toBe(400);
    expect(
      (await put(app, `${MEDIA_BASE}/${MEDIA_1}/manifest`, TOKEN_A, { mediaId: MEDIA_1 })).status
    ).toBe(400);
  });

  it('refuses a manifest with no session', async () => {
    const { app } = makeApp();
    const response = await app.request(`${MEDIA_BASE}/${MEDIA_1}/manifest`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(manifestBody(MEDIA_1)),
    });
    expect(response.status).toBe(401);
  });

  it('accepts a tombstone candidate for media the Space has', async () => {
    const { harness, app } = makeApp();
    await publishableMedia(harness, app, MEDIA_1);
    await put(app, `${MEDIA_BASE}/${MEDIA_1}/manifest`, TOKEN_A, manifestBody(MEDIA_1));

    const response = await post(app, TOMBSTONE_PATH, TOKEN_A, tombstoneBody(MEDIA_1));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ tombstone: tombstoneBody(MEDIA_1) });
  });

  it('refuses a malformed tombstone and a tombstone with no session', async () => {
    const { app } = makeApp();
    expect((await post(app, TOMBSTONE_PATH, TOKEN_A, { spaceId: SPACE_1 })).status).toBe(400);
    const anon = await app.request(TOMBSTONE_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(anon.status).toBe(401);
  });

  it('serves the sealed object for a completed, manifested media', async () => {
    const { harness, app } = makeApp();
    await publishableMedia(harness, app, MEDIA_1);
    await put(app, `${MEDIA_BASE}/${MEDIA_1}/manifest`, TOKEN_A, manifestBody(MEDIA_1));

    const response = await app.request(`${MEDIA_BASE}/${MEDIA_1}/object`, {
      headers: auth(TOKEN_A),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    expect((await response.arrayBuffer()).byteLength).toBe(3);
  });

  it('refuses the object route without a manifest, and without a session', async () => {
    const { harness, app } = makeApp();
    await publishableMedia(harness, app, MEDIA_1);

    expect(
      (await app.request(`${MEDIA_BASE}/${MEDIA_1}/object`, { headers: auth(TOKEN_A) })).status
    ).toBe(404);
    expect((await app.request(`${MEDIA_BASE}/${MEDIA_1}/object`)).status).toBe(401);
  });
});
