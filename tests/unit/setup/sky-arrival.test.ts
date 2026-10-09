import { describe, expect, it } from 'vitest';

import {
  ARRIVAL_WINDOWS,
  SKY_ARRIVAL_MS,
  SKY_LANDED_AT,
  arrivalWindow,
} from '@/components/setup/sky-handover';

/**
 * The arrival into the archive is one clock with three windows cut out of it.
 * These are the properties that make it read as a place being entered rather
 * than a screen being swapped, and they are arithmetic, so they can be held
 * still here rather than eyeballed on a device.
 */
describe('arrival choreography', () => {
  it('stages the sky first, then the ground, then the words', () => {
    const [skyStart, skyEnd] = ARRIVAL_WINDOWS.sky;
    const [groundStart] = ARRIVAL_WINDOWS.ground;
    const [wordsStart] = ARRIVAL_WINDOWS.words;

    // The sky lands before the arrival is over: that is what gives the rest of
    // the move something to land against.
    expect(skyEnd).toBeLessThan(1);
    expect(skyEnd).toBe(SKY_LANDED_AT);
    // Ground follows the sky, words follow the ground.
    expect(groundStart).toBeGreaterThan(skyStart);
    expect(wordsStart).toBeGreaterThan(groundStart);
    // The invitation is already leaving before the sky has finished, so the
    // move is continuous rather than a sequence of waits.
    expect(ARRIVAL_WINDOWS.invitation[1]).toBeLessThan(skyEnd);
    expect(ARRIVAL_WINDOWS.ground[1]).toBeLessThanOrEqual(1);
    expect(ARRIVAL_WINDOWS.words[1]).toBe(1);
  });

  it('gives each layer a full 0 to 1 of its own window', () => {
    for (const [from, to] of Object.values(ARRIVAL_WINDOWS)) {
      expect(arrivalWindow(from, from, to)).toBe(0);
      expect(arrivalWindow(to, from, to)).toBe(1);
      // Before its window a layer is untouched, after it is done: no layer
      // drifts past its own end.
      expect(arrivalWindow(from - 0.2, from, to)).toBe(0);
      expect(arrivalWindow(to + 0.2, from, to)).toBe(1);
    }
  });

  it('clamps a master clock that is out of range', () => {
    expect(arrivalWindow(-1, 0, 0.5)).toBe(0);
    expect(arrivalWindow(2, 0, 0.5)).toBe(1);
    // A degenerate window is a step, not a division by zero.
    expect(arrivalWindow(0.4, 0.5, 0.5)).toBe(0);
    expect(arrivalWindow(0.6, 0.5, 0.5)).toBe(1);
  });

  it('is slower than a dissolve, which is the whole point', () => {
    // 240ms was a crossfade: two things swapping. This is a place arriving.
    expect(SKY_ARRIVAL_MS).toBeGreaterThanOrEqual(400);
    expect(SKY_ARRIVAL_MS).toBeLessThanOrEqual(600);
  });
});
