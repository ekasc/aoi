import { describe, expect, it } from 'vitest';
import { Effect, Exit } from 'effect';

import { makeTestHarness, type ShimD1 } from '../../effects/test-harness';
import {
  createMomentProgram,
  deleteMomentProgram,
  listMomentsProgram,
  updateMomentProgram,
} from '../../domains/moments';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../domains/errors';

/**
 * Moments domain — the vertical slice pinned at the program level:
 * - keyset pagination with the `(occurred_at, id)` tie-break,
 * - clientId idempotent create (partial unique; replay returns the first
 *   row, never a second),
 * - own-only update/delete with the guarded batch (tombstone + activity row
 *   fire together, and a double-delete never writes a second tombstone),
 * - partner notification is ENQUEUED (one queue), never sent inline.
 */

const USER_A = '00000000-0000-4000-8000-000000000001';
const USER_B = '00000000-0000-4000-8000-000000000002';
const USER_C = '00000000-0000-4000-8000-000000000003';
const SPACE_1 = '00000000-0000-4000-8000-000000000010';

function insertUser(d1: ShimD1, id: string, email: string, name: string): void {
  d1.runSync(
    'insert into users (id, email, name, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?)',
    id,
    email,
    name,
    Date.parse('2026-01-01T00:00:00.000Z'),
    Date.parse('2026-01-01T00:00:00.000Z')
  );
}

function insertSpace(d1: ShimD1, id: string, creatorId: string, name = 'Our Space'): void {
  d1.runSync(
    `insert into spaces (id, name, partner_name, relationship_start_date, created_by_user_id, created_at, updated_at)
     values (?, ?, 'Partner', '2026-01-01', ?, ?, ?)`,
    id,
    name,
    creatorId,
    Date.parse('2026-01-01T00:00:00.000Z'),
    Date.parse('2026-01-01T00:00:00.000Z')
  );
  insertMember(d1, id, creatorId, 'you');
}

function insertMember(d1: ShimD1, spaceId: string, userId: string, role: 'you' | 'partner'): void {
  d1.runSync(
    `insert into space_members (space_id, user_id, role, state, joined_at) values (?, ?, ?, 'active', ?)`,
    spaceId,
    userId,
    role,
    Date.parse('2026-01-01T00:00:00.000Z')
  );
}

function insertMoment(
  d1: ShimD1,
  id: string,
  spaceId: string,
  authorId: string,
  occurredAtMs: number,
  opts?: { type?: string; clientId?: string | null; mediaId?: string | null }
): void {
  d1.runSync(
    `insert into moments (id, space_id, created_by_user_id, author_role, author_name,
       type, title, body, occurred_at, target_at, media_preview, audio_uri,
       media_id, client_id, created_at, updated_at)
     values (?, ?, ?, 'you', 'You', ?, '', '', ?, null, null, null, ?, ?, ?, ?)`,
    id,
    spaceId,
    authorId,
    opts?.type ?? 'note',
    occurredAtMs,
    opts?.mediaId ?? null,
    opts?.clientId ?? null,
    occurredAtMs,
    occurredAtMs
  );
}

function countActivity(d1: ShimD1, subjectId: string): number {
  const rows = d1.rawDb.prepare('select count(*) as n from space_activity where subject_id = ?').get(subjectId) as { n: number };
  return rows.n;
}

function makeCtx() {
  const harness = makeTestHarness();
  return {
    harness,
    provide: <A, E, R>(program: Effect.Effect<A, E, R>) =>
      Effect.provide(program as Effect.Effect<A, E, never>, harness.layer as never) as Effect.Effect<A, E, never>,
  };
}

function run<A>(effect: Effect.Effect<A, unknown, never>): Promise<A> {
  return Effect.runPromise(effect as Effect.Effect<A, unknown, never>);
}

async function failureOf<A>(effect: Effect.Effect<A, unknown, never>): Promise<unknown> {
  const exit = await Effect.runPromise(Effect.exit(effect as Effect.Effect<A, unknown, never>));
  if (Exit.isSuccess(exit)) {
    throw new Error('expected program to fail, but it succeeded');
  }
  const cause = exit.cause as { _tag: string; error?: unknown };
  if (cause._tag === 'Fail' && cause.error !== undefined) {
    return cause.error;
  }
  throw new Error(`unexpected failure cause: ${cause._tag}`);
}

const T0 = Date.parse('2026-01-15T00:00:00.000Z');

describe('createMomentProgram', () => {
  it('requires an active space', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    const err = await failureOf(ctx.provide(createMomentProgram(USER_A, { type: 'note' })));
    expect(err).toBeInstanceOf(BadRequestError);
  });

  it('rejects a user with no active space (400, not a leak)', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_C, 'c@example.com', 'Carol');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    // Carol is not a member anywhere → the space gate fires first (400).
    const err = await failureOf(ctx.provide(createMomentProgram(USER_C, { type: 'note' })));
    expect(err).toBeInstanceOf(BadRequestError);
  });

  it('creates a moment with viewer-relative attribution and enqueues a partner push', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');

    const result = await run(ctx.provide(createMomentProgram(USER_A, { type: 'note', title: 'Hello', body: 'world' })));
    expect(result.created).toBe(true);
    expect(result.moment.isOwn).toBe(true);
    expect(result.moment.authorRole).toBe('you');
    expect(result.moment.authorName).toBe('You');
    expect(result.moment.type).toBe('note');
    expect(result.moment.title).toBe('Hello');
    expect(result.moment.body).toBe('world');
    expect(result.moment.occurredAt).toBe(new Date(T0).toISOString());

    // The notification is enqueued (kind only — never content), not sent.
    expect(ctx.harness.capturedQueue).toEqual([
      { type: 'push.deliver', kind: 'moment_added', spaceId: SPACE_1, fromUserId: USER_A },
    ]);
  });

  it('replays the first result when the same clientId is re-sent (idempotent double-tap)', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');

    const input = { type: 'note' as const, title: 'Double tap', clientId: 'draft-1' };
    const first = await run(ctx.provide(createMomentProgram(USER_A, input)));
    const second = await run(ctx.provide(createMomentProgram(USER_A, input)));

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.moment.id).toBe(first.moment.id);

    // Only one row exists for the pair.
    const rows = ctx.harness.d1.rawDb
      .prepare('select count(*) as n from moments where client_id = ?')
      .get('draft-1') as { n: number };
    expect(rows.n).toBe(1);
    // Only one notification enqueued for the create.
    expect(ctx.harness.capturedQueue).toHaveLength(1);
  });

  it('a colliding clientId from the OTHER partner creates their own moment (creator-scoped idempotency)', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');

    // Same key, different creators — the idempotency unique is scoped to
    // (space, creator, client_id), so this is a FRESH create for B, never a
    // replay of A's moment (idempotency is a per-sender hint, not a
    // cross-user address).
    const a = await run(ctx.provide(createMomentProgram(USER_A, { type: 'note', title: "A's", clientId: 'draft-x' })));
    const b = await run(ctx.provide(createMomentProgram(USER_B, { type: 'note', title: "B's", clientId: 'draft-x' })));

    expect(a.created).toBe(true);
    expect(b.created).toBe(true);
    expect(b.moment.id).not.toBe(a.moment.id);
    expect(b.moment.title).toBe("B's");
    expect(b.moment.isOwn).toBe(true);

    // Two rows exist — one per creator.
    const rows = ctx.harness.d1.rawDb
      .prepare('select count(*) as n from moments where client_id = ?')
      .get('draft-x') as { n: number };
    expect(rows.n).toBe(2);
  });

  it('a different clientId always creates a new moment', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    const first = await run(ctx.provide(createMomentProgram(USER_A, { type: 'note', clientId: 'a' })));
    const second = await run(ctx.provide(createMomentProgram(USER_A, { type: 'note', clientId: 'b' })));
    expect(first.moment.id).not.toBe(second.moment.id);
  });
});

describe('listMomentsProgram', () => {
  it('returns an empty feed without an active space', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    const result = await run(ctx.provide(listMomentsProgram(USER_A, {})));
    expect(result).toEqual({ moments: [], nextCursor: undefined });
  });

  it('paginates with the composite cursor and the (occurred_at, id) tie-break', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);

    // Same occurredAt for 5 moments → ordering is by id DESC.
    const ids = ['m-1', 'm-2', 'm-3', 'm-4', 'm-5'].map((s) => `00000000-0000-4000-8000-${s.padStart(12, '0')}`);
    for (const id of ids) {
      insertMoment(ctx.harness.d1, id, SPACE_1, USER_A, T0);
    }

    const page1 = await run(ctx.provide(listMomentsProgram(USER_A, { limit: 2 })));
    expect(page1.moments.map((m) => m.id)).toEqual([ids[4], ids[3]]);
    expect(page1.nextCursor).toBe(`${T0}|${ids[3]}`);

    const page2 = await run(ctx.provide(listMomentsProgram(USER_A, { limit: 2, cursor: page1.nextCursor })));
    expect(page2.moments.map((m) => m.id)).toEqual([ids[2], ids[1]]);
    expect(page2.nextCursor).toBe(`${T0}|${ids[1]}`);

    const page3 = await run(ctx.provide(listMomentsProgram(USER_A, { limit: 2, cursor: page2.nextCursor })));
    expect(page3.moments.map((m) => m.id)).toEqual([ids[0]]);
    expect(page3.nextCursor).toBeUndefined();

    // No duplicates or gaps across pages.
    const all = [...page1.moments, ...page2.moments, ...page3.moments].map((m) => m.id);
    expect(new Set(all).size).toBe(5);
  });

  it('orders by occurred_at DESC first (newest first), then id', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMoment(ctx.harness.d1, '00000000-0000-4000-8000-0000000000a1', SPACE_1, USER_A, T0 - 1000);
    insertMoment(ctx.harness.d1, '00000000-0000-4000-8000-0000000000a2', SPACE_1, USER_A, T0 + 1000);
    insertMoment(ctx.harness.d1, '00000000-0000-4000-8000-0000000000a3', SPACE_1, USER_A, T0);

    const result = await run(ctx.provide(listMomentsProgram(USER_A, {})));
    expect(result.moments.map((m) => m.occurredAt)).toEqual([
      new Date(T0 + 1000).toISOString(),
      new Date(T0).toISOString(),
      new Date(T0 - 1000).toISOString(),
    ]);
  });

  it('accepts a legacy bare-ISO cursor for one page', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMoment(ctx.harness.d1, '00000000-0000-4000-8000-0000000000b1', SPACE_1, USER_A, T0 - 1000);
    insertMoment(ctx.harness.d1, '00000000-0000-4000-8000-0000000000b2', SPACE_1, USER_A, T0 + 1000);

    const result = await run(ctx.provide(listMomentsProgram(USER_A, { cursor: new Date(T0).toISOString() })));
    // Only moments strictly older than the cursor date are returned.
    expect(result.moments.map((m) => m.id)).toEqual(['00000000-0000-4000-8000-0000000000b1']);
  });

  it('rejects an unrecognized cursor with a 400', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    const err = await failureOf(ctx.provide(listMomentsProgram(USER_A, { cursor: 'not-a-cursor' })));
    expect(err).toBeInstanceOf(BadRequestError);
  });

  it('hides soft-deleted moments', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMoment(ctx.harness.d1, '00000000-0000-4000-8000-0000000000c1', SPACE_1, USER_A, T0);
    ctx.harness.d1.runSync(
      `update moments set deleted_at = ? where id = '00000000-0000-4000-8000-0000000000c1'`,
      T0 + 1000
    );
    const result = await run(ctx.provide(listMomentsProgram(USER_A, {})));
    expect(result.moments).toHaveLength(0);
  });

  it('shows the partner with authorRole partner and their live display name', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');
    insertMoment(ctx.harness.d1, '00000000-0000-4000-8000-0000000000d1', SPACE_1, USER_B, T0);

    // Bob wrote it; Alice sees partner/Bob.
    const asAlice = await run(ctx.provide(listMomentsProgram(USER_A, {})));
    expect(asAlice.moments[0].isOwn).toBe(false);
    expect(asAlice.moments[0].authorRole).toBe('partner');
    expect(asAlice.moments[0].authorName).toBe('Bob');

    // Bob sees own/you.
    const asBob = await run(ctx.provide(listMomentsProgram(USER_B, {})));
    expect(asBob.moments[0].isOwn).toBe(true);
    expect(asBob.moments[0].authorRole).toBe('you');
    expect(asBob.moments[0].authorName).toBe('You');
  });
});

describe('updateMomentProgram', () => {
  it('404s for a missing moment', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    const err = await failureOf(ctx.provide(updateMomentProgram(USER_A, '00000000-0000-4000-8000-0000000000e1', { title: 'x' })));
    expect(err).toBeInstanceOf(NotFoundError);
  });

  it('403s when editing another users moment', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');
    insertMoment(ctx.harness.d1, '00000000-0000-4000-8000-0000000000e2', SPACE_1, USER_A, T0);
    const err = await failureOf(ctx.provide(updateMomentProgram(USER_B, '00000000-0000-4000-8000-0000000000e2', { title: 'x' })));
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it('updates own moments, writes an activity row atomically, and enqueues moment_edited', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');
    const momentId = '00000000-0000-4000-8000-0000000000e3';
    insertMoment(ctx.harness.d1, momentId, SPACE_1, USER_A, T0);

    const updated = await run(ctx.provide(updateMomentProgram(USER_A, momentId, { title: 'New title', targetAt: null })));
    expect(updated.title).toBe('New title');
    // The clock is frozen: advance it so the update timestamp moves.
    ctx.harness.clock.advance(60_000);
    const updatedLater = await run(ctx.provide(updateMomentProgram(USER_A, momentId, { body: 'revised' })));
    expect(updatedLater.updatedAt).not.toBe(updatedLater.createdAt);
    expect(updatedLater.body).toBe('revised');

    // Each edit writes its own activity row (both edits fired).
    expect(countActivity(ctx.harness.d1, momentId)).toBe(2);
    const activity = ctx.harness.d1.rawDb
      .prepare('select kind from space_activity where subject_id = ? order by occurred_at asc')
      .all(momentId) as unknown as { kind: string }[];
    expect(activity).toHaveLength(2);
    expect(activity.every((row) => row.kind === 'moment_edited')).toBe(true);
    expect(ctx.harness.capturedQueue).toEqual([
      { type: 'push.deliver', kind: 'moment_edited', spaceId: SPACE_1, fromUserId: USER_A },
      { type: 'push.deliver', kind: 'moment_edited', spaceId: SPACE_1, fromUserId: USER_A },
    ]);
  });

  it('updates mediaId on an own moment (stable id swap, old media released)', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    const oldMedia = '00000000-0000-4000-8000-0000000000b1';
    const newMedia = '00000000-0000-4000-8000-0000000000b2';
    for (const mediaId of [oldMedia, newMedia]) {
      ctx.harness.d1.runSync(
        `insert into media_objects (id, space_id, created_by_user_id, filename, mime_type,
           size_bytes, storage_key, upload_state, created_at)
         values (?, ?, ?, 'p.png', 'image/png', 10, ?, 'complete', ?)`,
        mediaId,
        SPACE_1,
        USER_A,
        `media/${mediaId}/original.png`,
        Date.parse('2026-01-01T00:00:00.000Z')
      );
    }
    const momentId = '00000000-0000-4000-8000-0000000000e9';
    insertMoment(ctx.harness.d1, momentId, SPACE_1, USER_A, T0, {
      type: 'media',
      mediaId: oldMedia,
    });

    const updated = await run(ctx.provide(updateMomentProgram(USER_A, momentId, {
      mediaId: newMedia,
      mediaPreview: `/v1/media/${newMedia}/object?variant=display`,
    })));

    expect(updated.mediaId).toBe(newMedia);
    const row = ctx.harness.d1.rawDb
      .prepare('select media_id from moments where id = ?')
      .get(momentId) as { media_id: string | null };
    expect(row.media_id).toBe(newMedia);
    // Old row released (unreferenced), new row live.
    const media = (id: string) =>
      ctx.harness.d1.rawDb.prepare('select deleted_at from media_objects where id = ?').get(id) as {
        deleted_at: number | null;
      };
    expect(media(oldMedia).deleted_at).toBeTypeOf('number');
    expect(media(newMedia).deleted_at).toBeNull();
  });

  it('attaching dead/nonexistent media fails closed (create and update)', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    const momentId = '00000000-0000-4000-8000-0000000000e8';
    insertMoment(ctx.harness.d1, momentId, SPACE_1, USER_A, T0);

    const ghost = '00000000-0000-4000-8000-0000000000b9';
    const createFailure = await failureOf(
      ctx.provide(createMomentProgram(USER_A, { type: 'media', mediaId: ghost }))
    );
    expect(createFailure).toBeInstanceOf(NotFoundError);

    const updateFailure = await failureOf(
      ctx.provide(updateMomentProgram(USER_A, momentId, { mediaId: ghost }))
    );
    expect(updateFailure).toBeInstanceOf(NotFoundError);
  });

  it('404s and writes no activity when the moment was tombstoned mid-flight', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    const momentId = '00000000-0000-4000-8000-0000000000e4';
    insertMoment(ctx.harness.d1, momentId, SPACE_1, USER_A, T0);

    // Delete first, then try to update the tombstone.
    await run(ctx.provide(deleteMomentProgram(USER_A, momentId)));
    const err = await failureOf(ctx.provide(updateMomentProgram(USER_A, momentId, { title: 'late' })));
    expect(err).toBeInstanceOf(NotFoundError);
    // Only the delete tombstone exists — the failed update added nothing.
    expect(countActivity(ctx.harness.d1, momentId)).toBe(1);
  });
});

describe('deleteMomentProgram', () => {
  it('404s for a missing moment and 403s for another users moment', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');
    insertMoment(ctx.harness.d1, '00000000-0000-4000-8000-0000000000f1', SPACE_1, USER_A, T0);

    const missing = await failureOf(ctx.provide(deleteMomentProgram(USER_A, '00000000-0000-4000-8000-0000000000ff')));
    expect(missing).toBeInstanceOf(NotFoundError);

    const other = await failureOf(ctx.provide(deleteMomentProgram(USER_B, '00000000-0000-4000-8000-0000000000f1')));
    expect(other).toBeInstanceOf(ForbiddenError);
  });

  it('tombstones + activity in one batch, and a double-delete 404s without a second tombstone', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');
    const momentId = '00000000-0000-4000-8000-0000000000f2';
    insertMoment(ctx.harness.d1, momentId, SPACE_1, USER_A, T0);

    const first = await run(ctx.provide(deleteMomentProgram(USER_A, momentId)));
    expect(first).toEqual({ ok: true });
    expect(countActivity(ctx.harness.d1, momentId)).toBe(1);

    // Second delete: guard fails → 404, and NO second activity row.
    const second = await failureOf(ctx.provide(deleteMomentProgram(USER_A, momentId)));
    expect(second).toBeInstanceOf(NotFoundError);
    expect(countActivity(ctx.harness.d1, momentId)).toBe(1);

    // Tombstoned rows are invisible to the feed.
    const feed = await run(ctx.provide(listMomentsProgram(USER_A, {})));
    expect(feed.moments).toHaveLength(0);

    expect(ctx.harness.capturedQueue).toEqual([
      { type: 'push.deliver', kind: 'moment_deleted', spaceId: SPACE_1, fromUserId: USER_A },
    ]);
  });
});
