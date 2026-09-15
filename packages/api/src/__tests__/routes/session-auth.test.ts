import { describe, expect, it } from 'vitest';

import { createApp } from '../../create-app';
import { makeTestHarness, type ShimD1 } from '../../effects/test-harness';

/**
 * Route-level contract tests for the worker auth shell (`createApp` +
 * `routes/session-auth.ts`) — the HTTP-facing Bearer contract the mobile
 * client consumes. Domain behavior (resolution, refresh, revocation,
 * deletion) is pinned in depth in auth-domains.test.ts; these tests assert
 * the transport: status codes, the canonical `{error:{code,message}}`
 * envelope, and the exact response shapes.
 */

const USER_A = '00000000-0000-4000-8000-000000000001';

function insertUser(d1: ShimD1, id: string, email: string, name: string): void {
  d1.runSync(
    'insert into users (id, email, name, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?)',
    id,
    email,
    name,
    Date.parse('2026-01-15T00:00:00.000Z'),
    Date.parse('2026-01-15T00:00:00.000Z')
  );
}

function insertSession(
  d1: ShimD1,
  id: string,
  userId: string,
  token: string,
  expiresAtMs: number
): void {
  d1.runSync(
    'insert into user_sessions (id, user_id, token, expires_at, created_at, updated_at) values (?, ?, ?, ?, ?, ?)',
    id,
    userId,
    token,
    expiresAtMs,
    Date.parse('2026-01-15T00:00:00.000Z'),
    Date.parse('2026-01-15T00:00:00.000Z')
  );
}

function insertPushToken(d1: ShimD1, userId: string): void {
  d1.runSync(
    'insert into push_tokens (id, user_id, expo_push_token, platform, created_at, last_seen_at) values (?, ?, ?, ?, ?, ?)',
    'push-1',
    userId,
    'ExponentPushToken[test-token-123]',
    'ios',
    Date.parse('2026-01-15T00:00:00.000Z'),
    Date.parse('2026-01-15T00:00:00.000Z')
  );
}

function makeApp() {
  const harness = makeTestHarness();
  const app = createApp(harness.layer);
  return { harness, app };
}

const TOKEN = 'session-token-abc123';
const EXPIRY = Date.parse('2026-01-22T00:00:00.000Z');

describe('worker auth routes (Bearer contract)', () => {
  it('GET /v1/auth/session returns { authenticated, user, expiresAt } for a live token', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'aoi@example.com', 'Aoi');
    insertSession(harness.d1, 'sess-1', USER_A, TOKEN, EXPIRY);

    const res = await app.request('/v1/auth/session', {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      authenticated: true,
      user: {
        id: USER_A,
        email: 'aoi@example.com',
        displayName: 'Aoi',
        createdAt: '2026-01-15T00:00:00.000Z',
      },
      expiresAt: '2026-01-22T00:00:00.000Z',
    });
  });

  it('GET /v1/auth/session → 401 envelope without a token', async () => {
    const { app } = makeApp();

    const res = await app.request('/v1/auth/session');

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(typeof body.error.message).toBe('string');
  });

  it('GET /v1/auth/session → 401 for a revoked/unknown token', async () => {
    const { app } = makeApp();

    const res = await app.request('/v1/auth/session', {
      headers: { Authorization: 'Bearer unknown-token' },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('POST /v1/auth/refresh extends the session and returns the token contract', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'aoi@example.com', 'Aoi');
    // Session expiring in 5 days (clock is 2026-01-15) — refresh must slide
    // it to clock-now + TTL (2026-01-22).
    insertSession(harness.d1, 'sess-1', USER_A, TOKEN, Date.parse('2026-01-20T00:00:00.000Z'));

    const res = await app.request('/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: TOKEN }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accessToken).toBe(TOKEN);
    expect(body.refreshToken).toBe(TOKEN);
    expect(body.expiresInSec).toBe(7 * 24 * 60 * 60);

    // The DB row was extended (sliding window): expiry = clock now + TTL.
    const row = await harness.d1
      .prepare('select expires_at from user_sessions where id = ?')
      .bind('sess-1')
      .first<{ expires_at: number }>();
    expect(row?.expires_at).toBe(EXPIRY);
  });

  it('POST /v1/auth/refresh → 401 for an expired session', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'aoi@example.com', 'Aoi');
    insertSession(harness.d1, 'sess-1', USER_A, TOKEN, Date.parse('2026-01-10T00:00:00.000Z'));

    const res = await app.request('/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: TOKEN }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('POST /v1/auth/logout revokes the token (session then 401s)', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'aoi@example.com', 'Aoi');
    insertSession(harness.d1, 'sess-1', USER_A, TOKEN, EXPIRY);

    const logout = await app.request('/v1/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(logout.status).toBe(200);
    expect(await logout.json()).toEqual({ ok: true });

    const after = await app.request('/v1/auth/session', {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(after.status).toBe(401);
  });

  it('DELETE /v1/auth/account soft-deletes the user, revokes sessions, and leaves the space', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'aoi@example.com', 'Aoi');
    insertSession(harness.d1, 'sess-1', USER_A, TOKEN, EXPIRY);
    insertPushToken(harness.d1, USER_A);
    harness.d1.runSync(
      'insert into spaces (id, name, relationship_start_date, created_by_user_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?)',
      'space-1',
      'Our Space',
      '2026-01-01',
      USER_A,
      Date.parse('2026-01-15T00:00:00.000Z'),
      Date.parse('2026-01-15T00:00:00.000Z')
    );
    harness.d1.runSync(
      "insert into space_members (space_id, user_id, role, state, joined_at) values (?, ?, 'you', 'active', ?)",
      'space-1',
      USER_A,
      Date.parse('2026-01-15T00:00:00.000Z')
    );

    const res = await app.request('/v1/auth/account', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const user = await harness.d1
      .prepare('select deleted_at from users where id = ?')
      .bind(USER_A)
      .first<{ deleted_at: number | null }>();
    expect(user?.deleted_at).not.toBeNull();

    const sessions = await harness.d1
      .prepare('select count(*) as n from user_sessions where user_id = ?')
      .bind(USER_A)
      .first<{ n: number }>();
    expect(sessions?.n).toBe(0);

    const push = await harness.d1
      .prepare('select count(*) as n from push_tokens where user_id = ?')
      .bind(USER_A)
      .first<{ n: number }>();
    expect(push?.n).toBe(0);

    const member = await harness.d1
      .prepare('select state from space_members where user_id = ? and space_id = ?')
      .bind(USER_A, 'space-1')
      .first<{ state: string }>();
    expect(member?.state).toBe('left');

    // The deleted user's session must now 401.
    const after = await app.request('/v1/auth/session', {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(after.status).toBe(401);
  });

  it('POST /v1/push/tokens rejects a malformed Expo token (format refine)', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'aoi@example.com', 'Aoi');
    insertSession(harness.d1, 'sess-1', USER_A, TOKEN, EXPIRY);

    const res = await app.request('/v1/push/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ expoPushToken: 'not-a-valid-expo-token' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('POST /v1/push/tokens accepts a well-formed token', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'aoi@example.com', 'Aoi');
    insertSession(harness.d1, 'sess-1', USER_A, TOKEN, EXPIRY);

    const res = await app.request('/v1/push/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ expoPushToken: 'ExpoPushToken[AbCdEf12_345]', platform: 'ios' }),
    });

    expect(res.status).toBe(200);
  });

  it('POST /v1/auth/apple → 401 (not 500) for an idToken that fails verification', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'aoi@example.com', 'Aoi');
    // No session needed: sign-in is public, but the placeholder provider
    // creds mean Better Auth's verifyIdToken rejects any real-looking token.

    const res = await app.request('/v1/auth/apple', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'apple',
        platform: 'ios',
        idToken: 'eyJhbGciOiJSUzI1NiJ9.fake.fake',
        nonce: 'some-nonce',
      }),
    });

    // Invalid credentials must be a 401 — a 500 would tell the client the
    // server is broken when the token was simply rejected.
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('legacy WorkOS endpoints answer a fixed 400 (no longer available)', async () => {
    const { app } = makeApp();

    const res = await app.request('/v1/auth/workos/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'whatever' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
  });
});
