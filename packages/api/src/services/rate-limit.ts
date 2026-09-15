import { Context, Effect, Layer } from 'effect';

import type { RateLimitBinding, RateLimitName, WorkerEnv } from '../env';
import { TooManyRequestsError } from '../domains/errors';
import { Logger, type LoggerService } from '../effects/logger';

export interface RateLimitDecision {
  readonly success: boolean;
  readonly reset: number | null;
  readonly remaining: number | null;
}

/**
 * RateLimiter — wraps the Worker Rate Limiting bindings. In production the
 * binding enforces; the dev/test fallback is deliberately permissive (never
 * blocks) and only emits `X-RateLimit-*` counters. Enforcement is a
 * platform concern, not an in-process Map.
 */
export interface RateLimiterService {
  readonly consume: (name: RateLimitName, key: string) => Promise<RateLimitDecision>;
}

export class RateLimiter extends Context.Tag('aoi/RateLimiter')<RateLimiterService, RateLimiterService>() {}

const BINDING_KEYS: Record<RateLimitName, keyof WorkerEnv> = {
  AUTH: 'RATE_LIMIT_AUTH',
  GENERAL: 'RATE_LIMIT_GENERAL',
  SQUEEZE: 'RATE_LIMIT_SQUEEZE',
  LOCATION_REQUEST: 'RATE_LIMIT_LOCATION_REQUEST',
  MEDIA: 'RATE_LIMIT_MEDIA',
};

export function makeRateLimiterService(
  getBinding: (name: RateLimitName) => RateLimitBinding | undefined
): RateLimiterService {
  // Dev fallback counters (per-process, header-only, non-enforcing).
  const fallbackCounters = new Map<string, { count: number; resetAt: number }>();

  return {
    async consume(name, key) {
      // Fail-open: a throwing binding provider (or a binding that rejects)
      // must never break a request — enforcement is best-effort.
      let binding: RateLimitBinding | undefined;
      try {
        binding = getBinding(name);
      } catch {
        binding = undefined;
      }
      const counterKey = `${name}:${key}`;

      if (!binding) {
        // Permissive dev/test fallback: never blocks, but reports counters
        // so middleware still emits X-RateLimit-* headers.
        const now = Date.now();
        let entry = fallbackCounters.get(counterKey);
        if (!entry || now > entry.resetAt) {
          entry = { count: 0, resetAt: now + 60_000 };
          fallbackCounters.set(counterKey, entry);
        }
        entry.count += 1;
        return { success: true, reset: Math.ceil(entry.resetAt / 1000), remaining: null };
      }

      try {
        const result = await binding.limit({ key });
        return { success: result.success, reset: result.reset, remaining: result.remaining };
      } catch {
        // Same fail-open policy as a missing binding.
        const now = Date.now();
        let entry = fallbackCounters.get(counterKey);
        if (!entry || now > entry.resetAt) {
          entry = { count: 0, resetAt: now + 60_000 };
          fallbackCounters.set(counterKey, entry);
        }
        entry.count += 1;
        return { success: true, reset: Math.ceil(entry.resetAt / 1000), remaining: null };
      }
    },
  };
}

export const makeRateLimiterLayer = (
  env: Pick<WorkerEnv, 'RATE_LIMIT_AUTH' | 'RATE_LIMIT_GENERAL' | 'RATE_LIMIT_SQUEEZE' | 'RATE_LIMIT_LOCATION_REQUEST' | 'RATE_LIMIT_MEDIA'>
): Layer.Layer<RateLimiterService> =>
  Layer.succeed(
    RateLimiter,
    makeRateLimiterService((name) => env[BINDING_KEYS[name] as keyof typeof env] as RateLimitBinding | undefined)
  );

export const consume = (
  name: RateLimitName,
  key: string
): Effect.Effect<RateLimitDecision, never, RateLimiterService> =>
  Effect.flatMap(RateLimiter, (s) =>
    Effect.tryPromise({
      try: () => s.consume(name, key),
      // Fail-open: a transient binding error must never break a request;
      // enforcement resumes with the next call.
      catch: () => new Error('rate limiter unavailable'),
    }).pipe(
      Effect.catchAll(() => Effect.succeed({ success: true, reset: null, remaining: null }))
    )
  );

/**
 * Enforce a tier: succeed with the decision, or fail with
 * TooManyRequestsError when the binding denies. Middleware emits headers
 * from the decision regardless.
 */
export const enforce = (
  name: RateLimitName,
  key: string
): Effect.Effect<RateLimitDecision, TooManyRequestsError, RateLimiterService> =>
  Effect.flatMap(consume(name, key), (decision) =>
    decision.success
      ? Effect.succeed(decision)
      : Effect.fail(new TooManyRequestsError({ message: 'Too many requests. Please try again later.' }))
  );

export const enforceWithLog = (
  name: RateLimitName,
  key: string
): Effect.Effect<RateLimitDecision, TooManyRequestsError, RateLimiterService | LoggerService> =>
  Effect.flatMap(enforce(name, key), (decision) =>
    Effect.map(Logger, (logger) => {
      if (!decision.success) {
        logger.warn(`rate limit exceeded`, { tier: name });
      }
      return decision;
    })
  );
