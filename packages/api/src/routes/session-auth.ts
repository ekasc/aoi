import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { Effect } from 'effect';

import type { User } from '@aoi/shared';
import {
  oauthGoogleIdTokenRequestSchema,
  oauthNativeCallbackRequestSchema,
  refreshRequestSchema,
  sessionResponseSchema,
} from '@aoi/shared';

import type { RunProgram } from '../create-app';
import { BetterAuth, SESSION_TTL_SEC, type BetterAuthService } from '../auth/better-auth';
import {
  deleteAccountProgram,
  getSessionProgram,
  refreshSessionProgram,
  requireToken,
  signOutProgram,
} from '../domains/auth';
import { makeAuthMiddleware } from '../middleware/session';
import { makeRateLimitMiddleware } from '../middleware/session-rate-limit';
import { InternalError, UnauthorizedError, badRequest } from '../domains/errors';

/**
 * Auth routes (worker) — thin adapters over Better Auth that preserve the
 * client's Bearer contract (`packages/shared/src/auth.ts` shapes):
 * - GET    /v1/auth/session   → { authenticated, user, expiresAt }
 * - POST   /v1/auth/refresh   → { accessToken, refreshToken, expiresInSec }
 * - POST   /v1/auth/logout    → { ok: true }
  * - DELETE /v1/auth/account   → { ok: true } (identity purge + revoke)
 * - POST   /v1/auth/apple     → Better Auth idToken branch (native Apple)
 * - POST   /v1/auth/google    → Better Auth idToken branch (native Google)
 *
 * Sign-in delegates to Better Auth's `sign-in/social` idToken branch: the
 * client obtains a provider idToken (expo-apple-authentication /
 * expo-auth-session) and posts it; Better Auth verifies the signature against
 * the provider's keys before creating/linking the user and minting a session.
 *
 * Better Auth's session token is the single opaque credential: it maps to
 * both accessToken and refreshToken on the wire (the client's contract keeps
 * both fields; there is no separate refresh token in Better Auth).
 *
 * NOTE: the legacy Node/Postgres app keeps its own `routes/auth.ts`
 * (WorkOS + hand-rolled JWT) — this is the Cloudflare worker's route set.
 */

function baUserToApiUser(u: {
  id: string;
  email: string;
  name: string;
  image?: string | null;
  emailVerified: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}): User {
  return {
    id: u.id,
    email: u.email,
    displayName: u.name,
    avatarUrl: u.image ?? undefined,
    createdAt: u.createdAt?.toISOString() ?? new Date().toISOString(),
  };
}

/** Sign in with a provider idToken (apple/google) → session tokens + user. */
const idTokenSignInProgram = (body: {
  provider: 'apple' | 'google';
  token: string;
  nonce?: string;
  displayName?: string;
}) =>
  Effect.gen(function* () {
    const ba = yield* BetterAuth;
    if (!ba.auth) {
      return yield* Effect.fail(new InternalError({}));
    }
    const result = yield* Effect.tryPromise({
      try: () =>
        ba.auth.api.signInSocial({
          body: {
            provider: body.provider,
            idToken: {
              token: body.token,
              nonce: body.nonce,
              user: body.displayName
                ? {
                    name: {
                      firstName: body.displayName.split(' ')[0] ?? body.displayName,
                      lastName: body.displayName.split(' ').slice(1).join(' ') || undefined,
                    },
                  }
                : undefined,
            },
          },
        }),
      catch: (cause) => {
        // Better Auth throws APIError(statusCode 401) for idTokens that fail
        // signature/audience/nonce verification — invalid credentials, not a
        // server fault. Map them to 401; everything else stays a fixed 500.
        if (
          cause &&
          typeof cause === 'object' &&
          'name' in cause &&
          cause.name === 'APIError'
        ) {
          const statusCode = (cause as { statusCode?: unknown }).statusCode;
          if (statusCode === 401) {
            return new UnauthorizedError({ message: 'Sign in failed. Please try again.' });
          }
        }
        return new InternalError({});
      },
    });

    // With an idToken body the response carries { token, user, redirect:false }.
    if (!('token' in result) || !result.token || !('user' in result) || !result.user) {
      return yield* Effect.fail(new InternalError({}));
    }

    return {
      accessToken: result.token,
      refreshToken: result.token,
      expiresInSec: SESSION_TTL_SEC,
      user: baUserToApiUser(result.user),
    };
  });

export function authRouter(run: RunProgram): Hono {
  const router = new Hono();
  const requireAuth = makeAuthMiddleware(run);
  // Sign-in and refresh are public (no session yet) and do expensive
  // provider-key verification — the AUTH tier exists specifically for them.
  // Keyed per-IP (pre-auth: no user id yet) so one attacker cannot exhaust
  // a shared anonymous bucket and block every legitimate sign-in.
  const rateLimitAuth = makeRateLimitMiddleware(run, 'AUTH', authRateLimitKey);

  // ── Native sign-in (Apple idToken) ───────────────────────────────────
  router.post(
    '/v1/auth/apple',
    rateLimitAuth,
    zValidator('json', oauthNativeCallbackRequestSchema),
    async (c) => {
      const body = c.req.valid('json');
      const payload = await run(
        idTokenSignInProgram({
          provider: 'apple',
          token: body.idToken,
          nonce: body.nonce,
          displayName: body.displayName,
        })
      );
      return c.json(payload);
    }
  );

  // ── Native sign-in (Google idToken) ──────────────────────────────────
  router.post(
    '/v1/auth/google',
    rateLimitAuth,
    zValidator('json', oauthGoogleIdTokenRequestSchema),
    async (c) => {
      const body = c.req.valid('json');
      const payload = await run(
        idTokenSignInProgram({
          provider: 'google',
          token: body.idToken,
          nonce: body.nonce,
          displayName: body.displayName,
        })
      );
      return c.json(payload);
    }
  );

  // ── Session ──────────────────────────────────────────────────────────
  router.get('/v1/auth/session', requireAuth, async (c) => {
    const token = c.req.header('Authorization')?.slice('Bearer '.length).trim() ?? '';
    const result = await run(getSessionProgram(token));
    return c.json(sessionResponseSchema.parse(result));
  });

  // ── Refresh ──────────────────────────────────────────────────────────
  router.post(
    '/v1/auth/refresh',
    rateLimitAuth,
    zValidator('json', refreshRequestSchema),
    async (c) => {
      const { refreshToken } = c.req.valid('json');
      const token = await run(requireToken(refreshToken));
      const result = await run(refreshSessionProgram(token));
      return c.json(result);
    }
  );

  // ── Logout ───────────────────────────────────────────────────────────
  router.post('/v1/auth/logout', requireAuth, async (c) => {
    const header = c.req.header('Authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    // Body refreshToken is accepted for contract compatibility; the session
    // token (from the header) is the credential actually revoked.
    await run(requireToken(token).pipe(Effect.flatMap(signOutProgram)));
    return c.json({ ok: true });
  });

  // ── Delete account ───────────────────────────────────────────────────
  router.delete('/v1/auth/account', requireAuth, async (c) => {
    const userId = c.var.userId;
    const result = await run(deleteAccountProgram(userId));
    return c.json(result);
  });

  // ── Legacy WorkOS endpoints: gone. Explicit fixed 400 so old clients
  // get a clear signal instead of a generic 404.
  router.post('/v1/auth/workos/authorize', async () => {
    throw badRequest('This sign-in method is no longer available');
  });
  router.post('/v1/auth/workos/callback', async () => {
    throw badRequest('This sign-in method is no longer available');
  });
  router.post('/v1/auth/workos/apple', async () => {
    throw badRequest('This sign-in method is no longer available');
  });

  return router;
}

export type { BetterAuthService };

/**
 * Auth-tier rate-limit key: per-IP for pre-auth endpoints (sign-in/refresh
 * have no user id yet). A shared anonymous bucket would let one attacker
 * exhaust the tier and block every legitimate sign-in; per-IP isolates them.
 * Falls back to 'anonymous' when neither CF nor X-Forwarded-For is present.
 */
export function authRateLimitKey(c: { req: { header(name: string): string | undefined } }): string {
  return (
    c.req.header('CF-Connecting-IP') ??
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ??
    'anonymous'
  );
}
