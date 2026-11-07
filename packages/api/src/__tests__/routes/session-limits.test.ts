import { describe, expect, it } from 'vitest';

import { createApp } from '../../create-app';
import { makeTestHarness, type ShimD1 } from '../../effects/test-harness';

/**
 * P8B quota/allowance enforcement through the worker shell:
 * - media quota is guarded at the upload-intent boundary, atomically;
 * - downgrades never touch existing content or reads;
 * - usage reads are identical for both partners.
 */

const USER_A = '00000000-0000-4000-8000-000000000001';
const USER_B = '00000000-0000-4000-8000-000000000002';
const TOKEN_A = 'token-a';
const TOKEN_B = 'token-b';
const NOW = Date.parse('2026-01-15T00:00:00.000Z');
const MIB = 1024 * 1024;
const FREE_QUOTA = 250 * MIB;

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
    NOW + 365 * 24 * 60 * 60 * 1000,
    NOW,
    NOW
  );
}

function insertMedia(
  d1: ShimD1,
  id: string,
  spaceId: string,
  userId: string,
  sizeBytes: number,
  state = 'complete'
): void {
  d1.runSync(
    `insert into media_objects
       (id, space_id, created_by_user_id, filename, mime_type, size_bytes,
        storage_key, upload_state, created_at)
     values (?, ?, ?, 'photo.jpg', 'image/jpeg', ?, ?, ?, ?)`,
    id,
    spaceId,
    userId,
    sizeBytes,
    `media/${id}/original.jpg`,
    state,
    NOW
  );
}

function insertPlus(d1: ShimD1, spaceId: string, userId: string, expiresAt: number | null): void {
  d1.runSync(
    `insert into space_plus_entitlements
       (space_id, purchaser_user_id, provider, entitlement_id, product_id,
        expires_at, status, last_event_id, last_event_at_ms, created_at, updated_at)
     values (?, ?, 'revenuecat', 'plus', 'aoi_plus_monthly', ?, 'active', 'evt-test', ?, ?, ?)`,
    spaceId,
    userId,
    expiresAt,
    NOW,
    NOW,
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

async function setupPairedSpace(
  app: ReturnType<typeof makeApp>['app'],
  harness: ReturnType<typeof makeApp>['harness']
): Promise<{ spaceId: string }> {
  insertUser(harness.d1, USER_A, 'aoi@example.com', 'Aoi');
  insertUser(harness.d1, USER_B, 'partner@example.com', 'Partner');
  insertSession(harness.d1, 'sess-a', USER_A, TOKEN_A);
  insertSession(harness.d1, 'sess-b', USER_B, TOKEN_B);

  const created = await app.request('/v1/spaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
    body: JSON.stringify({ name: 'Our Space', partnerName: 'Partner' }),
  });
  expect(created.status).toBe(201);
  const createdBody = (await created.json()) as { space: { id: string }; inviteCode: string };
  const join = await app.request('/v1/spaces/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(TOKEN_B) },
    body: JSON.stringify({ inviteCode: createdBody.inviteCode }),
  });
  expect(join.status).toBe(200);
  return { spaceId: createdBody.space.id };
}

function intentBody(sizeBytes: number) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
    body: JSON.stringify({
      filename: 'photo.jpg',
      mimeType: 'image/jpeg',
      sizeBytes,
      kind: 'image',
    }),
  } as const;
}

function sealBody(daysOut = 30) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
    body: JSON.stringify({
      caption: 'For later',
      body: 'Remember this day.',
      sealedUntil: new Date(NOW + daysOut * 24 * 60 * 60 * 1000).toISOString(),
    }),
  } as const;
}

describe('media quota at the upload-intent boundary', () => {
  it('Free photo upload below 250 MiB succeeds', async () => {
    const { app, harness } = makeApp();
    await setupPairedSpace(app, harness);

    const res = await app.request('/v1/media/upload-url', intentBody(10 * MIB));
    expect(res.status).toBe(201);
    expect((await res.json()).mediaId).toBeTruthy();
  });

  it('upload crossing Free quota is rejected before object publication', async () => {
    const { app, harness } = makeApp();
    const { spaceId } = await setupPairedSpace(app, harness);
    insertMedia(harness.d1, 'm-existing', spaceId, USER_A, 240 * MIB);

    const res = await app.request('/v1/media/upload-url', intentBody(20 * MIB));
    expect(res.status).toBe(403);
    const body = (await res.json()) as {
      error: { code: string; message: string; details: Record<string, number | string> };
    };
    expect(body.error.code).toBe('LIMIT_EXCEEDED');
    expect(body.error.details).toMatchObject({
      kind: 'media_quota',
      usedBytes: 240 * MIB,
      limitBytes: FREE_QUOTA,
    });

    // Rejected intent publishes nothing: no row, no presigned side effects.
    const rows = harness.d1.rawDb
      .prepare('select count(*) as n from media_objects where space_id = ?')
      .get(spaceId) as { n: number };
    expect(rows.n).toBe(1);
  });

  it('Plus uses the 5 GiB limit', async () => {
    const { app, harness } = makeApp();
    const { spaceId } = await setupPairedSpace(app, harness);
    insertPlus(harness.d1, spaceId, USER_A, NOW + 365 * 24 * 60 * 60 * 1000);
    insertMedia(harness.d1, 'm-big', spaceId, USER_A, 240 * MIB);

    const res = await app.request('/v1/media/upload-url', intentBody(20 * MIB));
    expect(res.status).toBe(201);
  });

  it('concurrent uploads cannot race past quota', async () => {
    const { app, harness } = makeApp();
    const { spaceId } = await setupPairedSpace(app, harness);
    insertMedia(harness.d1, 'm-existing', spaceId, USER_A, 240 * MIB);

    const [first, second] = await Promise.all([
      app.request('/v1/media/upload-url', intentBody(10 * MIB)),
      app.request('/v1/media/upload-url', intentBody(10 * MIB)),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 403]);

    const rows = harness.d1.rawDb
      .prepare('select count(*) as n from media_objects where space_id = ?')
      .get(spaceId) as { n: number };
    expect(rows.n).toBe(2);
  });

  it('complete reconciles stored size to the real object size', async () => {
    const { app, harness } = makeApp();
    const { spaceId } = await setupPairedSpace(app, harness);

    // Declared 10 MiB but only 1 MiB lands: usage must reflect reality.
    const intent = await app.request('/v1/media/upload-url', intentBody(10 * MIB));
    expect(intent.status).toBe(201);
    const { mediaId } = (await intent.json()) as { mediaId: string };

    harness.r2.putSync(`media/${mediaId}/original.jpg`, new Uint8Array(1 * MIB), 'image/jpeg');
    const complete = await app.request(`/v1/media/${mediaId}/complete`, {
      method: 'POST',
      headers: auth(TOKEN_A),
    });
    expect(complete.status).toBe(200);

    const row = harness.d1.rawDb
      .prepare('select size_bytes from media_objects where id = ?')
      .get(mediaId) as { size_bytes: number };
    expect(row.size_bytes).toBe(1 * MIB);

    // And a follow-up intent sees the freed room.
    insertMedia(harness.d1, 'm-fill', spaceId, USER_A, 240 * MIB);
    const retry = await app.request('/v1/media/upload-url', intentBody(9 * MIB));
    expect(retry.status).toBe(201);
  });
});



