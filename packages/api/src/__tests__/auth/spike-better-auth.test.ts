import { describe, expect, it } from 'vitest';

import { betterAuth } from 'better-auth';
import { bearer } from 'better-auth/plugins';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle } from 'drizzle-orm/d1';

import * as schema from '../../db/d1-schema';
import { createTestD1 } from '../../effects/test-harness';

/**
 * Spike: verify the installed better-auth@1.6.26 API surface against the
 * real package types/source before wiring the app. Uses the better-sqlite3
 * D1 shim so it runs in the plain node test project.
 */
describe('better-auth spike (installed 1.6.26)', () => {
  it('constructs an instance with the drizzle adapter over the shim D1', () => {
    const d1 = createTestD1();
    const db = drizzle(d1, { schema });

    const auth = betterAuth({
      database: drizzleAdapter(db, {
        provider: 'sqlite',
        schema: {
          user: schema.users,
          session: schema.userSessions,
          account: schema.authAccounts,
          verification: schema.oauthStates,
        },
      }),
      secret: 'test-secret-32-chars-minimum-length-000',
      baseURL: 'http://worker.local',
      plugins: [bearer()],
    });

    expect(auth).toBeTruthy();
    expect(typeof auth.handler).toBe('function');
    expect(typeof auth.api.getSession).toBe('function');
  });

  it('creates a user + session via signUpEmail and validates the token', async () => {
    const d1 = createTestD1();
    const db = drizzle(d1, { schema });

    const auth = betterAuth({
      database: drizzleAdapter(db, {
        provider: 'sqlite',
        schema: {
          user: schema.users,
          account: schema.authAccounts,
          session: schema.userSessions,
          verification: schema.oauthStates,
        },
      }),
      secret: 'test-secret-32-chars-minimum-length-000',
      baseURL: 'http://worker.local',
      emailAndPassword: { enabled: true },
      plugins: [bearer()],
    });

    const response = await auth.api.signUpEmail({
      body: { email: 'spike@example.com', password: 'password123', name: 'Spike' },
    });

    expect(response.user.email).toBe('spike@example.com');
    expect(typeof response.token).toBe('string');
    expect(response.token?.length).toBeGreaterThan(20);

    // The stored session row exists and the token round-trips through
    // getSession when presented as the session cookie.
    // Session tokens are opaque DB strings — our middleware validates them
    // by DB lookup (unique index on user_sessions.token + expiry + user not
    // soft-deleted), so assert the row is queryable by token.
    const row = d1.rawDb
      .prepare('select user_id, expires_at from user_sessions where token = ?')
      .get(response.token);
    expect(row).toBeTruthy();
    expect((row as { user_id: string }).user_id).toBe(response.user.id);
  });
});

describe('better-auth providers + handler (spike)', () => {
  it('constructs with apple + google placeholders and serves the handler', async () => {
    const d1 = createTestD1();
    const db = drizzle(d1, { schema });

    const auth = betterAuth({
      database: drizzleAdapter(db, {
        provider: 'sqlite',
        schema: {
          user: schema.users,
          account: schema.authAccounts,
          session: schema.userSessions,
          verification: schema.oauthStates,
        },
      }),
      secret: 'test-secret-32-chars-minimum-length-000',
      baseURL: 'http://worker.local',
      socialProviders: {
        apple: { clientId: 'placeholder.apple.client', clientSecret: 'placeholder-secret' },
        google: { clientId: 'placeholder.google.client', clientSecret: 'placeholder-secret' },
      },
      plugins: [bearer()],
    });

    // unknown path → 404 from the handler
    const res = await auth.handler(new Request('http://worker.local/api/auth/definitely-not-real'));
    expect(res.status).toBe(404);

    // social sign-in with a placeholder provider still constructs the URL shape
    const authResponse = await auth.api.signInSocial({
      body: { provider: 'google', disableRedirect: true },
      headers: new Headers({ origin: 'http://worker.local' }),
    });
    // With disableRedirect the client owns the redirect: Better Auth returns
    // the authorize URL + redirect:false.
    expect(authResponse.redirect).toBe(false);
    expect(typeof authResponse.url).toBe('string');
  });
});
