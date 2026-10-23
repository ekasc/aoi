import { afterEach, describe, expect, it } from 'vitest';

import { MOMENT_RECONCILE_LIMIT, momentListResponseSchema, momentSchema, reconcileMomentsResponseSchema } from '@aoi/shared';

import { createApp } from '../../packages/api/src/create-app';
import { makeTestHarness } from '../../packages/api/src/effects/test-harness';

const NOW = Date.parse('2026-01-15T00:00:00.000Z');
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const C = '00000000-0000-4000-8000-000000000003';
const SPACE = '00000000-0000-4000-8000-000000000010';
const FOREIGN_SPACE = '00000000-0000-4000-8000-000000000011';
const PATH = '/v1/spaces/current/moments/reconcile';
const harnesses: ReturnType<typeof makeTestHarness>[] = [];

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.d1.rawDb.close();
});

function setup() {
  const harness = makeTestHarness();
  harnesses.push(harness);
  for (const [id, name] of [[A, 'Alice'], [B, 'Bob'], [C, 'Carol']]) {
    harness.d1.runSync(
      'insert into users (id, email, name, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?)',
      id, `${name}@example.com`, name, NOW, NOW
    );
    harness.d1.runSync(
      'insert into user_sessions (id, user_id, token, expires_at, created_at, updated_at) values (?, ?, ?, ?, ?, ?)',
      `session-${id}`, id, `token-${id}`, NOW + 86_400_000, NOW, NOW
    );
  }
  for (const [spaceId, userId] of [[SPACE, A], [FOREIGN_SPACE, C]]) {
    harness.d1.runSync(
      `insert into spaces (id, name, partner_name, relationship_start_date, created_by_user_id, created_at, updated_at)
       values (?, 'Space', 'Partner', '2026-01-01', ?, ?, ?)`, spaceId, userId, NOW, NOW
    );
    harness.d1.runSync(
      `insert into space_members (space_id, user_id, role, state, joined_at) values (?, ?, 'you', 'active', ?)`,
      spaceId, userId, NOW
    );
  }
  harness.d1.runSync(
    `insert into space_members (space_id, user_id, role, state, joined_at) values (?, ?, 'partner', 'active', ?)`,
    SPACE, B, NOW
  );
  const app = createApp(harness.layer);
  const request = (path: string, userId: string | null, method = 'GET', body?: unknown) =>
    app.request(path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(userId ? { Authorization: `Bearer token-${userId}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const reconcile = (ids: string[], userId = A) => request(PATH, userId, 'POST', { ids });
  const insert = (id: string, occurredAt: number, spaceId = SPACE, authorId = B) =>
    harness.d1.runSync(
      `insert into moments (id, space_id, created_by_user_id, author_role, author_name, type, title, body, occurred_at, created_at, updated_at)
       values (?, ?, ?, 'you', 'You', 'note', '', '', ?, ?, ?)`,
      id, spaceId, authorId, occurredAt, occurredAt, occurredAt
    );
  return { harness, request, reconcile, insert };
}

describe('POST moments/reconcile', () => {
  it('refreshes loaded ids across pages after edits, redates and deletion without writing', async () => {
    const ctx = setup();
    const ids = Array.from({ length: 6 }, (_, i) => `00000000-0000-4000-8000-${String(i + 100).padStart(12, '0')}`);
    ids.forEach((id, i) => ctx.insert(id, NOW - i * 1000));
    const first = momentListResponseSchema.parse(await (await ctx.request('/v1/spaces/current/moments?limit=3', A)).json());
    const second = momentListResponseSchema.parse(await (await ctx.request(`/v1/spaces/current/moments?limit=3&cursor=${encodeURIComponent(first.nextCursor ?? '')}`, A)).json());
    const loaded = [...first.moments, ...second.moments];
    expect(loaded.map((m) => m.id)).toEqual(ids);
    const edited = await ctx.request(`/v1/moments/${ids[4]}`, B, 'PATCH', { expectedUpdatedAt: loaded[4].updatedAt, body: 'Revised older memory', occurredAt: new Date(NOW + 1000).toISOString() });
    expect(edited.status).toBe(200);
    const expected = momentSchema.parse(await edited.json());
    expect((await ctx.request(`/v1/moments/${ids[1]}`, B, 'DELETE', { expectedUpdatedAt: loaded[1].updatedAt })).status).toBe(200);
    const changes = ctx.harness.d1.rawDb.prepare('select total_changes() as n').get();
    const queueLength = ctx.harness.capturedQueue.length;
    const response = await ctx.reconcile(ids);
    expect(response.status).toBe(200);
    const result = reconcileMomentsResponseSchema.parse(await response.json());
    expect(new Set(result.moments.map((m) => m.id))).toEqual(new Set(ids.filter((id) => id !== ids[1])));
    expect(result.moments.find((m) => m.id === ids[4])).toMatchObject({
      body: expected.body, occurredAt: expected.occurredAt, updatedAt: expected.updatedAt,
      isOwn: false, authorRole: 'partner', authorName: 'Bob',
    });
    expect(ctx.harness.d1.rawDb.prepare('select total_changes() as n').get()).toEqual(changes);
    expect(ctx.harness.capturedQueue).toHaveLength(queueLength);
  });

  it('omits missing and foreign ids and returns nothing to inactive members', async () => {
    const ctx = setup();
    const own = '00000000-0000-4000-8000-000000000101';
    const foreign = '00000000-0000-4000-8000-000000000102';
    const missing = '00000000-0000-4000-8000-000000000103';
    ctx.insert(own, NOW, SPACE, A);
    ctx.insert(foreign, NOW, FOREIGN_SPACE, C);
    const response = await ctx.reconcile([own, foreign, missing, own]);
    expect(response.status).toBe(200);
    const result = reconcileMomentsResponseSchema.parse(await response.json());
    expect(result.moments.map((m) => m.id)).toEqual([own]);
    expect(result.moments[0]).toMatchObject({ isOwn: true, authorRole: 'you', authorName: 'You' });
    expect(await (await ctx.reconcile([own, missing], C)).json()).toEqual({ moments: [] });
    ctx.harness.d1.runSync(`update space_members set state = 'left' where user_id = ?`, A);
    expect(await (await ctx.reconcile([own], A)).json()).toEqual({ moments: [] });
  });

  it('accepts the bounded maximum and rejects malformed, empty, oversized and extra-field requests', async () => {
    const ctx = setup();
    const id = '00000000-0000-4000-8000-000000000101';
    const ids = Array.from({ length: MOMENT_RECONCILE_LIMIT }, (_, i) => `00000000-0000-4000-8000-${String(i + 100).padStart(12, '0')}`);
    ids.forEach((momentId) => ctx.insert(momentId, NOW));
    const maximum = await ctx.reconcile(ids);
    expect(maximum.status).toBe(200);
    expect(reconcileMomentsResponseSchema.parse(await maximum.json()).moments).toHaveLength(MOMENT_RECONCILE_LIMIT);
    for (const body of [{ ids: [] }, { ids: ['invalid'] }, { ids: Array(MOMENT_RECONCILE_LIMIT + 1).fill(id) }, { ids: [id], spaceId: FOREIGN_SPACE }, {}]) {
      expect((await ctx.request(PATH, A, 'POST', body)).status).toBe(400);
    }
    expect((await ctx.request(PATH, null, 'POST', { ids: [id] })).status).toBe(401);
  });

  it('returns ordered attachments and legacy media through the existing authorized read shape', async () => {
    const ctx = setup();
    const ordered = '00000000-0000-4000-8000-000000000101';
    const legacy = '00000000-0000-4000-8000-000000000102';
    const image = '00000000-0000-4000-8000-000000000201';
    const audio = '00000000-0000-4000-8000-000000000202';
    ctx.insert(ordered, NOW);
    ctx.insert(legacy, NOW);
    for (const [id, mime] of [[image, 'image/png'], [audio, 'audio/mp4']]) {
      ctx.harness.d1.runSync(
        `insert into media_objects (id, space_id, created_by_user_id, filename, mime_type, size_bytes, storage_key, upload_state, created_at)
         values (?, ?, ?, 'file', ?, 10, ?, 'complete', ?)`,
        id, SPACE, B, mime, `media/${id}`, NOW
      );
    }
    ctx.harness.d1.runSync(`insert into moment_attachments (moment_id, media_id, position, kind) values (?, ?, 1, 'image'), (?, ?, 0, 'audio')`, ordered, image, ordered, audio);
    ctx.harness.d1.runSync('update moments set media_id = ? where id = ?', image, legacy);
    const result = reconcileMomentsResponseSchema.parse(await (await ctx.reconcile([ordered, legacy])).json());
    expect(result.moments.find((m) => m.id === ordered)?.attachments).toEqual([
      { mediaId: audio, kind: 'audio', url: `/v1/media/${audio}/object?variant=original` },
      { mediaId: image, kind: 'image', url: `/v1/media/${image}/object?variant=display` },
    ]);
    expect(result.moments.find((m) => m.id === legacy)?.attachments).toEqual([
      { mediaId: image, kind: 'image', url: `/v1/media/${image}/object?variant=display` },
    ]);
  });
});
