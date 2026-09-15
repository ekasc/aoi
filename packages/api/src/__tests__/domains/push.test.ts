import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';

import { makeTestHarness, type ShimD1 } from '../../effects/test-harness';
import {
  MAX_PUSH_TOKENS_PER_USER,
  registerPushTokenProgram,
  unregisterPushTokenProgram,
} from '../../domains/push';

/**
 * Push token registry — device-scoped upsert (re-register refreshes, a token
 * re-registered by another user is reassigned), per-user cap, caller-scoped
 * unregister with no existence leaks.
 */

const USER_A = '00000000-0000-4000-8000-000000000001';
const USER_B = '00000000-0000-4000-8000-000000000002';
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

describe('registerPushTokenProgram', () => {
  it('registers a token and echoes id + platform (never the token itself)', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');

    const result = await run(
      ctx.provide(registerPushTokenProgram(USER_A, { expoPushToken: 'ExponentPushToken[aaa]', platform: 'ios' }))
    );
    expect(result.platform).toBe('ios');
    expect(result.id.length).toBeGreaterThan(0);

    const row = ctx.harness.d1.rawDb
      .prepare('select user_id, platform from push_tokens where expo_push_token = ?')
      .get('ExponentPushToken[aaa]') as { user_id: string; platform: string };
    expect(row.user_id).toBe(USER_A);
    expect(row.platform).toBe('ios');
  });

  it('re-registering the same token refreshes it in place (single row)', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');

    await run(ctx.provide(registerPushTokenProgram(USER_A, { expoPushToken: 'ExponentPushToken[bbb]', platform: 'ios' })));
    ctx.harness.clock.advance(60_000);
    await run(ctx.provide(registerPushTokenProgram(USER_A, { expoPushToken: 'ExponentPushToken[bbb]', platform: 'android' })));

    const rows = ctx.harness.d1.rawDb
      .prepare('select platform, last_seen_at from push_tokens where expo_push_token = ?')
      .all('ExponentPushToken[bbb]') as unknown as { platform: string; last_seen_at: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].platform).toBe('android');
    expect(rows[0].last_seen_at).toBe(T0 + 60_000);
  });

  it('reassigns a token re-registered by a different user (device-scoped)', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');

    await run(ctx.provide(registerPushTokenProgram(USER_A, { expoPushToken: 'ExponentPushToken[ccc]' })));
    await run(ctx.provide(registerPushTokenProgram(USER_B, { expoPushToken: 'ExponentPushToken[ccc]' })));

    const row = ctx.harness.d1.rawDb
      .prepare('select user_id from push_tokens where expo_push_token = ?')
      .get('ExponentPushToken[ccc]') as { user_id: string };
    expect(row.user_id).toBe(USER_B);
    const count = ctx.harness.d1.rawDb.prepare('select count(*) as n from push_tokens').get() as { n: number };
    expect(count.n).toBe(1);
  });

  it('caps per-user registrations at the newest MAX tokens', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');

    for (let i = 0; i < MAX_PUSH_TOKENS_PER_USER + 25; i++) {
      await run(ctx.provide(registerPushTokenProgram(USER_A, { expoPushToken: `ExponentPushToken[cap-${i}]` })));
      ctx.harness.clock.advance(1);
    }

    const count = ctx.harness.d1.rawDb.prepare('select count(*) as n from push_tokens where user_id = ?').get(USER_A) as { n: number };
    expect(count.n).toBe(MAX_PUSH_TOKENS_PER_USER);
    // The oldest tokens were trimmed (cap-0 is gone), the newest remain.
    const oldest = ctx.harness.d1.rawDb
      .prepare('select count(*) as n from push_tokens where expo_push_token = ?')
      .get('ExponentPushToken[cap-0]') as { n: number };
    expect(oldest.n).toBe(0);
    const newest = ctx.harness.d1.rawDb
      .prepare('select count(*) as n from push_tokens where expo_push_token = ?')
      .get(`ExponentPushToken[cap-${MAX_PUSH_TOKENS_PER_USER + 24}]`) as { n: number };
    expect(newest.n).toBe(1);
  });
});

describe('unregisterPushTokenProgram', () => {
  it('removes only the caller\'s own token; identical response when absent', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    await run(ctx.provide(registerPushTokenProgram(USER_A, { expoPushToken: 'ExponentPushToken[ddd]' })));
    await run(ctx.provide(registerPushTokenProgram(USER_B, { expoPushToken: 'ExponentPushToken[eee]' })));

    // Bob cannot remove Alice's token.
    await run(ctx.provide(unregisterPushTokenProgram(USER_B, 'ExponentPushToken[ddd]')));
    const stillThere = ctx.harness.d1.rawDb
      .prepare('select count(*) as n from push_tokens where expo_push_token = ?')
      .get('ExponentPushToken[ddd]') as { n: number };
    expect(stillThere.n).toBe(1);

    // Alice removes her own — identical { ok: true } shape.
    const result = await run(ctx.provide(unregisterPushTokenProgram(USER_A, 'ExponentPushToken[ddd]')));
    expect(result).toEqual({ ok: true });

    // Removing an unknown token still returns { ok: true }.
    const absent = await run(ctx.provide(unregisterPushTokenProgram(USER_A, 'ExponentPushToken[nope]')));
    expect(absent).toEqual({ ok: true });
  });
});
