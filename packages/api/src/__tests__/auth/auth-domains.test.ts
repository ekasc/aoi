import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';

import { makeTestHarness, type ShimD1 } from '../../effects/test-harness';
import {
  deleteAccountProgram,
  getSessionProgram,
  refreshSessionProgram,
  resolveSessionByToken,
  signOutProgram,
} from '../../domains/auth';

/**
 * Auth domain tests — account/session lifecycle on the real D1 baseline.
 * Sessions are minted by inserting Better-Auth-shaped rows directly (the
 * token is an opaque string; Better Auth itself mints them on sign-in, which
 * requires real provider credentials — a user gate).
 */

const USER_ID = '00000000-0000-4000-8000-000000000001';
const TOKEN = 'opaque-session-token-1234567890';

function insertUser(d1: ShimD1, id: string, email: string, name: string, deleted = false): void {
  d1.runSync(
    `insert into users (id, email, name, email_verified, deleted_at) values (?, ?, ?, 1, ${deleted ? Date.now() : 'NULL'})`,
    id,
    email,
    name
  );
}

function insertSession(
  d1: ShimD1,
  id: string,
  userId: string,
  token: string,
  expiresAt: number
): void {
  d1.runSync(
    'insert into user_sessions (id, user_id, token, expires_at) values (?, ?, ?, ?)',
    id,
    userId,
    token,
    expiresAt
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

const EXPIRY_FUTURE = Date.parse('2026-01-20T00:00:00.000Z'); // harness clock is 2026-01-15

describe('resolveSessionByToken', () => {
  it('resolves a live session to user + expiry', async () => {
    const ctx = makeCtx();
    insertUser(ctx.d1, USER_ID, 'alice@example.com', 'Alice');
    insertSession(ctx.d1, 's1', USER_ID, TOKEN, EXPIRY_FUTURE);

    const resolved = await run(ctx.provide(resolveSessionByToken(TOKEN)));
    expect(resolved).not.toBeNull();
    expect(resolved?.userId).toBe(USER_ID);
    expect(resolved?.sessionId).toBe('s1');
    expect(resolved?.user.displayName).toBe('Alice');
    expect(resolved?.user.email).toBe('alice@example.com');
    expect(new Date(resolved?.expiresAt ?? '').getTime()).toBe(EXPIRY_FUTURE);
  });

  it('returns null for an unknown token', async () => {
    const ctx = makeCtx();
    insertUser(ctx.d1, USER_ID, 'alice@example.com', 'Alice');
    expect(await run(ctx.provide(resolveSessionByToken('nope')))).toBeNull();
  });

  it('returns null for an expired session', async () => {
    const ctx = makeCtx();
    insertUser(ctx.d1, USER_ID, 'alice@example.com', 'Alice');
    insertSession(ctx.d1, 's1', USER_ID, TOKEN, Date.parse('2026-01-01T00:00:00.000Z'));
    expect(await run(ctx.provide(resolveSessionByToken(TOKEN)))).toBeNull();
  });

  it('returns null when the user is soft-deleted', async () => {
    const ctx = makeCtx();
    insertUser(ctx.d1, USER_ID, 'alice@example.com', 'Alice', true);
    insertSession(ctx.d1, 's1', USER_ID, TOKEN, EXPIRY_FUTURE);
    expect(await run(ctx.provide(resolveSessionByToken(TOKEN)))).toBeNull();
  });

  // (A session for a missing user cannot exist: user_sessions.user_id is a
  // foreign key to users.id with cascade — the storage layer enforces it.)
});

describe('getSessionProgram', () => {
  it('returns the contract shape { authenticated, user, expiresAt }', async () => {
    const ctx = makeCtx();
    insertUser(ctx.d1, USER_ID, 'alice@example.com', 'Alice');
    insertSession(ctx.d1, 's1', USER_ID, TOKEN, EXPIRY_FUTURE);

    const result = await run(ctx.provide(getSessionProgram(TOKEN)));
    expect(result.authenticated).toBe(true);
    expect(result.user.id).toBe(USER_ID);
    expect(result.user.displayName).toBe('Alice');
    expect(result.expiresAt).toBe(new Date(EXPIRY_FUTURE).toISOString());
  });

  it('fails with UnauthorizedError for a dead token', async () => {
    const ctx = makeCtx();
    insertUser(ctx.d1, USER_ID, 'alice@example.com', 'Alice');
    const exit = await Effect.runPromise(
      Effect.exit(ctx.provide(getSessionProgram('dead-token')) as Effect.Effect<unknown, unknown, never>)
    );
    expect(exit._tag).toBe('Failure');
  });
});

describe('refreshSessionProgram', () => {
  it('extends the expiry and returns the token contract', async () => {
    const ctx = makeCtx();
    insertUser(ctx.d1, USER_ID, 'alice@example.com', 'Alice');
    insertSession(ctx.d1, 's1', USER_ID, TOKEN, EXPIRY_FUTURE);

    const result = await run(ctx.provide(refreshSessionProgram(TOKEN)));
    expect(result.accessToken).toBe(TOKEN);
    expect(result.refreshToken).toBe(TOKEN);
    expect(result.expiresInSec).toBe(7 * 24 * 60 * 60);

    const row = ctx.d1.rawDb
      .prepare('select expires_at from user_sessions where token = ?')
      .get(TOKEN) as { expires_at: number };
    expect(row.expires_at).toBeGreaterThan(EXPIRY_FUTURE);
  });

  it('fails with UnauthorizedError for a dead token', async () => {
    const ctx = makeCtx();
    insertUser(ctx.d1, USER_ID, 'alice@example.com', 'Alice');
    const exit = await Effect.runPromise(
      Effect.exit(ctx.provide(refreshSessionProgram('dead-token')) as Effect.Effect<unknown, unknown, never>)
    );
    expect(exit._tag).toBe('Failure');
  });
});

describe('signOutProgram', () => {
  it('deletes the session row (token dies immediately)', async () => {
    const ctx = makeCtx();
    insertUser(ctx.d1, USER_ID, 'alice@example.com', 'Alice');
    insertSession(ctx.d1, 's1', USER_ID, TOKEN, EXPIRY_FUTURE);

    await run(ctx.provide(signOutProgram(TOKEN)));
    expect(ctx.d1.rawDb.prepare('select count(*) as n from user_sessions').get()).toEqual({ n: 0 });
    // And the token no longer resolves.
    expect(await run(ctx.provide(resolveSessionByToken(TOKEN)))).toBeNull();
  });
});

describe('deleteAccountProgram', () => {
  it('soft-deletes the user, revokes sessions, drops push tokens, and leaves the space', async () => {
    const ctx = makeCtx();
    insertUser(ctx.d1, USER_ID, 'alice@example.com', 'Alice');
    insertSession(ctx.d1, 's1', USER_ID, TOKEN, EXPIRY_FUTURE);
    ctx.d1.runSync(
      "insert into push_tokens (id, user_id, expo_push_token) values ('p1', ?, 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]')",
      USER_ID
    );
    // Give Alice an active space membership.
    ctx.d1.runSync(
      'insert into spaces (id, name, relationship_start_date, created_by_user_id) values (?, ?, ?, ?)',
      'sp1',
      'Our Space',
      '2026-01-01',
      USER_ID
    );
    ctx.d1.runSync(
      "insert into space_members (space_id, user_id, role, state) values (?, ?, 'you', 'active')",
      'sp1',
      USER_ID
    );

    const result = await run(ctx.provide(deleteAccountProgram(USER_ID)));
    expect(result).toEqual({ ok: true });

    expect(ctx.d1.rawDb.prepare('select count(*) as n from user_sessions').get()).toEqual({ n: 0 });
    expect(ctx.d1.rawDb.prepare('select count(*) as n from push_tokens').get()).toEqual({ n: 0 });
    const member = ctx.d1.rawDb
      .prepare("select state, left_at from space_members where user_id = ?")
      .get(USER_ID) as { state: string; left_at: number | null };
    expect(member.state).toBe('left');
    expect(member.left_at).toBeTypeOf('number');
    const user = ctx.d1.rawDb.prepare('select deleted_at from users where id = ?').get(USER_ID) as {
      deleted_at: number | null;
    };
    expect(user.deleted_at).toBeTypeOf('number');

    // The deleted user can no longer authenticate.
    expect(await run(ctx.provide(resolveSessionByToken(TOKEN)))).toBeNull();
  });

  it('is idempotent for an already-deleted user', async () => {
    const ctx = makeCtx();
    insertUser(ctx.d1, USER_ID, 'alice@example.com', 'Alice', true);
    const result = await run(ctx.provide(deleteAccountProgram(USER_ID)));
    expect(result).toEqual({ ok: true });
  });
});
