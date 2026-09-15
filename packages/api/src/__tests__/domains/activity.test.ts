import { describe, expect, it } from 'vitest';
import { Effect, Exit } from 'effect';

import { makeTestHarness, type ShimD1 } from '../../effects/test-harness';
import { listActivityProgram } from '../../domains/activity';
import { BadRequestError } from '../../domains/errors';

/**
 * Activity feed — provenance, not history:
 * - read window clamps to 7 days (never widened by `since`),
 * - capped at 50 rows,
 * - tombstone-only kinds, fact + actor only (never content),
 * - inline purge is best-effort housekeeping.
 */

const USER_A = '00000000-0000-4000-8000-000000000001';
const USER_B = '00000000-0000-4000-8000-000000000002';
const SPACE_1 = '00000000-0000-4000-8000-000000000010';
const T0 = Date.parse('2026-01-15T00:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

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

function insertMember(d1: ShimD1, spaceId: string, userId: string, role: 'you' | 'partner'): void {
  d1.runSync(
    `insert into space_members (space_id, user_id, role, state, joined_at) values (?, ?, ?, 'active', ?)`,
    spaceId,
    userId,
    role,
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
  insertMember(d1, id, creatorId, 'you');
}

function insertActivity(d1: ShimD1, id: string, spaceId: string, actorId: string, kind: string, occurredAt: number): void {
  d1.runSync(
    'insert into space_activity (id, space_id, actor_user_id, kind, subject_id, occurred_at) values (?, ?, ?, ?, null, ?)',
    id,
    spaceId,
    actorId,
    kind,
    occurredAt
  );
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

describe('listActivityProgram', () => {
  it('returns an empty feed without an active space', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    const result = await run(ctx.provide(listActivityProgram(USER_A, {})));
    expect(result).toEqual({ activity: [] });
  });

  it('returns fact + actor only, newest first, and never moment content', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');
    insertActivity(ctx.harness.d1, 'a-1', SPACE_1, USER_A, 'moment_edited', T0);
    insertActivity(ctx.harness.d1, 'a-2', SPACE_1, USER_B, 'moment_deleted', T0 + 1000);

    const result = await run(ctx.provide(listActivityProgram(USER_A, {})));
    expect(result.activity).toEqual([
      { id: 'a-2', kind: 'moment_deleted', actorName: 'Bob', occurredAt: new Date(T0 + 1000).toISOString() },
      { id: 'a-1', kind: 'moment_edited', actorName: 'Alice', occurredAt: new Date(T0).toISOString() },
    ]);
  });

  it('clamps the window to 7 days and never widens it with an old `since`', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertActivity(ctx.harness.d1, 'old-1', SPACE_1, USER_A, 'moment_edited', T0 - 8 * DAY);
    insertActivity(ctx.harness.d1, 'mid-1', SPACE_1, USER_A, 'moment_edited', T0 - 6 * DAY);
    insertActivity(ctx.harness.d1, 'new-1', SPACE_1, USER_A, 'moment_deleted', T0);

    // No since → only the 7-day window.
    const noSince = await run(ctx.provide(listActivityProgram(USER_A, {})));
    expect(noSince.activity.map((a) => a.id)).toEqual(['new-1', 'mid-1']);

    // since older than 7 days → still clamped to 7 days.
    const oldSince = await run(ctx.provide(listActivityProgram(USER_A, { since: new Date(T0 - 30 * DAY).toISOString() })));
    expect(oldSince.activity.map((a) => a.id)).toEqual(['new-1', 'mid-1']);

    // since inside the window narrows it.
    const narrow = await run(ctx.provide(listActivityProgram(USER_A, { since: new Date(T0 - 1 * DAY).toISOString() })));
    expect(narrow.activity.map((a) => a.id)).toEqual(['new-1']);
  });

  it('caps the feed at 50 rows', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    for (let i = 0; i < 60; i++) {
      insertActivity(ctx.harness.d1, `cap-${String(i).padStart(2, '0')}`, SPACE_1, USER_A, 'moment_edited', T0 + i);
    }
    const result = await run(ctx.provide(listActivityProgram(USER_A, {})));
    expect(result.activity).toHaveLength(50);
  });

  it('purges rows older than the retention window for the current space (best-effort)', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertActivity(ctx.harness.d1, 'old-1', SPACE_1, USER_A, 'moment_edited', T0 - 8 * DAY);
    insertActivity(ctx.harness.d1, 'new-1', SPACE_1, USER_A, 'moment_deleted', T0);

    await run(ctx.provide(listActivityProgram(USER_A, {})));

    const remaining = ctx.harness.d1.rawDb
      .prepare('select count(*) as n from space_activity where space_id = ?')
      .get(SPACE_1) as { n: number };
    expect(remaining.n).toBe(1);
  });

  it('rejects an invalid since with a 400', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    const err = await failureOf(ctx.provide(listActivityProgram(USER_A, { since: 'not-a-date' })));
    expect(err).toBeInstanceOf(BadRequestError);
  });
});
