import { describe, expect, it } from 'vitest';

import { makeTestClock } from '../../effects/clock';
import { makeTestId } from '../../effects/id';
import { sanitizeFields } from '../../effects/logger';
import { makeTestHarness } from '../../effects/test-harness';
import { Effect } from 'effect';
import { nowMs } from '../../effects/clock';
import { newId } from '../../effects/id';

describe('TestClock', () => {
  it('pins time and advances deterministically', () => {
    const clock = makeTestClock(1_000_000);
    expect(clock.value()).toBe(1_000_000);
    clock.advance(5_000);
    expect(clock.value()).toBe(1_005_000);
  });
});

describe('TestId', () => {
  it('produces deterministic, well-formed UUIDs', () => {
    const ids = makeTestId(1);
    const a = ids.next();
    const b = ids.next();
    expect(a).toMatch(/^00000000-0000-4000-8000-[0-9a-f]{12}$/);
    expect(b).not.toBe(a);
  });
});

describe('logger sanitization', () => {
  it('redacts token-, secret-, and coordinate-shaped keys', () => {
    const fields = sanitizeFields({
      requestId: 'abc',
      latitude: 37.7749,
      longitude: -122.4194,
      refreshToken: 'secret-token',
      expoPushToken: 'ExpoPushToken[x]',
      path: '/v1/moments',
    });
    expect(fields.requestId).toBe('abc');
    expect(fields.path).toBe('/v1/moments');
    expect(fields.latitude).toBe('[redacted]');
    expect(fields.longitude).toBe('[redacted]');
    expect(fields.refreshToken).toBe('[redacted]');
    expect(fields.expoPushToken).toBe('[redacted]');
  });
});

describe('test harness services', () => {
  it('wires Clock + Id through the layer', async () => {
    const harness = makeTestHarness();
    harness.clock.set(1_700_000_000_000);
    const [ms, id] = await Effect.runPromise(
      Effect.provide(Effect.all([nowMs, newId]), harness.layer)
    );
    expect(ms).toBe(1_700_000_000_000);
    expect(id).toMatch(/^00000000-0000-4000-8000-[0-9a-f]{12}$/);
  });

  it('boots the readiness program through the layer (D1 + foreign keys)', async () => {
    const harness = makeTestHarness();
    const { readinessProgram } = await import('../../programs/health');
    const result = await Effect.runPromise(Effect.provide(readinessProgram, harness.layer));
    expect(result.status).toBe('ok');
  });
});
