import { createMiddleware } from 'hono/factory';
import { Effect } from 'effect';

import type { RunProgram } from '../create-app';
import { resolveSessionByToken } from '../domains/auth';
import { UnauthorizedError } from '../domains/errors';

declare module 'hono' {
  interface ContextVariableMap {
    userId: string;
    sessionId: string;
  }
}

/**
 * Session middleware (worker) — verifies Better Auth session tokens presented
 * as `Authorization: Bearer <token>`.
 *
 * Better Auth session tokens are opaque strings stored in
 * `user_sessions.token` (unique index). Validation is a DB lookup (token +
 * expiry + user-not-deleted), so revoked/expired sessions fail immediately
 * and there is no cookie-signature coupling.
 *
 * The middleware is a factory: it needs the composed Effect runtime (`run`)
 * that `createApp` builds from the layers, so tests inject the same harness
 * the route handlers use.
 *
 * NOTE: the legacy Node/Postgres app keeps its own `middleware/auth.ts`
 * (JWT-based) — this is the Cloudflare worker's middleware.
 */
export function makeAuthMiddleware(run: RunProgram) {
  return createMiddleware(async (c, next) => {
    const header = c.req.header('Authorization');
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedError({ message: 'Missing or invalid Authorization header' });
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      throw new UnauthorizedError({ message: 'Missing or invalid Authorization header' });
    }

    const resolved = await run(
      Effect.matchEffect(resolveSessionByToken(token), {
        onSuccess: (session) => Effect.succeed(session),
        onFailure: () => Effect.succeed(null),
      })
    );

    if (!resolved) {
      throw new UnauthorizedError({ message: 'Invalid or expired session' });
    }

    c.set('userId', resolved.userId);
    c.set('sessionId', resolved.sessionId);
    await next();
  });
}
