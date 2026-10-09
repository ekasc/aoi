import { describe, expect, it } from 'vitest';

import { createApp } from '../../create-app';
import { makeTestHarness, type ShimD1 } from '../../effects/test-harness';
import { albumMediaKey } from '../../domains/album';

/**
 * Route-level contract tests for the worker album router
 * (`routes/session-album.ts`) — the HTTP face of the E2EE shared library.
 * Domain semantics are pinned in domains/album.test.ts; here we pin the wire
 * shapes, status codes, and the canonical error envelope.
 */

const USER_A = '00000000-0000-4000-8000-000000000001';
const USER_B = '00000000-0000-4000-8000-000000000002';
const USER_C = '00000000-0000-4000-8000-000000000003';
const SPACE_1 = '00000000-0000-4000-8000-000000000010';
const TOKEN_A = 'token-a';
const TOKEN_B = 'token-b';
const TOKEN_C = 'token-c';
const NOW = Date.parse('2026-01-15T00:00:00.000Z');
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const ALT = 'MDEyMzQ1Njc4OWFiY2RlZg==';

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

function insertSpace(d1: ShimD1, id: string, creatorId: string): void {
  d1.runSync(
    `insert into spaces (id, name, partner_name, relationship_start_date, created_by_user_id, created_at, updated_at)
     values (?, 'Our Space', 'Partner', '2026-01-01', ?, ?, ?)`,
    id,
    creatorId,
    NOW,
    NOW
  );
  d1.runSync(
    `insert into space_members (space_id, user_id, role, state, joined_at) values (?, ?, 'you', 'active', ?)`,
    id,
    creatorId,
    NOW
  );
}

function makeApp() {
  const harness = makeTestHarness();
  const app = createApp(harness.layer);
  return { harness, app };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function seedSpace(harness: ReturnType<typeof makeApp>['harness']): void {
  insertUser(harness.d1, USER_A, 'a@example.com', 'Alice');
  insertUser(harness.d1, USER_B, 'b@example.com', 'Bob');
  insertUser(harness.d1, USER_C, 'c@example.com', 'Carol');
  insertSession(harness.d1, 'sess-a', USER_A, TOKEN_A);
  insertSession(harness.d1, 'sess-b', USER_B, TOKEN_B);
  insertSession(harness.d1, 'sess-c', USER_C, TOKEN_C);
  insertSpace(harness.d1, SPACE_1, USER_A);
  harness.d1.runSync(
    `insert into space_members (space_id, user_id, role, state, joined_at) values (?, ?, 'partner', 'active', ?)`,
    SPACE_1,
    USER_B,
    NOW
  );
}

const INTENT_BODY = {
  mimeType: 'image/jpeg',
  byteLength: 4,
  sealedNonce: ALT,
  wrappedKey: { nonce: ALT, ciphertext: ALT },
  width: 10,
  height: 10,
  personTag: 'you',
};

describe('worker album routes', () => {
  it('GET /v1/spaces/current/album/media → 401 without a token', async () => {
    const { app } = makeApp();
    const res = await app.request('/v1/spaces/current/album/media');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('full lifecycle: intent → complete → list → object bytes → delete', async () => {
    const { harness, app } = makeApp();
    seedSpace(harness);

    const intent = await app.request('/v1/spaces/current/album/media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify(INTENT_BODY),
    });
    expect(intent.status).toBe(201);
    const intentBody = (await intent.json()) as { mediaId: string; uploadUrl: string; expiresInSec: number };
    expect(intentBody.mediaId).toMatch(/^[0-9a-f-]{36}$/);
    expect(intentBody.uploadUrl).toContain('X-Amz-Signature');
    expect(intentBody.expiresInSec).toBe(3600);

    // Device PUTs the sealed bytes directly to R2.
    const key = albumMediaKey(SPACE_1, intentBody.mediaId);
    harness.r2.putSync(key, new Uint8Array([1, 2, 3, 4]), 'application/octet-stream');

    const complete = await app.request(`/v1/spaces/current/album/media/${intentBody.mediaId}/complete`, {
      method: 'POST',
      headers: auth(TOKEN_A),
    });
    expect(complete.status).toBe(200);
    expect(await complete.json()).toEqual({ ok: true });

    const list = await app.request('/v1/spaces/current/album/media', { headers: auth(TOKEN_B) });
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { media: Array<Record<string, unknown>> };
    expect(listBody.media).toHaveLength(1);
    expect(listBody.media[0]).toMatchObject({
      id: intentBody.mediaId,
      wrappedKey: { nonce: ALT, ciphertext: ALT },
      sealedNonce: ALT,
      byteLength: 4,
      mimeType: 'image/jpeg',
      personTag: 'you',
      createdByUserId: USER_A,
    });

    const object = await app.request(`/v1/spaces/current/album/media/${intentBody.mediaId}/object`, {
      headers: auth(TOKEN_B),
    });
    expect(object.status).toBe(200);
    expect(object.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(object.headers.get('Cache-Control')).toBe('private, max-age=86400');
    expect(new Uint8Array(await object.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));

    const deleted = await app.request(`/v1/spaces/current/album/media/${intentBody.mediaId}`, {
      method: 'DELETE',
      headers: auth(TOKEN_B),
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ ok: true });

    const after = await app.request('/v1/spaces/current/album/media', { headers: auth(TOKEN_A) });
    expect(((await after.json()) as { media: unknown[] }).media).toHaveLength(0);
  });

  it('object → 403 for a non-member', async () => {
    const { harness, app } = makeApp();
    seedSpace(harness);
    const mediaId = '00000000-0000-4000-8000-0000000000a1';
    const key = albumMediaKey(SPACE_1, mediaId);
    harness.d1.runSync(
      `insert into album_media (id, space_id, created_by_user_id, mime_type, byte_length,
         sealed_nonce, wrapped_key_nonce, wrapped_key_ciphertext, storage_key, upload_state, created_at, completed_at)
       values (?, ?, ?, 'image/jpeg', 4, ?, ?, ?, ?, 'complete', ?, ?)`,
      mediaId,
      SPACE_1,
      USER_A,
      ALT,
      ALT,
      ALT,
      key,
      NOW,
      NOW
    );
    harness.r2.putSync(key, new Uint8Array([1, 2, 3, 4]), 'application/octet-stream');

    const res = await app.request(`/v1/spaces/current/album/media/${mediaId}/object`, {
      headers: auth(TOKEN_C),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('backup: GET default empty, PUT round-trips, malformed PUT → 400', async () => {
    const { harness, app } = makeApp();
    seedSpace(harness);

    const empty = await app.request('/v1/spaces/current/album/backup', { headers: auth(TOKEN_A) });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ identities: [], deviceKeys: [], envelopes: [] });

    const backup = {
      identities: [
        { deviceId: 'device-a', signingPublicKey: 'spk', agreementPublicKey: 'apk', createdAt: '2026-01-15T00:00:00.000Z' },
      ],
      deviceKeys: [],
      envelopes: [],
    };
    const put = await app.request('/v1/spaces/current/album/backup', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify(backup),
    });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual(backup);

    const read = await app.request('/v1/spaces/current/album/backup', { headers: auth(TOKEN_B) });
    expect(await read.json()).toEqual(backup);

    const malformed = await app.request('/v1/spaces/current/album/backup', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify({ identities: 'nope' }),
    });
    expect(malformed.status).toBe(400);
    const malformedBody = await malformed.json();
    expect(malformedBody.error.code).toBe('BAD_REQUEST');
  });
});
