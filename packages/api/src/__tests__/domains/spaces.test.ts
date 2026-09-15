import { describe, expect, it } from 'vitest';
import { Effect, Exit } from 'effect';

import { makeTestHarness, type ShimD1 } from '../../effects/test-harness';
import {
  createSpaceProgram,
  getActiveSpaceId,
  getCurrentSpaceProgram,
  joinSpaceProgram,
  leaveSpaceProgram,
  updateSpaceProgram,
} from '../../domains/spaces';
import { shareLocationProgram } from '../../domains/location';
import { ConflictError, ForbiddenError, NotFoundError } from '../../domains/errors';
import { normalizeInviteCode } from '../../lib/crypto';

/**
 * Spaces domain tests — run against the real D1 baseline on the
 * better-sqlite3 shim. These pin the guarded atomic transitions:
 * - create = one atomic batch (space + member + invite), enforced by the
 *   partial unique `uq_space_members_user_active` (double create → 409),
 * - join = guarded redeem + partner insert in one batch (redeem-once,
 *   partner-slot unique),
 * - leave = guarded state flip that frees the active slot,
 * - exactly-two membership end-to-end.
 * The storage-level uniques themselves are pinned in d1-constraints.test.ts.
 */

const USER_A = '00000000-0000-4000-8000-000000000001';
const USER_B = '00000000-0000-4000-8000-000000000002';
const USER_C = '00000000-0000-4000-8000-000000000003';

function insertUser(d1: ShimD1, id: string, email: string, name: string): void {
  d1.runSync(
    'insert into users (id, email, name, email_verified) values (?, ?, ?, 1)',
    id,
    email,
    name
  );
}

interface Ctx {
  d1: ShimD1;
  provide<A, E, R>(program: Effect.Effect<A, E, R>): Effect.Effect<A, E, never>;
}

function makeCtx(): Ctx {
  const harness = makeTestHarness();
  return {
    d1: harness.d1,
    provide: (program) =>
      Effect.provide(program as Effect.Effect<unknown, unknown, never>, harness.layer as never) as never,
  };
}

function run<A>(effect: Effect.Effect<A, unknown, never>): Promise<A> {
  return Effect.runPromise(effect as Effect.Effect<A, unknown, never>);
}

/** Run and return the failure's error value (throws if the program succeeded). */
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

describe('createSpaceProgram', () => {
  it('creates space + creator member + invite atomically', async () => {
    const ctx = makeCtx();
    insertUser(ctx.d1, USER_A, 'a@example.com', 'Alice');

    const result = await run(ctx.provide(createSpaceProgram(USER_A, {
      name: 'Our Space',
      partnerName: 'Bob',
      relationshipStartDate: '2026-01-15',
    })));

    expect(result.space.name).toBe('Our Space');
    expect(result.space.partnerName).toBe('Bob');
    expect(result.space.createdByUserId).toBe(USER_A);
    expect(result.space.inviteCode).toMatch(/^[A-Z2-9]{6}$/);

    const members = ctx.d1.rawDb.prepare('select * from space_members').all();
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ space_id: result.space.id, user_id: USER_A, role: 'you', state: 'active' });

    const invites = ctx.d1.rawDb.prepare('select * from space_invites').all();
    expect(invites).toHaveLength(1);
    expect(invites[0]).toMatchObject({ code_normalized: result.space.inviteCode, redeemed_at: null });
  });

  it('rejects a second create from the same user (partial unique → 409) and rolls back the batch', async () => {
    const ctx = makeCtx();
    insertUser(ctx.d1, USER_A, 'a@example.com', 'Alice');

    await run(ctx.provide(createSpaceProgram(USER_A, {
      name: 'First',
      relationshipStartDate: '2026-01-15',
    })));

    const err = await failureOf(ctx.provide(createSpaceProgram(USER_A, {
      name: 'Second',
      relationshipStartDate: '2026-01-15',
    })));
    expect(err).toBeInstanceOf(ConflictError);
    // The atomic batch rolled back: no second space row.
    expect(ctx.d1.rawDb.prepare('select count(*) as n from spaces').get()).toEqual({ n: 1 });
    expect(ctx.d1.rawDb.prepare('select count(*) as n from space_invites').get()).toEqual({ n: 1 });
  });
});

describe('joinSpaceProgram', () => {
  it('redeems the invite + adds the partner in one batch', async () => {
    const ctx = makeCtx();
    insertUser(ctx.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.d1, USER_B, 'b@example.com', 'Bob');

    const created = await run(ctx.provide(createSpaceProgram(USER_A, {
      name: 'Our Space',
      partnerName: 'Bob',
      relationshipStartDate: '2026-01-15',
    })));

    const joined = await run(ctx.provide(joinSpaceProgram(USER_B, created.space.inviteCode)));
    expect(joined.space.id).toBe(created.space.id);
    expect(joined.space.partnerName).toBe('Bob');

    const members = ctx.d1.rawDb
      .prepare('select user_id, role, state from space_members order by role')
      .all();
    expect(members).toEqual([
      { user_id: USER_B, role: 'partner', state: 'active' },
      { user_id: USER_A, role: 'you', state: 'active' },
    ]);

    const invite = ctx.d1.rawDb
      .prepare('select redeemed_at, redeemed_by_user_id from space_invites')
      .get() as { redeemed_at: number | null; redeemed_by_user_id: string | null };
    expect(invite.redeemed_by_user_id).toBe(USER_B);
    expect(invite.redeemed_at).toBeTypeOf('number');
  });

  it('rejects a second redeemer (guarded redeem → 400) and keeps the space intact', async () => {
    const ctx = makeCtx();
    insertUser(ctx.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.d1, USER_B, 'b@example.com', 'Bob');
    insertUser(ctx.d1, USER_C, 'c@example.com', 'Carol');

    const created = await run(ctx.provide(createSpaceProgram(USER_A, {
      name: 'Our Space',
      relationshipStartDate: '2026-01-15',
    })));
    await run(ctx.provide(joinSpaceProgram(USER_B, created.space.inviteCode)));

    const err = await failureOf(ctx.provide(joinSpaceProgram(USER_C, created.space.inviteCode)));
    expect((err as { _tag: string })._tag).toBe('BadRequestError');

    // No third membership was inserted, and the redeem guard held.
    expect(ctx.d1.rawDb.prepare('select count(*) as n from space_members').get()).toEqual({ n: 2 });
  });

  it('rejects self-join (creator redeeming their own invite) → conflict', async () => {
    const ctx = makeCtx();
    insertUser(ctx.d1, USER_A, 'a@example.com', 'Alice');

    const created = await run(ctx.provide(createSpaceProgram(USER_A, {
      name: 'Our Space',
      relationshipStartDate: '2026-01-15',
    })));

    const err = await failureOf(ctx.provide(joinSpaceProgram(USER_A, created.space.inviteCode)));
    expect(err).toBeInstanceOf(ConflictError);
  });

  it('rejects joining when the user already has an active space in another flow → 409', async () => {
    const ctx = makeCtx();
    insertUser(ctx.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.d1, USER_B, 'b@example.com', 'Bob');

    const createdA = await run(ctx.provide(createSpaceProgram(USER_A, {
      name: 'A Space',
      relationshipStartDate: '2026-01-15',
    })));
    const createdB = await run(ctx.provide(createSpaceProgram(USER_B, {
      name: 'B Space',
      relationshipStartDate: '2026-01-15',
    })));

    // USER_B already has an active space; joining A's invite hits the
    // active-membership unique inside the batch → 409 (mapped in the program).
    const err = await failureOf(ctx.provide(joinSpaceProgram(USER_B, createdA.space.inviteCode)));
    expect(err).toBeInstanceOf(ConflictError);
    void createdB;
  });

  it('rejects invalid and expired invite codes', async () => {
    const ctx = makeCtx();
    insertUser(ctx.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.d1, USER_B, 'b@example.com', 'Bob');

    const invalidErr = await failureOf(ctx.provide(joinSpaceProgram(USER_B, 'ZZZZZZ')));
    expect((invalidErr as { _tag: string })._tag).toBe('NotFoundError');

    const created = await run(ctx.provide(createSpaceProgram(USER_A, {
      name: 'Our Space',
      relationshipStartDate: '2026-01-15',
    })));
    ctx.d1.runSync(
      'update space_invites set expires_at = ? where code_normalized = ?',
      1,
      normalizeInviteCode(created.space.inviteCode)
    );
    const expiredErr = await failureOf(ctx.provide(joinSpaceProgram(USER_B, created.space.inviteCode)));
    expect((expiredErr as { _tag: string })._tag).toBe('BadRequestError');
  });
});

describe('leaveSpaceProgram', () => {
  it('flips state to left and frees the active slot (create again works)', async () => {
    const ctx = makeCtx();
    insertUser(ctx.d1, USER_A, 'a@example.com', 'Alice');

    await run(ctx.provide(createSpaceProgram(USER_A, {
      name: 'First',
      relationshipStartDate: '2026-01-15',
    })));

    const left = await run(ctx.provide(leaveSpaceProgram(USER_A)));
    expect(left).toEqual({ ok: true });

    const member = ctx.d1.rawDb
      .prepare('select state, left_at from space_members where user_id = ?')
      .get(USER_A) as { state: string; left_at: number | null };
    expect(member.state).toBe('left');
    expect(member.left_at).toBeTypeOf('number');

    // The partial unique no longer sees an active membership → create succeeds.
    const created = await run(ctx.provide(createSpaceProgram(USER_A, {
      name: 'Second',
      relationshipStartDate: '2026-02-01',
    })));
    expect(created.space.name).toBe('Second');
  });

  it('404s when there is no active space', async () => {
    const ctx = makeCtx();
    insertUser(ctx.d1, USER_A, 'a@example.com', 'Alice');

    const err = await failureOf(ctx.provide(leaveSpaceProgram(USER_A)));
    expect(err).toBeInstanceOf(NotFoundError);
  });

  it('a partner leaving does NOT free the slot for a new partner (pairing isolation)', async () => {
    const ctx = makeCtx();
    insertUser(ctx.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.d1, USER_B, 'b@example.com', 'Bob');
    insertUser(ctx.d1, USER_C, 'c@example.com', 'Carol');

    const created = await run(ctx.provide(createSpaceProgram(USER_A, {
      name: 'Our Space',
      relationshipStartDate: '2026-01-15',
    })));
    await run(ctx.provide(joinSpaceProgram(USER_B, created.space.inviteCode)));

    await run(ctx.provide(leaveSpaceProgram(USER_B)));

    // Carol attempts the same space with a fresh, valid, unredeemed invite.
    ctx.d1.runSync(
      "insert into space_invites (id, space_id, code, code_normalized, created_by_user_id, expires_at, created_at) values ('inv2', ?, 'NEWCOD', 'NEWCOD', ?, ?, ?)",
      created.space.id,
      USER_A,
      Date.now() + 30 * 24 * 60 * 60 * 1000,
      Date.now()
    );
    const err = await failureOf(ctx.provide(joinSpaceProgram(USER_C, 'NEWCOD')));
    expect(err).toBeInstanceOf(ForbiddenError);

    // No membership row was created for Carol.
    const memberRow = ctx.d1.rawDb
      .prepare('select user_id from space_members where space_id = ? and user_id = ?')
      .get(created.space.id, USER_C);
    expect(memberRow).toBeUndefined();
  });

  it('the bound former partner cannot rejoin either (fail-closed)', async () => {
    const ctx = makeCtx();
    insertUser(ctx.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.d1, USER_B, 'b@example.com', 'Bob');

    const created = await run(ctx.provide(createSpaceProgram(USER_A, {
      name: 'Our Space',
      relationshipStartDate: '2026-01-15',
    })));
    await run(ctx.provide(joinSpaceProgram(USER_B, created.space.inviteCode)));
    await run(ctx.provide(leaveSpaceProgram(USER_B)));

    ctx.d1.runSync(
      "insert into space_invites (id, space_id, code, code_normalized, created_by_user_id, expires_at, created_at) values ('inv2', ?, 'NEWCOD', 'NEWCOD', ?, ?, ?)",
      created.space.id,
      USER_A,
      Date.now() + 30 * 24 * 60 * 60 * 1000,
      Date.now()
    );
    const err = await failureOf(ctx.provide(joinSpaceProgram(USER_B, 'NEWCOD')));
    expect(err).toBeInstanceOf(ConflictError);
  });
});

describe('getActiveSpaceId / getCurrentSpaceProgram', () => {
  it('returns null for a user with no space', async () => {
    const ctx = makeCtx();
    insertUser(ctx.d1, USER_A, 'a@example.com', 'Alice');

    expect(await run(ctx.provide(getActiveSpaceId(USER_A)))).toBeNull();
    expect(await run(ctx.provide(getCurrentSpaceProgram(USER_A)))).toEqual({ space: null });
  });

  it('returns the active space + invite', async () => {
    const ctx = makeCtx();
    insertUser(ctx.d1, USER_A, 'a@example.com', 'Alice');

    const created = await run(ctx.provide(createSpaceProgram(USER_A, {
      name: 'Our Space',
      partnerName: 'Bob',
      relationshipStartDate: '2026-01-15',
    })));

    const spaceId = await run(ctx.provide(getActiveSpaceId(USER_A)));
    expect(spaceId).toBe(created.space.id);

    const current = await run(ctx.provide(getCurrentSpaceProgram(USER_A)));
    expect(current.space?.inviteCode).toBe(created.space.inviteCode);
  });

  it('hides archived spaces', async () => {
    const ctx = makeCtx();
    insertUser(ctx.d1, USER_A, 'a@example.com', 'Alice');

    const created = await run(ctx.provide(createSpaceProgram(USER_A, {
      name: 'Our Space',
      relationshipStartDate: '2026-01-15',
    })));
    ctx.d1.runSync('update spaces set archived_at = ? where id = ?', Date.now(), created.space.id);

    expect(await run(ctx.provide(getCurrentSpaceProgram(USER_A)))).toEqual({ space: null });
  });
});

describe('updateSpaceProgram', () => {
  it('lets the creator update name/partnerName/date', async () => {
    const ctx = makeCtx();
    insertUser(ctx.d1, USER_A, 'a@example.com', 'Alice');

    await run(ctx.provide(createSpaceProgram(USER_A, {
      name: 'Our Space',
      partnerName: 'Bob',
      relationshipStartDate: '2026-01-15',
    })));

    const updated = await run(ctx.provide(updateSpaceProgram(USER_A, {
      name: 'Renamed',
      partnerName: 'Robert',
    })));
    expect(updated.space.name).toBe('Renamed');
    expect(updated.space.partnerName).toBe('Robert');
    expect(updated.space.relationshipStartDate).toBe('2026-01-15');
  });

  it('forbids non-creator updates', async () => {
    const ctx = makeCtx();
    insertUser(ctx.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.d1, USER_B, 'b@example.com', 'Bob');

    const created = await run(ctx.provide(createSpaceProgram(USER_A, {
      name: 'Our Space',
      relationshipStartDate: '2026-01-15',
    })));
    await run(ctx.provide(joinSpaceProgram(USER_B, created.space.inviteCode)));

    const err = await failureOf(ctx.provide(updateSpaceProgram(USER_B, { name: 'Hacked' })));
    expect((err as { _tag: string })._tag).toBe('ForbiddenError');
  });

  it('leave deletes the caller location share (privacy hygiene)', async () => {
    const ctx = makeCtx();
    insertUser(ctx.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.d1, USER_B, 'b@example.com', 'Bob');

    const created = await run(ctx.provide(createSpaceProgram(USER_A, {
      name: 'Our Space',
      partnerName: 'Bob',
      relationshipStartDate: '2026-01-15',
    })));
    await run(ctx.provide(joinSpaceProgram(USER_B, created.space.inviteCode)));

    // Seed a live share for USER_A (both consents set directly).
    const now = Date.parse('2026-01-15T00:00:00.000Z');
    ctx.d1.runSync(
      'update space_members set location_consent_at = ? where space_id = ? and user_id = ?',
      now,
      created.space.id,
      USER_A
    );
    ctx.d1.runSync(
      'update space_members set location_consent_at = ? where space_id = ? and user_id = ?',
      now,
      created.space.id,
      USER_B
    );
    await run(ctx.provide(shareLocationProgram(USER_A, { mode: 'live', latitude: 1, longitude: 2 })));

    const before = ctx.d1.rawDb
      .prepare('select count(*) as n from location_shares where user_id = ?')
      .get(USER_A) as { n: number };
    expect(before.n).toBe(1);

    await run(ctx.provide(leaveSpaceProgram(USER_A)));

    // Leaving must not leave a position behind in the old space's scope.
    const after = ctx.d1.rawDb
      .prepare('select count(*) as n from location_shares where user_id = ?')
      .get(USER_A) as { n: number };
    expect(after.n).toBe(0);
  });
});
