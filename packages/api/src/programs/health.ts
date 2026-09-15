import { Effect } from 'effect';

import { assertForeignKeys } from '../effects/d1';
import { nowMs } from '../effects/clock';

export interface HealthStatus {
  readonly status: 'ok';
  readonly at: string;
}

/** Liveness — always ok while the isolate is alive. */
export const livenessProgram = Effect.gen(function* () {
  const at = yield* nowMs;
  return { status: 'ok' as const, at: new Date(at).toISOString() };
});

/**
 * Readiness — verifies the D1 binding answers and foreign keys are on.
 * Deliberately shallow (no domain queries): ready means "can serve work".
 */
export const readinessProgram = Effect.gen(function* () {
  const at = yield* nowMs;
  yield* assertForeignKeys;
  return { status: 'ok' as const, at: new Date(at).toISOString() };
});
