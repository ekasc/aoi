import { betterAuth } from 'better-auth';
import { bearer } from 'better-auth/plugins';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle } from 'drizzle-orm/d1';
import { Context, Effect, Layer } from 'effect';

import type { D1Database } from '../env';
import * as schema from '../db/d1-schema';
import { InternalError } from '../domains/errors';
import type { ConfigService } from '../effects/config';

/**
 * Better Auth integration — the single auth engine (Apple + Google).
 *
 * Wiring facts (verified against the installed better-auth@1.6.26):
 * - the drizzle adapter maps Better Auth's models to our D1 tables via a
 *   schema object (`user`/`session`/`account`/`verification`);
 * - session tokens are opaque random strings stored in `user_sessions.token`
 *   (unique index) — the middleware validates Bearer tokens by DB lookup
 *   (expiry + user-not-deleted), not by cookie-signature tricks;
 * - `sign-in/social` accepts an idToken branch for `apple`/`google`, which
 *   is exactly what the native mobile flow needs (expo-apple-authentication
 *   / expo-auth-session return idTokens);
 * - provider client IDs/secrets are config values (placeholders by default;
 *   real credentials via `wrangler secret put` — user-owned gate).
 */

export const BETTER_AUTH_BASE_PATH = '/api/auth';
export const SESSION_COOKIE_NAME = 'better-auth.session_token';

/** Session TTL (seconds) — mirrors Better Auth's default 7 days. */
export const SESSION_TTL_SEC = 7 * 24 * 60 * 60;

/** A constructed Better Auth instance (handler + api). */
export type BetterAuthInstance = ReturnType<typeof betterAuth>;

export interface BetterAuthService {
  /** The Better Auth instance (handler + api). */
  readonly auth: BetterAuthInstance;
}

export class BetterAuth extends Context.Tag('aoi/BetterAuth')<
  BetterAuthService,
  BetterAuthService
>() {}

export function makeBetterAuthService(
  d1: D1Database,
  config: ConfigService
): BetterAuthService {
  const secret = config.get('BETTER_AUTH_SECRET');
  const baseURL = config.get('APP_BASE_URL') ?? config.get('BETTER_AUTH_URL');

  // NEVER throw at construction: this service is merged into the runtime
  // layer, and Effect builds the whole merged layer graph on every provide
  // (even for /healthz, which needs nothing from auth). A missing secret or
  // base URL must degrade — auth routes fail with a fixed 500 via
  // `createApp`'s authHandler guard; every other route keeps working.
  const configured = secret !== undefined && secret !== '' && baseURL !== undefined && baseURL !== '';

  if (!configured) {
    return { auth: null as unknown as BetterAuthInstance };
  }

  const db = drizzle(d1, { schema });

  // The concrete options type is narrower than BetterAuthOptions; the cast
  // bridges the variance of `Auth<Options>` ($context/adapter are covariant
  // over options, so a concrete instance is not assignable to the generic
  // `ReturnType<typeof betterAuth>` without it).
  const auth = betterAuth({
    appName: 'Aoi',
    baseURL: baseURL,
    secret: secret,
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema: {
        user: schema.users,
        session: schema.userSessions,
        account: schema.authAccounts,
        verification: schema.oauthStates,
      },
    }),
    socialProviders: {
      apple: {
        clientId: config.get('APPLE_CLIENT_ID') ?? 'placeholder.apple.client',
        clientSecret:
          config.get('APPLE_CLIENT_SECRET') ?? 'placeholder-secret',
        // Native Apple idTokens carry `aud` = the app bundle identifier.
        // Verified against better-auth@1.6.26 source: verifyIdToken prefers
        // appBundleIdentifier over clientId as the jose audience — without
        // it, expo-apple-authentication tokens fail verification.
        appBundleIdentifier: config.get('APPLE_APP_BUNDLE_ID'),
      },
      google: {
        clientId: config.get('GOOGLE_CLIENT_ID') ?? 'placeholder.google.client',
        clientSecret:
          config.get('GOOGLE_CLIENT_SECRET') ?? 'placeholder-secret',
      },
    },
    plugins: [bearer()],
    advanced: {
      useSecureCookies: config.get('APP_ENV') === 'production',
    },
  }) as unknown as BetterAuthInstance;

  return { auth };
}

export const makeBetterAuthLayer = (
  d1: D1Database,
  config: ConfigService
): Layer.Layer<BetterAuthService> =>
  // Construction NEVER throws (see makeBetterAuthService): missing config
  // yields a null-auth service that `createApp` treats as "not configured".
  // Keeping this eager is important — the merged runtime layer is built on
  // every provide, so any throw here would 500 every request, health
  // included.
  Layer.succeed(BetterAuth, makeBetterAuthService(d1, config));

/**
 * Resolve the Better Auth instance. Fails with a fixed InternalError when
 * required config (BETTER_AUTH_SECRET / base URL) is missing — the secret is
 * never leaked to the wire (the Config layer throws a bare InternalError).
 */
export const betterAuthService: Effect.Effect<
  BetterAuthService,
  InternalError,
  BetterAuthService
> = Effect.flatMap(BetterAuth, (s) => Effect.succeed(s));

export const authInstance: Effect.Effect<
  BetterAuthService['auth'],
  InternalError,
  BetterAuthService
> = Effect.map(betterAuthService, (s) => s.auth);
