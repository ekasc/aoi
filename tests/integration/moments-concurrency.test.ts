import { afterEach, describe, expect, it, vi } from 'vitest';

import { momentSchema } from '@aoi/shared';

import { createApp } from '../../packages/api/src/create-app';
import { makeTestHarness } from '../../packages/api/src/effects/test-harness';

const NOW = Date.parse('2026-01-15T00:00:00.000Z');
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A = uuid(1);
const B = uuid(2);
const SPACE = uuid(10);
const OLD = uuid(20);
const NEW = uuid(21);
const RESPONSE_MEDIA = uuid(22);
const CONFLICT = { error: { code: 'CONFLICT', message: 'This memory changed on another device. Reopen it before trying again.' } };
const harnesses: ReturnType<typeof makeTestHarness>[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const harness of harnesses.splice(0)) harness.d1.rawDb.close();
});

async function setup() {
  const harness = makeTestHarness();
  harnesses.push(harness);
  for (const [id, name] of [[A, 'Alice'], [B, 'Bob']]) {
    harness.d1.runSync('insert into users (id, email, name, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?)', id, `${name}@example.com`, name, NOW, NOW);
    harness.d1.runSync('insert into user_sessions (id, user_id, token, expires_at, created_at, updated_at) values (?, ?, ?, ?, ?, ?)', `session-${id}`, id, `token-${id}`, NOW + 86_400_000, NOW, NOW);
  }
  harness.d1.runSync(`insert into spaces (id, name, partner_name, relationship_start_date, created_by_user_id, created_at, updated_at) values (?, 'Space', 'Partner', '2026-01-01', ?, ?, ?)`, SPACE, A, NOW, NOW);
  for (const id of [A, B]) {
    harness.d1.runSync(`insert into space_members (space_id, user_id, role, state, joined_at) values (?, ?, ?, 'active', ?)`, SPACE, id, id === A ? 'you' : 'partner', NOW);
  }
  for (const id of [OLD, NEW, RESPONSE_MEDIA]) {
    harness.d1.runSync(`insert into media_objects (id, space_id, created_by_user_id, filename, mime_type, size_bytes, storage_key, upload_state, created_at) values (?, ?, ?, 'file', 'image/png', 10, ?, 'complete', ?)`, id, SPACE, A, `media/${id}`, NOW);
  }
  const app = createApp(harness.layer);
  const request = (path: string, method: string, body?: unknown, userId = A) => app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer token-${userId}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const created = await request('/v1/spaces/current/moments', 'POST', { type: 'media', attachments: [{ mediaId: OLD, kind: 'image' }] });
  expect(created.status).toBe(201);
  const moment = momentSchema.parse(await created.json());
  harness.d1.runSync(`insert into moment_responses (id, moment_id, created_by_user_id, kind, media_id, created_at) values (?, ?, ?, 'photo', ?, ?)`, uuid(30), moment.id, B, RESPONSE_MEDIA, NOW);
  const path = `/v1/moments/${moment.id}`;
  const snapshot = () => ({
    moments: harness.d1.rawDb.prepare('select * from moments order by id').all(),
    attachments: harness.d1.rawDb.prepare('select * from moment_attachments order by moment_id, position').all(),
    media: harness.d1.rawDb.prepare('select * from media_objects order by id').all(),
    responses: harness.d1.rawDb.prepare('select * from moment_responses order by id').all(),
    activity: harness.d1.rawDb.prepare('select * from space_activity order by id').all(),
    changes: harness.d1.rawDb.prepare('select total_changes() as n').get(),
    queue: [...harness.capturedQueue],
  });
  return { harness, request, moment, path, snapshot };
}

describe('Worker memory optimistic concurrency', () => {
  it.each([
    ['PATCH', 'PATCH'], ['PATCH', 'DELETE'], ['DELETE', 'PATCH'], ['DELETE', 'DELETE'],
  ])('rejects the losing %s against a winning %s after both read the same version', async (loserMethod, winnerMethod) => {
    const ctx = await setup();
    const originalBatch = ctx.harness.d1.batch.bind(ctx.harness.d1);
    let winnerSnapshot: ReturnType<typeof ctx.snapshot> | undefined;
    vi.spyOn(ctx.harness.d1, 'batch').mockImplementationOnce(async (statements) => {
      const winner = await ctx.request(ctx.path, winnerMethod, {
        expectedUpdatedAt: ctx.moment.updatedAt,
        ...(winnerMethod === 'PATCH' ? { body: 'Winner' } : {}),
      });
      expect(winner.status).toBe(200);
      winnerSnapshot = ctx.snapshot();
      return originalBatch(statements);
    });
    const loser = await ctx.request(ctx.path, loserMethod, {
      expectedUpdatedAt: ctx.moment.updatedAt,
      ...(loserMethod === 'PATCH' ? { body: 'Loser', attachments: [{ mediaId: NEW, kind: 'image' }] } : {}),
    });
    expect(loser.status).toBe(409);
    expect(await loser.json()).toEqual(CONFLICT);
    expect(ctx.snapshot()).toEqual(winnerSnapshot);
    expect(ctx.harness.capturedQueue).toHaveLength(2);
  });

  it('does not clear attachments when an empty replacement loses CAS', async () => {
    const ctx = await setup();
    const originalBatch = ctx.harness.d1.batch.bind(ctx.harness.d1);
    let winnerSnapshot: ReturnType<typeof ctx.snapshot> | undefined;
    vi.spyOn(ctx.harness.d1, 'batch').mockImplementationOnce(async (statements) => {
      expect((await ctx.request(ctx.path, 'PATCH', { expectedUpdatedAt: ctx.moment.updatedAt, title: 'Winner' })).status).toBe(200);
      winnerSnapshot = ctx.snapshot();
      return originalBatch(statements);
    });
    expect((await ctx.request(ctx.path, 'PATCH', { expectedUpdatedAt: ctx.moment.updatedAt, attachments: [] })).status).toBe(409);
    expect(ctx.snapshot()).toEqual(winnerSnapshot);
  });

  it('advances versions at the same tick and with a backward clock and rejects stale writes before media validation', async () => {
    const ctx = await setup();
    const first = await ctx.request(ctx.path, 'PATCH', { expectedUpdatedAt: ctx.moment.updatedAt, body: 'First' });
    expect(first.status).toBe(200);
    const updated = momentSchema.parse(await first.json());
    expect(Date.parse(updated.updatedAt)).toBe(NOW + 1);
    ctx.harness.clock.advance(-1000);
    const second = await ctx.request(ctx.path, 'PATCH', { expectedUpdatedAt: updated.updatedAt.replace('.001Z', '.001+00:00'), title: 'Second' });
    expect(second.status).toBe(200);
    const latest = momentSchema.parse(await second.json());
    expect(Date.parse(latest.updatedAt)).toBe(NOW + 2);
    const before = ctx.snapshot();
    const stale = await ctx.request(ctx.path, 'PATCH', { expectedUpdatedAt: ctx.moment.updatedAt, attachments: [{ mediaId: uuid(999), kind: 'image' }] });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual(CONFLICT);
    expect((await ctx.request(ctx.path, 'DELETE', { expectedUpdatedAt: updated.updatedAt })).status).toBe(409);
    expect(ctx.snapshot()).toEqual(before);
    expect((await ctx.request(ctx.path, 'DELETE', { expectedUpdatedAt: latest.updatedAt })).status).toBe(200);
    expect(ctx.harness.d1.rawDb.prepare('select updated_at from moments where id = ?').get(ctx.moment.id)).toEqual({ updated_at: NOW + 3 });
  });

  it.each(['PATCH', 'DELETE'])('%s requires a valid precondition and preserves ownership, membership and missing-row errors', async (method) => {
    const ctx = await setup();
    for (const body of [undefined, {}, { expectedUpdatedAt: null }, { expectedUpdatedAt: 'yesterday' }, { expectedUpdatedAt: '2026-02-30T00:00:00Z' }]) {
      expect((await ctx.request(ctx.path, method, body)).status).toBe(400);
    }
    const malformed = await createApp(ctx.harness.layer).request(ctx.path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer token-${A}` },
      body: '{',
    });
    expect(malformed.status).toBe(400);
    if (method === 'DELETE') {
      expect((await ctx.request(ctx.path, method, { expectedUpdatedAt: ctx.moment.updatedAt, body: 'extra' })).status).toBe(400);
    }
    const stale = { expectedUpdatedAt: new Date(NOW - 1000).toISOString() };
    expect((await ctx.request(ctx.path, method, stale, B)).status).toBe(403);
    ctx.harness.d1.runSync(`update space_members set state = 'left' where user_id = ?`, A);
    expect((await ctx.request(ctx.path, method, stale)).status).toBe(403);
    expect((await ctx.request(`/v1/moments/${uuid(999)}`, method, stale)).status).toBe(404);
  });
});
