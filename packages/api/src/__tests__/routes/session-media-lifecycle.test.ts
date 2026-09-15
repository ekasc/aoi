import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../create-app';
import { makeTestHarness, type ShimD1 } from '../../effects/test-harness';
import { mediaPurgeProgram, MEDIA_SOFT_DELETE_PURGE_MS } from '../../programs/cron';
import { mediaOriginalKey } from '../../domains/media';

/**
 * Media lifecycle (Astra #7): deleting a memory must eventually stop
 * charging the Space for media no live content references — without
 * deleting media still referenced elsewhere. Logical deletion releases
 * quota immediately; physical R2 deletion stays retryable via the purge.
 */

const USER_A = '00000000-0000-4000-8000-000000000001';
const USER_B = '00000000-0000-4000-8000-000000000002';
const TOKEN_A = 'token-a';
const TOKEN_B = 'token-b';
const NOW = Date.parse('2026-01-15T00:00:00.000Z');
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const MEDIA_A = '00000000-0000-4000-8000-0000000000a1';
const MEDIA_B = '00000000-0000-4000-8000-0000000000a2';
const SIZE = 1_000_000;

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
  return { harness, app };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function setupPairedSpace(
  app: ReturnType<typeof makeApp>['app'],
  harness: ReturnType<typeof makeApp>['harness']
): Promise<string> {
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
  const { inviteCode, space } = (await created.json()) as {
    inviteCode: string;
    space: { id: string };
  };
  const join = await app.request('/v1/spaces/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(TOKEN_B) },
    body: JSON.stringify({ inviteCode }),
  });
  expect(join.status).toBe(200);
  return space.id;
}

function insertCompleteMedia(
  harness: ReturnType<typeof makeApp>['harness'],
  spaceId: string,
  mediaId: string,
  size = SIZE
): string {
  const key = mediaOriginalKey(mediaId, 'image/png');
  harness.d1.runSync(
    `insert into media_objects (id, space_id, created_by_user_id, filename, mime_type,
       size_bytes, storage_key, upload_state, created_at)
     values (?, ?, ?, 'photo.png', 'image/png', ?, ?, 'complete', ?)`,
    mediaId,
    spaceId,
    USER_A,
    size,
    key,
    NOW
  );
  harness.r2.putSync(key, new Uint8Array([137, 80, 78, 71]));
  return key;
}

function insertPendingMedia(
  harness: ReturnType<typeof makeApp>['harness'],
  spaceId: string,
  mediaId: string,
  size = SIZE
): string {
  const key = mediaOriginalKey(mediaId, 'image/png');
  harness.d1.runSync(
    `insert into media_objects (id, space_id, created_by_user_id, filename, mime_type,
       size_bytes, storage_key, upload_state, created_at)
     values (?, ?, ?, 'photo.png', 'image/png', ?, ?, 'pending', ?)`,
    mediaId,
    spaceId,
    USER_A,
    size,
    key,
    NOW
  );
  return key;
}

async function createPhotoMoment(
  app: ReturnType<typeof makeApp>['app'],
  token: string,
  mediaId: string,
  clientId: string
): Promise<string> {
  const res = await app.request('/v1/spaces/current/moments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    body: JSON.stringify({ type: 'media', title: 'Lake', mediaId, clientId }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string };
  return body.id;
}

async function mediaUsedBytes(app: ReturnType<typeof makeApp>['app'], token: string): Promise<number> {
  const res = await app.request('/v1/spaces/current/plus', { headers: auth(token) });
  expect(res.status).toBe(200);
  return ((await res.json()) as { mediaUsedBytes: number }).mediaUsedBytes;
}

function mediaRow(harness: ReturnType<typeof makeApp>['harness'], mediaId: string) {
  return harness.d1.rawDb
    .prepare('select deleted_at, upload_state from media_objects where id = ?')
    .get(mediaId) as { deleted_at: number | null; upload_state: string } | undefined;
}

describe('moment deletion releases unreferenced media', () => {
  it('deleting a photo moment tombstones its media: quota drops now, R2 stays, serve 404s', async () => {
    const { harness, app } = makeApp();
    const spaceId = await setupPairedSpace(app, harness);
    const key = insertCompleteMedia(harness, spaceId, MEDIA_A);
    const momentId = await createPhotoMoment(app, TOKEN_A, MEDIA_A, 'client-del-1');
    expect(await mediaUsedBytes(app, TOKEN_A)).toBe(SIZE);

    const deleted = await app.request(`/v1/moments/${momentId}`, {
      method: 'DELETE',
      headers: auth(TOKEN_A),
    });
    expect(deleted.status).toBe(200);

    // Logical deletion: quota released immediately…
    const row = mediaRow(harness, MEDIA_A);
    expect(row?.deleted_at).toBeTypeOf('number');
    expect(await mediaUsedBytes(app, TOKEN_A)).toBe(0);
    // …but the authoritative R2 reference is kept for the retryable purge…
    expect(harness.r2.objects.has(key)).toBe(true);
    // …and reads stay unavailable per current semantics.
    const serve = await app.request(`/v1/media/${MEDIA_A}/object?variant=original`, {
      headers: auth(TOKEN_B),
    });
    expect(serve.status).toBe(404);
  });

  it('media still referenced by another live moment is not tombstoned', async () => {
    const { harness, app } = makeApp();
    const spaceId = await setupPairedSpace(app, harness);
    insertCompleteMedia(harness, spaceId, MEDIA_A);
    const first = await createPhotoMoment(app, TOKEN_A, MEDIA_A, 'client-shared-1');
    await createPhotoMoment(app, TOKEN_B, MEDIA_A, 'client-shared-2');
    expect(await mediaUsedBytes(app, TOKEN_A)).toBe(SIZE);

    const deleted = await app.request(`/v1/moments/${first}`, {
      method: 'DELETE',
      headers: auth(TOKEN_A),
    });
    expect(deleted.status).toBe(200);

    expect(mediaRow(harness, MEDIA_A)?.deleted_at).toBeNull();
    expect(await mediaUsedBytes(app, TOKEN_A)).toBe(SIZE);
    const serve = await app.request(`/v1/media/${MEDIA_A}/object?variant=original`, {
      headers: auth(TOKEN_B),
    });
    expect(serve.status).toBe(200);
  });

  it('repeated moment deletion is idempotent (404, media state stable)', async () => {
    const { harness, app } = makeApp();
    const spaceId = await setupPairedSpace(app, harness);
    insertCompleteMedia(harness, spaceId, MEDIA_A);
    const momentId = await createPhotoMoment(app, TOKEN_A, MEDIA_A, 'client-repeat-1');
    expect((await app.request(`/v1/moments/${momentId}`, { method: 'DELETE', headers: auth(TOKEN_A) })).status).toBe(
      200
    );
    const tombstonedAt = mediaRow(harness, MEDIA_A)?.deleted_at;

    const again = await app.request(`/v1/moments/${momentId}`, {
      method: 'DELETE',
      headers: auth(TOKEN_A),
    });
    expect(again.status).toBe(404);
    expect(mediaRow(harness, MEDIA_A)?.deleted_at).toBe(tombstonedAt);
    expect(await mediaUsedBytes(app, TOKEN_A)).toBe(0);
  });

  it('replacing moment media releases the old row without stranding quota', async () => {
    const { harness, app } = makeApp();
    const spaceId = await setupPairedSpace(app, harness);
    insertCompleteMedia(harness, spaceId, MEDIA_A);
    insertCompleteMedia(harness, spaceId, MEDIA_B);
    const momentId = await createPhotoMoment(app, TOKEN_A, MEDIA_A, 'client-replace-1');
    expect(await mediaUsedBytes(app, TOKEN_A)).toBe(2 * SIZE);

    const updated = await app.request(`/v1/moments/${momentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify({ mediaId: MEDIA_B }),
    });
    expect(updated.status).toBe(200);

    expect(mediaRow(harness, MEDIA_A)?.deleted_at).toBeTypeOf('number');
    expect(mediaRow(harness, MEDIA_B)?.deleted_at).toBeNull();
    // One live reference's worth of quota — the old row stopped counting.
    expect(await mediaUsedBytes(app, TOKEN_A)).toBe(SIZE);
  });

  it('a reference created before the delete wins; creating onto dead media fails honestly', async () => {
    const { harness, app } = makeApp();
    const spaceId = await setupPairedSpace(app, harness);
    insertCompleteMedia(harness, spaceId, MEDIA_A);
    const first = await createPhotoMoment(app, TOKEN_A, MEDIA_A, 'client-race-1');
    // Legitimate second reference lands first…
    const middle = await createPhotoMoment(app, TOKEN_B, MEDIA_A, 'client-race-2');
    const deleted = await app.request(`/v1/moments/${first}`, {
      method: 'DELETE',
      headers: auth(TOKEN_A),
    });
    expect(deleted.status).toBe(200);
    expect(mediaRow(harness, MEDIA_A)?.deleted_at).toBeNull();

    // …and once truly unreferenced + tombstoned, nothing can reattach to it.
    const deletedMiddle = await app.request(`/v1/moments/${middle}`, {
      method: 'DELETE',
      headers: auth(TOKEN_B),
    });
    expect(deletedMiddle.status).toBe(200);
    expect(mediaRow(harness, MEDIA_A)?.deleted_at).toBeTypeOf('number');
    const resurrect = await app.request('/v1/spaces/current/moments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify({ type: 'media', title: 'Ghost', mediaId: MEDIA_A, clientId: 'client-race-4' }),
    });
    expect(resurrect.status).toBe(404);
  });

  it('deleting a moment with pending media releases the reservation; late complete fails', async () => {
    const { harness, app } = makeApp();
    const spaceId = await setupPairedSpace(app, harness);
    insertPendingMedia(harness, spaceId, MEDIA_A);
    const momentId = await createPhotoMoment(app, TOKEN_A, MEDIA_A, 'client-pending-1');
    expect(await mediaUsedBytes(app, TOKEN_A)).toBe(SIZE);

    const deleted = await app.request(`/v1/moments/${momentId}`, {
      method: 'DELETE',
      headers: auth(TOKEN_A),
    });
    expect(deleted.status).toBe(200);
    expect(mediaRow(harness, MEDIA_A)?.deleted_at).toBeTypeOf('number');
    expect(await mediaUsedBytes(app, TOKEN_A)).toBe(0);

    const complete = await app.request(`/v1/media/${MEDIA_A}/complete`, {
      method: 'POST',
      headers: auth(TOKEN_A),
    });
    expect([400, 404]).toContain(complete.status);
  });
});

describe('physical purge after logical deletion', () => {
  async function setupDeletedMedia() {
    const { harness, app } = makeApp();
    const spaceId = await setupPairedSpace(app, harness);
    const key = insertCompleteMedia(harness, spaceId, MEDIA_A);
    const momentId = await createPhotoMoment(app, TOKEN_A, MEDIA_A, 'client-purge-1');
    const deleted = await app.request(`/v1/moments/${momentId}`, {
      method: 'DELETE',
      headers: auth(TOKEN_A),
    });
    expect(deleted.status).toBe(200);
    // Age past the soft-delete purge horizon.
    const now = harness.clock.value();
    harness.d1.runSync('update media_objects set deleted_at = ? where id = ?', now - MEDIA_SOFT_DELETE_PURGE_MS - 1000, MEDIA_A);
    return { harness, app, key };
  }

  it('purge later deletes the R2 object and the row', async () => {
    const { harness, key } = await setupDeletedMedia();
    const result = await Effect.runPromise(Effect.provide(mediaPurgeProgram, harness.layer));
    expect(result.softDeletedPurged).toBe(1);
    expect(harness.r2.objects.has(key)).toBe(false);
    expect(mediaRow(harness, MEDIA_A)).toBeUndefined();
  });

  it('R2 delete failure retains retryable media state without re-charging quota', async () => {
    const { harness, app, key } = await setupDeletedMedia();
    const origDelete = harness.r2.delete.bind(harness.r2);
    harness.r2.delete = async () => {
      throw new Error('injected R2 failure');
    };
    try {
      const result = await Effect.runPromise(Effect.provide(mediaPurgeProgram, harness.layer));
      expect(result.softDeletedPurged).toBe(0);
    } finally {
      harness.r2.delete = origDelete;
    }
    // Authoritative reference kept, object still there, quota still free.
    expect(mediaRow(harness, MEDIA_A)?.deleted_at).toBeTypeOf('number');
    expect(harness.r2.objects.has(key)).toBe(true);
    expect(await mediaUsedBytes(app, TOKEN_A)).toBe(0);

    // Next run converges.
    const retry = await Effect.runPromise(Effect.provide(mediaPurgeProgram, harness.layer));
    expect(retry.softDeletedPurged).toBe(1);
    expect(harness.r2.objects.has(key)).toBe(false);
  });
});
