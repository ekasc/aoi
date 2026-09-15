import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';

import type { RateLimitName } from '../env';
import type { RunProgram } from '../create-app';
import type { AppEnv } from '../create-app';
import { enforceWithLog } from '../services/rate-limit';

/**
 * Worker rate-limit middleware — one tier per route family (bindings enforce
 * in production; dev/tests fall back to permissive counters). Emits
 * `X-RateLimit-*` headers from the decision and fails with the canonical 429
 * envelope when the binding denies (the error mapper owns the shape).
 *
 * Enforcement is fail-open by design (see services/rate-limit.ts): a broken
 * or missing binding must never break a request.
 *
 * The key resolver defaults to the authenticated user id. Pre-auth endpoints
 * (sign-in) should pass a resolver keyed per-IP — a shared anonymous bucket
 * would let one attacker exhaust the tier for everyone.
 */
export function makeRateLimitMiddleware(
  run: RunProgram,
  tier: RateLimitName,
  keyFn: (c: Context<AppEnv>) => string = (c) => c.var.userId ?? 'anonymous'
) {
  return createMiddleware(async (c, next) => {
    const key = keyFn(c);
    const decision = await run(enforceWithLog(tier, key));
    if (decision.remaining !== null) {
      c.header('X-RateLimit-Remaining', String(decision.remaining));
    }
    if (decision.reset !== null) {
      c.header('X-RateLimit-Reset', String(decision.reset));
    }
    await next();
  });
}
