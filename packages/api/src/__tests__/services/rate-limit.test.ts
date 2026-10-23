import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { RateLimitBinding } from '../../env';
import { RateLimiter, consume, enforce, makeRateLimiterService } from '../../services/rate-limit';
import { TooManyRequestsError } from '../../domains/errors';

async function runEnforce(limiter: ReturnType<typeof makeRateLimiterService>): Promise<unknown> {
  return Effect.runPromise(
    Effect.either(Effect.provideService(enforce('GENERAL', 'x'), RateLimiter, limiter))
  ).then((e) => (e._tag === 'Left' ? e.left : e.right));
}

describe('rate limiter dev fallback', () => {
  it('permits a missing local binding only when explicitly requested', async () => {
    const limiter = makeRateLimiterService(() => undefined, { allowMissingBinding: true });
    const first = await limiter.consume('GENERAL', 'user-1');
    expect(first.success).toBe(true);
    expect(first.reset).toBeNull();
    const second = await limiter.consume('GENERAL', 'user-1');
    expect(second.success).toBe(true);
  });

  it('consults the binding provider per tier', async () => {
    const seen: string[] = [];
    const limiter = makeRateLimiterService((name) => {
      seen.push(name);
      return undefined;
    });
    await limiter.consume('AUTH', 'ip-1');
    await limiter.consume('SQUEEZE', 'ip-1');
    expect(seen.sort()).toEqual(['AUTH', 'SQUEEZE']);
  });
});

describe('rate limiter binding wrapper', () => {
  it('surfaces binding decisions', async () => {
    const binding: RateLimitBinding = {
      limit: async ({ key }) =>
        key === 'blocked'
          ? { success: false, reset: 60, remaining: 0 }
          : { success: true, reset: 60, remaining: 9 },
    };
    const limiter = makeRateLimiterService(() => binding);

    expect(await limiter.consume('GENERAL', 'ok-user')).toEqual({ success: true, reset: 60, remaining: 9 });
    expect(await limiter.consume('GENERAL', 'blocked')).toEqual({ success: false, reset: 60, remaining: 0 });
  });

  it('denies when the binding provider throws', async () => {
    const limiter = makeRateLimiterService(() => {
      throw new Error('binding unavailable');
    });
    const decision = await limiter.consume('GENERAL', 'x');
    expect(decision.success).toBe(false);
  });

  it('enforce maps denial to TooManyRequestsError', async () => {
    const binding: RateLimitBinding = {
      limit: async () => ({ success: false, reset: 60, remaining: 0 }),
    };
    const limiter = makeRateLimiterService(() => binding);
    const result = await runEnforce(limiter);
    expect(result).toBeInstanceOf(TooManyRequestsError);
  });

  it('enforce succeeds when the binding allows', async () => {
    const binding: RateLimitBinding = {
      limit: async () => ({ success: true, reset: 60, remaining: 50 }),
    };
    const limiter = makeRateLimiterService(() => binding);
    const result = await runEnforce(limiter);
    expect(result).toEqual({ success: true, reset: 60, remaining: 50 });
  });
});


describe('rate limiter failure boundaries', () => {
  it('denies missing bindings by default', async () => {
    const limiter = makeRateLimiterService(() => undefined);
    expect(await runEnforce(limiter)).toBeInstanceOf(TooManyRequestsError);
  });

  it('denies a rejected binding even when local missing bindings are permitted', async () => {
    const limiter = makeRateLimiterService(() => ({ limit: async () => { throw new Error('unavailable'); } }), { allowMissingBinding: true });
    expect(await runEnforce(limiter)).toBeInstanceOf(TooManyRequestsError);
  });

  it('denies unexpected service failures instead of bypassing enforcement', async () => {
    const decision = await Effect.runPromise(Effect.provideService(
      consume('AUTH', 'ip'), RateLimiter,
      { consume: async () => { throw new Error('service failed'); } }
    ));
    expect(decision.success).toBe(false);
  });
});
