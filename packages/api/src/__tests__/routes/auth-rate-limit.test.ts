import { describe, expect, it } from 'vitest';
import { Effect, Layer } from 'effect';

import { createApp } from '../../create-app';
import { makeTestHarness, type ShimD1 } from '../../effects/test-harness';
import { RateLimiter, type RateLimiterService } from '../../services/rate-limit';
import { authRateLimitKey } from '../../routes/session-auth';

/**
 * Auth-tier rate-limit regression tests:
 * - the AUTH tier is actually wired to sign-in/refresh (a denying binding →
 *   429 canonical envelope),
 * - the auth key is per-IP (two IPs do not share a bucket),
 * - per-IP keying falls back safely without client-IP headers.
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

/** A rate limiter that denies exactly one key (e.g. one attacker IP). */
function denyingLimiter(deniedKey: string): RateLimiterService {
  return {
    consume: async (name, key) => {
      void name;
      return key === deniedKey
        ? { success: false, reset: 60, remaining: 0 }
        : { success: true, reset: 60, remaining: 9 };
    },
  };
}

function makeAppWithAuthLimiter(limiter: RateLimiterService) {
  const harness = makeTestHarness();
  const layer = Layer.mergeAll(harness.layer, Layer.succeed(RateLimiter, limiter));
  const app = createApp(layer);
  return { harness, app };
}

describe('auth-tier rate limiting (regression: sign-in was unwired)', () => {
  it('a denied auth-tier request → 429 canonical envelope', async () => {
    const { harness, app } = makeAppWithAuthLimiter(denyingLimiter('203.0.113.9'));
    insertUser(harness.d1, USER_A, 'aoi@example.com', 'Aoi');

    const res = await app.request('/v1/auth/apple', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' },
      body: JSON.stringify({ provider: 'apple', platform: 'ios', idToken: 'x', nonce: 'n' }),
    });

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.code).toBe('TOO_MANY_REQUESTS');
  });

  it('per-IP keying: a different IP is NOT blocked', async () => {
    const { harness, app } = makeAppWithAuthLimiter(denyingLimiter('203.0.113.9'));
    insertUser(harness.d1, USER_A, 'aoi@example.com', 'Aoi');

    const res = await app.request('/v1/auth/apple', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.7' },
      body: JSON.stringify({ provider: 'apple', platform: 'ios', idToken: 'x', nonce: 'n' }),
    });

    // Not rate-limited; the request proceeds (fails idToken verification
    // with the placeholder provider → 401, NOT 429).
    expect(res.status).toBe(401);
  });
});

describe('authRateLimitKey', () => {
  it('prefers CF-Connecting-IP', () => {
    const key = authRateLimitKey({ req: { header: (name) => (name === 'CF-Connecting-IP' ? '1.2.3.4' : undefined) } });
    expect(key).toBe('1.2.3.4');
  });

  it('falls back to the first X-Forwarded-For hop', () => {
    const key = authRateLimitKey({
      req: { header: (name) => (name === 'X-Forwarded-For' ? '9.9.9.9, 8.8.8.8' : undefined) },
    });
    expect(key).toBe('9.9.9.9');
  });

  it('falls back to anonymous without client-IP headers', () => {
    const key = authRateLimitKey({ req: { header: () => undefined } });
    expect(key).toBe('anonymous');
  });
});
