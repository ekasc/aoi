import { describe, expect, it, vi } from 'vitest';
import { withTiming } from 'react-native-reanimated/src/animation/timing';

import { returnTimingFor, RETURN_MORPH_DURATION } from '@/components/moments/zoomable-photo';

// Keep the installed timing driver; replace only its worklet/runtime boundary.
vi.mock('react-native-reanimated/src/animation/util', () => ({
  defineAnimation: (_target: number, factory: () => unknown) => factory(),
  getReduceMotionForAnimation: () => false,
  assertEasingIsWorklet: () => {},
}));
vi.mock('react-native-reanimated/src/common', () => ({ logger: { warn: vi.fn() } }));

type Timing = {
  current: number;
  onStart: (animation: Timing, value: number, now: number, previous: undefined) => void;
  onFrame: (animation: Timing, now: number) => boolean;
};

describe.each([60, 120])('committed viewer return at %sHz', (frameRate) => {
  it.each([
    { start: 0.3, target: 1, velocity: 0 },
    { start: 0.3, target: 1, velocity: 1 },
    { start: 0.3, target: 1, velocity: 4 },
    { start: 0.1, target: 1, velocity: 12 },
    { start: 120, target: 0, velocity: 1500 },
    { start: -120, target: 0, velocity: -1500 },
  ])('starts continuously and completes on the shared clock from $start to $target at velocity $velocity', ({ start, target, velocity }) => {
    // withTiming's public type hides the animation object consumed by the UI runtime.
    const timing = withTiming(target, returnTimingFor({ from: start, to: target, velocity, constrain: target === 1 })) as unknown as Timing;
    timing.onStart(timing, start, 1000, undefined);
    expect(timing.current).toBe(start);
    expect(timing.onFrame(timing, 1000)).toBe(false);
    let elapsed = 0;
    while (elapsed < 2000) {
      elapsed += 1000 / frameRate;
      if (timing.onFrame(timing, 1000 + elapsed)) break;
    }
    expect(timing.current).toBe(target);
    expect(elapsed).toBeGreaterThanOrEqual(RETURN_MORPH_DURATION);
    expect(elapsed).toBeLessThanOrEqual(RETURN_MORPH_DURATION + 1000 / frameRate);
  });
});
