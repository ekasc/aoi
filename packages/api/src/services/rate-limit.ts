import { Context, Effect, Layer } from 'effect';

import type { RateLimitBinding, RateLimitName, WorkerEnv } from '../env';
import { TooManyRequestsError } from '../domains/errors';
import { Logger, type LoggerService } from '../effects/logger';

export interface RateLimitDecision {
  readonly success: boolean;
  readonly reset: number | null;
  readonly remaining: number | null;
}

export interface RateLimiterService {
  readonly consume: (name: RateLimitName, key: string) => Promise<RateLimitDecision>;
}

export class RateLimiter extends Context.Tag('aoi/RateLimiter')<RateLimiterService, RateLimiterService>() {}

const BINDING_KEYS: Record<RateLimitName, 'RATE_LIMIT_AUTH' | 'RATE_LIMIT_GENERAL' | 'RATE_LIMIT_SQUEEZE' | 'RATE_LIMIT_LOCATION_REQUEST' | 'RATE_LIMIT_MEDIA'> = {
  AUTH: 'RATE_LIMIT_AUTH',
  GENERAL: 'RATE_LIMIT_GENERAL',
  SQUEEZE: 'RATE_LIMIT_SQUEEZE',
  LOCATION_REQUEST: 'RATE_LIMIT_LOCATION_REQUEST',
  MEDIA: 'RATE_LIMIT_MEDIA',
};

export function makeRateLimiterService(
  getBinding: (name: RateLimitName) => RateLimitBinding | undefined,
  options: { allowMissingBinding?: boolean } = {}
): RateLimiterService {
  return {
    async consume(name, key) {
      try {
        const binding = getBinding(name);
        if (!binding) {
          return { success: options.allowMissingBinding === true, reset: null, remaining: null };
        }
        const result = await binding.limit({ key });
        return { success: result.success, reset: result.reset, remaining: result.remaining };
      } catch {
        return { success: false, reset: null, remaining: null };
      }
    },
  };
}

export const makeRateLimiterLayer = (
  env: Pick<WorkerEnv, 'APP_ENV' | 'RATE_LIMIT_AUTH' | 'RATE_LIMIT_GENERAL' | 'RATE_LIMIT_SQUEEZE' | 'RATE_LIMIT_LOCATION_REQUEST' | 'RATE_LIMIT_MEDIA'>
): Layer.Layer<RateLimiterService> =>
  Layer.succeed(
    RateLimiter,
    makeRateLimiterService((name) => env[BINDING_KEYS[name]], {
      allowMissingBinding: env.APP_ENV === 'development',
    })
  );

export const consume = (
  name: RateLimitName,
  key: string
): Effect.Effect<RateLimitDecision, never, RateLimiterService> =>
  Effect.flatMap(RateLimiter, (s) =>
    Effect.tryPromise({
      try: () => s.consume(name, key),
      catch: () => new Error('rate limiter unavailable'),
    }).pipe(
      Effect.catchAll(() => Effect.succeed({ success: false, reset: null, remaining: null }))
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
