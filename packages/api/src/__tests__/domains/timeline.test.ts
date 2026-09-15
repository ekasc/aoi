import { describe, expect, it } from 'vitest';
import { Effect, Exit } from 'effect';

import { makeTestHarness, type ShimD1 } from '../../effects/test-harness';
import {
  listTimelineProgram,
  markMomentsReadProgram,
} from '../../domains/moments';
import { BadRequestError, NotFoundError } from '../../domains/errors';

/**
 * Timeline + synced read state (D1 domain harness, real SQLite baseline).
 * - viewer isolation, outside-space marks are no-ops, own/deleted/goal excluded
 * - idempotent marks, backdated inserts stay unread, same-ms tie-break
 * - oldest-unread-outside-latest100 still anchors the initial window
 * - before/after paging is exact with limit+1 probes, pages stay bounded
 */

const USER_A = '00000000-0000-4000-8000-000000000001';
const USER_B = '00000000-0000-4000-8000-000000000002';
const USER_C = '00000000-0000-4000-8000-000000000003';
const SPACE_1 = '00000000-0000-4000-8000-000000000010';
const SPACE_2 = '00000000-0000-4000-8000-000000000020';
const T0 = Date.parse('2026-01-15T00:00:00.000Z');

function insertUser(d1: ShimD1, id: string, email: string, name: string): void {
  d1.runSync(
    'insert into users (id, email, name, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?)',
    id,
    email,
    name,
    T0,
    T0
  );
}

function insertSpace(d1: ShimD1, id: string, creatorId: string): void {
  d1.runSync(
    `insert into spaces (id, name, partner_name, relationship_start_date, created_by_user_id, created_at, updated_at)
     values (?, 'Our Space', 'Partner', '2026-01-01', ?, ?, ?)`,
    id,
    creatorId,
    T0,
    T0
  );
  d1.runSync(
    `insert into space_members (space_id, user_id, role, state, joined_at) values (?, ?, 'you', 'active', ?)`,
    id,
    creatorId,
    T0
  );
}

function insertMember(d1: ShimD1, spaceId: string, userId: string, role: 'you' | 'partner'): void {
  d1.runSync(
    `insert into space_members (space_id, user_id, role, state, joined_at) values (?, ?, ?, 'active', ?)`,
    spaceId,
    userId,
    role,
    T0
  );
}

function insertMoment(
  d1: ShimD1,
  id: string,
  spaceId: string,
  authorId: string,
  occurredAtMs: number,
  opts?: { type?: string }
): void {
  d1.runSync(
    `insert into moments (id, space_id, created_by_user_id, author_role, author_name,
       type, title, body, occurred_at, target_at, media_preview, audio_uri,
       media_id, client_id, created_at, updated_at)
     values (?, ?, ?, 'you', 'You', ?, '', '', ?, null, null, null, null, ?, ?, ?)`,
    id,
    spaceId,
    authorId,
    opts?.type ?? 'note',
    occurredAtMs,
    `client-${id.slice(-4)}-${occurredAtMs}`,
    occurredAtMs,
    occurredAtMs
  );
}

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
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
  if (Exit.isSuccess(exit)) throw new Error('expected failure');
  const cause = exit.cause as { _tag: string; error?: unknown };
  if (cause._tag === 'Fail' && cause.error !== undefined) return cause.error;
  throw new Error(`unexpected cause ${cause._tag}`);
}

function readCount(d1: ShimD1, momentId: string, userId: string): number {
  const row = d1.rawDb
    .prepare('select count(*) as n from moment_reads where moment_id = ? and user_id = ?')
    .get(momentId, userId) as { n: number };
  return row.n;
}

describe('timeline read state', () => {
  it('excludes own, deleted, and goal moments from timeline and unread', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');

    insertMoment(ctx.harness.d1, uuid(1), SPACE_1, USER_A, T0);
    insertMoment(ctx.harness.d1, uuid(2), SPACE_1, USER_B, T0 + 1000, { type: 'goal' });
    insertMoment(ctx.harness.d1, uuid(3), SPACE_1, USER_B, T0 + 2000);
    ctx.harness.d1.runSync(`update moments set deleted_at = ? where id = ?`, T0 + 3000, uuid(3));
    insertMoment(ctx.harness.d1, uuid(4), SPACE_1, USER_B, T0 + 4000);

    const timeline = await run(ctx.provide(listTimelineProgram(USER_A, { limit: 100 })));
    expect(timeline.moments.map((m) => m.id)).toEqual([uuid(1), uuid(4)]);
    // Own is intrinsically read; only the live partner note is unread.
    expect(timeline.moments.find((m) => m.id === uuid(1))?.isRead).toBe(true);
    expect(timeline.moments.find((m) => m.id === uuid(4))?.isRead).toBe(false);
    expect(timeline.unreadCount).toBe(1);
    expect(timeline.firstUnread?.id).toBe(uuid(4));
  });

  it('marks are idempotent and scoped to eligible moments only', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');
    insertMoment(ctx.harness.d1, uuid(11), SPACE_1, USER_B, T0);
    insertMoment(ctx.harness.d1, uuid(12), SPACE_1, USER_A, T0 + 1000);
    insertMoment(ctx.harness.d1, uuid(13), SPACE_1, USER_B, T0 + 2000, { type: 'goal' });

    const first = await run(ctx.provide(markMomentsReadProgram(USER_A, { momentIds: [uuid(11)] })));
    expect(first).toEqual({ ok: true });
    const second = await run(ctx.provide(markMomentsReadProgram(USER_A, { momentIds: [uuid(11)] })));
    expect(second).toEqual({ ok: true });
    expect(readCount(ctx.harness.d1, uuid(11), USER_A)).toBe(1);

    // Own + goal ids are silently skipped (no rows).
    await run(ctx.provide(markMomentsReadProgram(USER_A, { momentIds: [uuid(12), uuid(13)] })));
    expect(readCount(ctx.harness.d1, uuid(12), USER_A)).toBe(0);
    expect(readCount(ctx.harness.d1, uuid(13), USER_A)).toBe(0);

    const timeline = await run(ctx.provide(listTimelineProgram(USER_A, { limit: 100 })));
    expect(timeline.unreadCount).toBe(0);
    expect(timeline.firstUnread).toBeNull();
  });

  it('isolates viewers and ignores outside-space marks', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    insertUser(ctx.harness.d1, USER_C, 'c@example.com', 'Carol');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');
    insertSpace(ctx.harness.d1, SPACE_2, USER_C);
    insertMoment(ctx.harness.d1, uuid(21), SPACE_1, USER_B, T0);

    // A reads B's moment; B's own view is unaffected (own excluded, count 0).
    await run(ctx.provide(markMomentsReadProgram(USER_A, { momentIds: [uuid(21)] })));
    const asA = await run(ctx.provide(listTimelineProgram(USER_A, { limit: 100 })));
    const asB = await run(ctx.provide(listTimelineProgram(USER_B, { limit: 100 })));
    expect(asA.unreadCount).toBe(0);
    expect(asB.unreadCount).toBe(0);
    expect(asB.moments[0].isRead).toBe(true);

    // C (active in another space) cannot mutate space 1 read state.
    await run(ctx.provide(markMomentsReadProgram(USER_C, { momentIds: [uuid(21)] })));
    expect(readCount(ctx.harness.d1, uuid(21), USER_C)).toBe(0);
    // A's read row still exactly one (C's attempt added nothing for A).
    expect(readCount(ctx.harness.d1, uuid(21), USER_A)).toBe(1);
  });

  it('keeps backdated inserts unread (no missing backdated unread)', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');
    insertMoment(ctx.harness.d1, uuid(31), SPACE_1, USER_B, T0 + 5000);
    await run(ctx.provide(markMomentsReadProgram(USER_A, { momentIds: [uuid(31)] })));

    // Partner adds a years-old memory after the read.
    insertMoment(ctx.harness.d1, uuid(32), SPACE_1, USER_B, T0 - 400 * 24 * 60 * 60 * 1000);
    const timeline = await run(ctx.provide(listTimelineProgram(USER_A, { limit: 100 })));
    expect(timeline.unreadCount).toBe(1);
    expect(timeline.firstUnread?.id).toBe(uuid(32));
    expect(timeline.moments.map((m) => m.id)).toContain(uuid(32));
  });

  it('pages same-timestamp moments by id without gaps or duplicates', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    const ids = [uuid(41), uuid(42), uuid(43)].sort();
    for (const id of ids) insertMoment(ctx.harness.d1, id, SPACE_1, USER_A, T0);

    const initial = await run(ctx.provide(listTimelineProgram(USER_A, { limit: 100 })));
    expect(initial.moments.map((m) => m.id)).toEqual(ids);

    const middle = `${T0}|${ids[1]}`;
    const older = await run(ctx.provide(listTimelineProgram(USER_A, { before: middle, limit: 10 })));
    expect(older.moments.map((m) => m.id)).toEqual([ids[0]]);
    const newer = await run(ctx.provide(listTimelineProgram(USER_A, { after: middle, limit: 10 })));
    expect(newer.moments.map((m) => m.id)).toEqual([ids[2]]);
  });

  it('anchors the initial window on an oldest unread outside the latest 100', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');
    const N = 120;
    for (let i = 0; i < N; i++) {
      insertMoment(ctx.harness.d1, uuid(1000 + i), SPACE_1, USER_B, T0 + i * 1000);
    }

    const initial = await run(ctx.provide(listTimelineProgram(USER_A, { limit: 30 })));
    expect(initial.unreadCount).toBe(N);
    expect(initial.firstUnread?.id).toBe(uuid(1000));
    // Window centers on the anchor (half before = none, anchor + after).
    expect(initial.moments[0].id).toBe(uuid(1000));
    expect(initial.moments).toHaveLength(30);
    expect(initial.moments.every((m) => m.isRead === false)).toBe(true);
    // Forward paging from newerCursor reaches the archive tail without a sweep.
    expect(initial.newerCursor).not.toBeNull();
    const next = await run(
      ctx.provide(listTimelineProgram(USER_A, { after: initial.newerCursor as string, limit: 30 }))
    );
    expect(next.moments[0].id).toBe(uuid(1030));
  });

  it('keeps an exact olderCursor for limit=1 when prior history exists (regression)', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');
    // Older eligible history (own, intrinsically read) plus the unread anchor.
    insertMoment(ctx.harness.d1, uuid(61), SPACE_1, USER_A, T0);
    insertMoment(ctx.harness.d1, uuid(62), SPACE_1, USER_B, T0 + 1000);

    const one = await run(ctx.provide(listTimelineProgram(USER_A, { limit: 1 })));
    expect(one.moments.map((m) => m.id)).toEqual([uuid(62)]);
    expect(one.firstUnread?.id).toBe(uuid(62));
    expect(one.unreadCount).toBe(1);
    // limit=1 fits no before page, but the older row still exists — the
    // cursor must stay exact (never collapse to null).
    expect(one.olderCursor).toBe(`${T0 + 1000}|${uuid(62)}`);
    expect(one.newerCursor).toBeNull();
    // Paging before the cursor reaches the older history without a sweep.
    const older = await run(
      ctx.provide(listTimelineProgram(USER_A, { before: one.olderCursor as string, limit: 10 }))
    );
    expect(older.moments.map((m) => m.id)).toEqual([uuid(61)]);
  });

  it('rejects mutually exclusive and invalid cursors, and bounds pages', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMoment(ctx.harness.d1, uuid(51), SPACE_1, USER_A, T0);
    insertMoment(ctx.harness.d1, uuid(52), SPACE_1, USER_A, T0 + 1000);

    const both = await failureOf(
      ctx.provide(listTimelineProgram(USER_A, { before: `${T0}|${uuid(52)}`, after: `${T0}|${uuid(51)}` }))
    );
    expect(both).toBeInstanceOf(BadRequestError);

    const bad = await failureOf(ctx.provide(listTimelineProgram(USER_A, { before: 'not-a-cursor' })));
    expect(bad).toBeInstanceOf(BadRequestError);

    const badMark = await failureOf(ctx.provide(markMomentsReadProgram(USER_A, { momentIds: [] })));
    expect(badMark).toBeInstanceOf(BadRequestError);

    // Bounded: limit 1 returns one row with exact cursors.
    const one = await run(ctx.provide(listTimelineProgram(USER_A, { limit: 1 })));
    expect(one.moments).toHaveLength(1);
  });

  it('centers on an anchor outside the initial unread window while preserving read UI', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');
    const N = 120;
    for (let i = 0; i < N; i++) {
      insertMoment(ctx.harness.d1, uuid(1000 + i), SPACE_1, USER_B, T0 + i * 1000);
    }

    const initial = await run(ctx.provide(listTimelineProgram(USER_A, { limit: 30 })));
    expect(initial.firstUnread?.id).toBe(uuid(1000));
    expect(initial.moments[0].id).toBe(uuid(1000));

    // Anchor far outside the initial window (index 100).
    const anchorId = uuid(1100);
    const anchored = await run(ctx.provide(listTimelineProgram(USER_A, { anchor: anchorId, limit: 30 })));
    expect(anchored.moments).toHaveLength(30);
    expect(anchored.moments.map((m) => m.id)).toContain(anchorId);
    // Centered: half before (15) + anchor + after.
    expect(anchored.moments[0].id).toBe(uuid(1085));
    expect(anchored.moments[anchored.moments.length - 1].id).toBe(uuid(1114));
    // Global read UI preserved, bodies bounded.
    expect(anchored.firstUnread?.id).toBe(uuid(1000));
    expect(anchored.unreadCount).toBe(N);
    expect(anchored.moments.every((m) => m.isRead === false)).toBe(true);
    expect(anchored.olderCursor).not.toBeNull();
    expect(anchored.newerCursor).not.toBeNull();
  });

  it('resolves an own backdated anchor (eligible, intrinsically read)', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');
    insertMoment(ctx.harness.d1, uuid(71), SPACE_1, USER_A, T0 - 24 * 60 * 60 * 1000);
    insertMoment(ctx.harness.d1, uuid(72), SPACE_1, USER_B, T0 + 1000);
    insertMoment(ctx.harness.d1, uuid(73), SPACE_1, USER_B, T0 + 2000);

    const anchored = await run(ctx.provide(listTimelineProgram(USER_A, { anchor: uuid(71), limit: 10 })));
    expect(anchored.moments.map((m) => m.id)).toEqual([uuid(71), uuid(72), uuid(73)]);
    expect(anchored.moments.find((m) => m.id === uuid(71))?.isRead).toBe(true);
    expect(anchored.firstUnread?.id).toBe(uuid(72));
    expect(anchored.unreadCount).toBe(2);
  });

  it('404s foreign, deleted, and goal anchors (safe404)', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    insertUser(ctx.harness.d1, USER_C, 'c@example.com', 'Carol');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');
    insertSpace(ctx.harness.d1, SPACE_2, USER_C);
    insertMoment(ctx.harness.d1, uuid(81), SPACE_1, USER_B, T0);
    insertMoment(ctx.harness.d1, uuid(82), SPACE_1, USER_B, T0 + 1000, { type: 'goal' });
    insertMoment(ctx.harness.d1, uuid(83), SPACE_1, USER_B, T0 + 2000);
    ctx.harness.d1.runSync(`update moments set deleted_at = ? where id = ?`, T0 + 3000, uuid(83));
    insertMoment(ctx.harness.d1, uuid(84), SPACE_2, USER_C, T0);

    for (const anchor of [uuid(82), uuid(83), uuid(84)]) {
      const failure = await failureOf(ctx.provide(listTimelineProgram(USER_A, { anchor })));
      expect(failure).toBeInstanceOf(NotFoundError);
    }

    const live = await run(ctx.provide(listTimelineProgram(USER_A, { anchor: uuid(81), limit: 10 })));
    expect(live.moments.map((m) => m.id)).toContain(uuid(81));
  });

  it('rejects anchor combined with before/after', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMoment(ctx.harness.d1, uuid(91), SPACE_1, USER_A, T0);

    const withBefore = await failureOf(
      ctx.provide(listTimelineProgram(USER_A, { before: `${T0}|${uuid(91)}`, anchor: uuid(91) }))
    );
    expect(withBefore).toBeInstanceOf(BadRequestError);

    const withAfter = await failureOf(
      ctx.provide(listTimelineProgram(USER_A, { after: `${T0}|${uuid(91)}`, anchor: uuid(91) }))
    );
    expect(withAfter).toBeInstanceOf(BadRequestError);
  });

  it('centers limit=1 on an equal-time anchor with exact tie cursors', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    const ids = [uuid(95), uuid(96), uuid(97)].sort();
    for (const id of ids) insertMoment(ctx.harness.d1, id, SPACE_1, USER_A, T0);

    const one = await run(ctx.provide(listTimelineProgram(USER_A, { anchor: ids[1], limit: 1 })));
    expect(one.moments.map((m) => m.id)).toEqual([ids[1]]);
    expect(one.olderCursor).toBe(`${T0}|${ids[1]}`);
    expect(one.newerCursor).toBe(`${T0}|${ids[1]}`);
    // Tie cursors page to neighbors without gaps.
    const older = await run(
      ctx.provide(listTimelineProgram(USER_A, { before: one.olderCursor as string, limit: 10 }))
    );
    expect(older.moments.map((m) => m.id)).toEqual([ids[0]]);
    const newer = await run(
      ctx.provide(listTimelineProgram(USER_A, { after: one.newerCursor as string, limit: 10 }))
    );
    expect(newer.moments.map((m) => m.id)).toEqual([ids[2]]);
  });

  it('returns an empty timeline without an active space', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    const timeline = await run(ctx.provide(listTimelineProgram(USER_A, {})));
    expect(timeline).toEqual({
      moments: [],
      olderCursor: null,
      newerCursor: null,
      firstUnread: null,
      unreadCount: 0,
    });
    const marked = await run(ctx.provide(markMomentsReadProgram(USER_A, { momentIds: [uuid(99)] })));
    expect(marked).toEqual({ ok: true });
  });
});
