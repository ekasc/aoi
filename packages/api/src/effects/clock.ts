import { Context, Effect, Layer } from 'effect';

/**
 * Clock — the single `now` source for every domain program. All time-based
 * decisions (letter horizons, location freshness, retention purges, cursor
 * keys) read from here so tests can pin time with TestClock.
 */
export interface ClockService {
  readonly now: () => Date;
  readonly nowMs: () => number;
}

export class Clock extends Context.Tag('aoi/Clock')<ClockService, ClockService>() {}

export const LiveClock = Layer.succeed(Clock, {
  now: () => new Date(),
  nowMs: () => Date.now(),
});

/** Effect accessors. */
export const now = Effect.map(Clock, (c) => c.now());
export const nowMs = Effect.map(Clock, (c) => c.nowMs());

/**
 * A settable clock for tests. Hold the handle, then wire
 * `makeTestClock().layer` into the test layers; advance time with `set`.
 */
export function makeTestClock(initialMs = Date.now()) {
  let ms = initialMs;
  return {
    layer: Layer.succeed(Clock, {
      now: () => new Date(ms),
      nowMs: () => ms,
    }),
    set(valueMs: number): void {
      ms = valueMs;
    },
    advance(byMs: number): void {
      ms += byMs;
    },
    value(): number {
      return ms;
    },
  };
}
