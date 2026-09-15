import { describe, expect, it } from 'vitest';

import { createApp } from '../../create-app';
import { makeTestHarness, type ShimD1 } from '../../effects/test-harness';

/**
 * P8B quota/allowance enforcement through the worker shell:
 * - media quota is guarded at the upload-intent boundary, atomically;
 * - future-letter allowance is guarded at seal time, atomically;
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
    body: JSON.stringify({ name: 'Our Space' }),
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

describe('downgrade preserves everything readable', () => {
  it('over-quota downgrade keeps reads, notes, and letters working', async () => {
    const { app, harness } = makeApp();
    const { spaceId } = await setupPairedSpace(app, harness);
    insertPlus(harness.d1, spaceId, USER_A, NOW + 365 * 24 * 60 * 60 * 1000);
    insertMedia(harness.d1, 'm-big', spaceId, USER_A, 240 * MIB);
    insertMedia(harness.d1, 'm-big-2', spaceId, USER_A, 20 * MIB);

    // Two future letters while Plus.
    const first = await app.request('/v1/spaces/current/letters', sealBody(30));
    expect(first.status).toBe(201);
    const second = await app.request('/v1/spaces/current/letters', sealBody(60));
    expect(second.status).toBe(201);
    const firstBody = (await first.json()) as { id: string };

    // Downgrade: entitlement row lapses.
    harness.d1.runSync('delete from space_plus_entitlements where space_id = ?', spaceId);

    // Existing photo still serves.
    const plus = await app.request('/v1/spaces/current/plus', { headers: auth(TOKEN_A) });
    expect(((await plus.json()) as { isPlus: boolean }).isPlus).toBe(false);

    // Text-note creation still works while over media quota.
    const note = await app.request('/v1/spaces/current/moments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify({ type: 'note', title: 'Still here', body: 'Words are free.' }),
    });
    expect(note.status).toBe(201);

    // Existing future letters stay scheduled and openable.
    const shelf = await app.request('/v1/spaces/current/letters', { headers: auth(TOKEN_A) });
    expect(((await shelf.json()) as { letters: unknown[] }).letters).toHaveLength(2);

    // New photo upload blocked; new future letter blocked.
    const blockedUpload = await app.request('/v1/media/upload-url', intentBody(1 * MIB));
    expect(blockedUpload.status).toBe(403);
    const blockedSeal = await app.request('/v1/spaces/current/letters', sealBody(90));
    expect(blockedSeal.status).toBe(403);
    expect(((await blockedSeal.json()) as { error: { code: string } }).error.code).toBe(
      'LIMIT_EXCEEDED'
    );
  });

  it('Plus expiry never blocks opening an already-due letter', async () => {
    const { app, harness } = makeApp();
    await setupPairedSpace(app, harness);
    const current = (await (
      await app.request('/v1/spaces/current', { headers: auth(TOKEN_A) })
    ).json()) as { space: { id: string } };
    insertPlus(harness.d1, current.space.id, USER_A, NOW + 365 * 24 * 60 * 60 * 1000);

    const sealed = await app.request(
      '/v1/spaces/current/letters',
      sealBody(1 / 24 / 60)
    );
    expect(sealed.status).toBe(201);
    const { id } = (await sealed.json()) as { id: string };

    // Downgrade, then let the letter come due: opening stays available.
    // (Test clock is frozen — advance it instead of sleeping.)
    harness.d1.runSync('delete from space_plus_entitlements');
    harness.clock.advance(120 * 1000);
    const opened = await app.request(`/v1/letters/${id}/open`, {
      method: 'POST',
      headers: auth(TOKEN_A),
    });
    expect(opened.status).toBe(200);
    expect(((await opened.json()) as { isOpened: boolean }).isOpened).toBe(true);
  });
});

describe('future-letter allowance', () => {
  it('Free first active future letter succeeds', async () => {
    const { app, harness } = makeApp();
    await setupPairedSpace(app, harness);

    const res = await app.request('/v1/spaces/current/letters', sealBody(30));
    expect(res.status).toBe(201);
  });

  it('Free second active future letter is rejected with a typed limit', async () => {
    const { app, harness } = makeApp();
    await setupPairedSpace(app, harness);

    const first = await app.request('/v1/spaces/current/letters', sealBody(30));
    expect(first.status).toBe(201);
    const second = await app.request('/v1/spaces/current/letters', sealBody(60));
    expect(second.status).toBe(403);
    const body = (await second.json()) as {
      error: { code: string; details: Record<string, number | string> };
    };
    expect(body.error.code).toBe('LIMIT_EXCEEDED');
    expect(body.error.details).toMatchObject({ kind: 'future_letters', usedCount: 1, limitCount: 1 });
  });

  it('concurrent seals cannot bypass the allowance', async () => {
    const { app, harness } = makeApp();
    await setupPairedSpace(app, harness);

    const [first, second] = await Promise.all([
      app.request('/v1/spaces/current/letters', sealBody(30)),
      app.request('/v1/spaces/current/letters', sealBody(60)),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 403]);
  });

  it('Plus future letters are not count-limited', async () => {
    const { app, harness } = makeApp();
    const { spaceId } = await setupPairedSpace(app, harness);
    insertPlus(harness.d1, spaceId, USER_A, NOW + 365 * 24 * 60 * 60 * 1000);

    for (const days of [30, 60, 90]) {
      const res = await app.request('/v1/spaces/current/letters', sealBody(days));
      expect(res.status).toBe(201);
    }
  });

  it('opening frees the Free slot for the next future letter', async () => {
    const { app, harness } = makeApp();
    const { spaceId } = await setupPairedSpace(app, harness);
    void spaceId;

    // Seal a letter due almost immediately (sealedUntil must be future).
    const dueSoon = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify({
        caption: 'Soon',
        body: 'Opens any moment now.',
        sealedUntil: new Date(Date.now() + 2000).toISOString(),
      }),
    } as const;
    const first = await app.request('/v1/spaces/current/letters', dueSoon);
    expect(first.status).toBe(201);
    const { id } = (await first.json()) as { id: string };

    // Not due yet: opening refuses, slot stays occupied.
    const early = await app.request(`/v1/letters/${id}/open`, {
      method: 'POST',
      headers: auth(TOKEN_A),
    });
    expect(early.status).toBe(400);
    const blocked = await app.request('/v1/spaces/current/letters', sealBody(60));
    expect(blocked.status).toBe(403);
  });
});

describe('usage read is identical for both partners', () => {
  it('both members observe the same quota/usage state', async () => {
    const { app, harness } = makeApp();
    const { spaceId } = await setupPairedSpace(app, harness);
    insertMedia(harness.d1, 'm-1', spaceId, USER_A, 40 * MIB);

    const asA = (await (
      await app.request('/v1/spaces/current/plus', { headers: auth(TOKEN_A) })
    ).json()) as Record<string, unknown>;
    const asB = (await (
      await app.request('/v1/spaces/current/plus', { headers: auth(TOKEN_B) })
    ).json()) as Record<string, unknown>;

    expect(asA).toEqual(asB);
    expect(asA).toMatchObject({
      isPlus: false,
      mediaUsedBytes: 40 * MIB,
      mediaLimitBytes: FREE_QUOTA,
      activeFutureLetters: 0,
      futureLetterLimit: 1,
    });
  });
});
