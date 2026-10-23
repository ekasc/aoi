import { act, render } from '@testing-library/react';
import { createElement, useRef, type ReactNode } from 'react';
import type { SharedValue } from 'react-native-reanimated';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { releaseMotionFor, ZoomablePhoto, type ViewerHome, type ViewerMorph } from '@/components/moments/zoomable-photo';

type AnimatedStyle = { opacity?: number; transform?: { scale?: number }[] };
const styles: (() => AnimatedStyle)[] = [];
let loadImage: (event: { source: { width: number; height: number } }) => void;
const preferences = vi.hoisted(() => ({ reduceMotion: false }));
const springCalls: number[] = [];
const timingCalls: {
  target: number;
  config?: { duration?: number; easing?: (progress: number) => number };
  finish?: (finished: boolean) => void;
}[] = [];
type PanEvent = { translationX: number; translationY: number; velocityX: number; velocityY: number };
const gestureCallbacks: Record<string, Record<string, (event: PanEvent, success: boolean) => void>> = {};

vi.mock('react-native-gesture-handler', () => {
  function gesture(kind: string) {
    const callbacks: Record<string, (event: PanEvent, success: boolean) => void> = {};
    gestureCallbacks[kind] = callbacks;
    const chain = new Proxy(() => {}, {
      get: (_, property: string) => (callback: unknown) => {
        if (typeof callback === 'function') {
          // Native gesture callbacks have different event types; these tests drive only pan events.
          callbacks[property] = callback as (event: PanEvent, success: boolean) => void;
        }
        return chain;
      },
    });
    return chain;
  }
  return {
    GestureDetector: ({ children }: { children?: ReactNode }) => children,
    Gesture: { Pan: () => gesture('pan'), Pinch: () => gesture('pinch'), Tap: () => gesture('tap'), Simultaneous: () => ({}) },
  };
});

// Stand in for the native shared-value object; run the real style worklets.
function shared<T>(initial: T): SharedValue<T> {
  const value = {
    value: initial,
    get: () => value.value,
    set: (next: T | ((current: T) => T)) => {
      value.value = typeof next === 'function'
        ? (next as (current: T) => T)(value.value)
        : next;
    },
  };
  return value as SharedValue<T>;
}

vi.mock('react-native', () => ({
  View: ({ children }: { children?: ReactNode }) => createElement('div', {}, children),
  StyleSheet: { create: (value: unknown) => value, absoluteFill: {} },
  useWindowDimensions: () => ({ width: 390, height: 844 }),
}));
vi.mock('react-native-reanimated', () => ({
  default: {
    View: ({ children }: { children?: ReactNode }) => createElement('div', {}, children),
    createAnimatedComponent: (component: unknown) => component,
  },
  Easing: { bezier: () => ({}) },
  useSharedValue: (initial: unknown) => useRef(shared(initial)).current,
  useAnimatedStyle: (worklet: () => AnimatedStyle) => {
    styles.push(worklet);
    return {};
  },
  useReducedMotion: () => preferences.reduceMotion,
  withSpring: (value: number) => { springCalls.push(value); return value; },
  withTiming: (target: number, config?: typeof timingCalls[number]['config'], finish?: (finished: boolean) => void) => {
    timingCalls.push({ target, config, finish });
    return target;
  },
  runOnJS: (callback: unknown) => callback,
}));
vi.mock('expo-image', () => ({
  Image: ({ onLoad }: { onLoad: typeof loadImage }) => {
    loadImage = onLoad;
    return null;
  },
}));
vi.mock('@/components/themed-text', () => ({ ThemedText: () => null }));
vi.mock('@/components/ui/button', () => ({ Button: () => null }));

function setup(hasHome: boolean, source = { width: 1600, height: 1200 }) {
  const morph: ViewerMorph = {
    t: shared(0), residualX: shared(0), residualY: shared(0),
    sourceWidth: shared(0), sourceHeight: shared(0), overlay: shared(1),
  };
  const home: ViewerHome = {
    valid: shared(hasHome), x: shared(24), y: shared(300),
    width: shared(hasHome ? 96 : 0), height: shared(hasHome ? 96 : 0), radius: shared(12),
  };
  const onDismiss = vi.fn();
  render(<ZoomablePhoto uri="file:///photo.jpg" label="Lake" morph={morph} home={home}
    onDismiss={onDismiss} onPagerLockChange={vi.fn()} />);
  act(() => loadImage({ source }));
  const [shell, crop] = styles.slice(-3);
  const scaleAt = (progress: number) => {
    morph.t.set(progress);
    const shellScale = shell().transform?.find((entry) => entry.scale !== undefined)?.scale ?? 1;
    const cropScale = crop().transform?.[0]?.scale ?? 1;
    return shellScale * cropScale;
  };
  return { morph, scaleAt, shell, onDismiss };
}

beforeEach(() => {
  styles.length = 0;
  springCalls.length = 0;
  timingCalls.length = 0;
  preferences.reduceMotion = false;
});

describe('photo dismiss rendering', () => {
  it.each([
    { x: 80, y: 5, action: 'fail' },
    { x: 5, y: 80, action: 'activate' },
  ])('hands horizontal drags to paging and vertical drags to dismissal: $x,$y', ({ x, y, action }) => {
    setup(true);
    type Touch = { allTouches: { absoluteX: number; absoluteY: number }[] };
    type Manager = { activate: () => void; fail: () => void };
    // The recorder also holds touch callbacks, whose native event type differs from pan updates.
    const down = gestureCallbacks.pan.onTouchesDown as unknown as (event: Touch) => void;
    const move = gestureCallbacks.pan.onTouchesMove as unknown as (event: Touch, manager: Manager) => void;
    const manager = { activate: vi.fn(), fail: vi.fn() };
    act(() => down({ allTouches: [{ absoluteX: 100, absoluteY: 200 }] }));
    act(() => move({ allTouches: [{ absoluteX: 100 + x, absoluteY: 200 + y }] }, manager));
    expect(manager[action === 'fail' ? 'fail' : 'activate']).toHaveBeenCalledTimes(1);
    expect(manager[action === 'fail' ? 'activate' : 'fail']).not.toHaveBeenCalled();
  });

  it('hands the displayed drag velocity to all return tracks and closes only on completion', () => {
    const { morph, onDismiss } = setup(true);
    const event = { translationX: 30, translationY: 240, velocityX: 100, velocityY: 1600 };
    act(() => gestureCallbacks.pan.onUpdate(event, true));
    const start = [morph.t.get(), morph.residualX.get(), morph.residualY.get()];
    const release = releaseMotionFor(30, 240, 100, 1600, 844);
    act(() => gestureCallbacks.pan.onEnd(event, true));
    expect(timingCalls).toHaveLength(3);
    const velocities = [release.progressVelocity, release.residualVelocityX, release.residualVelocityY];
    for (const [index, track] of timingCalls.entries()) {
      const easing = track.config?.easing;
      expect(easing?.(0)).toBe(0);
      const dt = 0.000001;
      const seconds = (track.config?.duration ?? 0) / 1000 * dt;
      const velocity = (track.target - start[index]) * (easing?.(dt) ?? 0) / seconds;
      expect(velocity).toBeCloseTo(velocities[index], 2);
      expect(track.config?.duration).toBe(timingCalls[0].config?.duration);
    }
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => timingCalls[0].finish?.(true));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('springs back when the finger reverses, even after passing the dismissal distance', () => {
    const { onDismiss } = setup(true);
    const event = { translationX: 0, translationY: 350, velocityX: 0, velocityY: -1600 };
    act(() => gestureCallbacks.pan.onUpdate(event, true));
    act(() => gestureCallbacks.pan.onEnd(event, true));
    expect(springCalls).toEqual([0, 0, 0]);
    expect(timingCalls).toHaveLength(0);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('completes a swipe dismissal without a spring when reduced motion is enabled', () => {
    preferences.reduceMotion = true;
    const { onDismiss } = setup(true);
    act(() => gestureCallbacks.pan.onEnd({ translationX: 0, translationY: 300, velocityX: 0, velocityY: 0 }, true));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(springCalls).toEqual([]);
  });

  it('restores a cancelled pull without a spring when reduced motion is enabled', () => {
    preferences.reduceMotion = true;
    const { morph } = setup(true);
    morph.t.set(0.1);
    morph.residualY.set(30);
    act(() => gestureCallbacks.pan.onFinalize({ translationX: 0, translationY: 100, velocityX: 0, velocityY: 0 }, false));
    expect(morph.t.get()).toBe(0);
    expect(morph.residualY.get()).toBe(0);
    expect(springCalls).toEqual([]);
  });

  it('keeps contain-fit throughout a swipe with no thumbnail, fading instead of filling the screen', () => {
    const { scaleAt, shell } = setup(false);
    for (const progress of [0, 0.1, 0.25, 0.5, 0.75, 1]) {
      expect(scaleAt(progress)).toBeCloseTo(1);
      expect(shell().opacity).toBeCloseTo(1 - progress);
    }
  });

  it.each([
    { width: 4000, height: 1000 },
    { width: 1000, height: 4000 },
    { width: 1600, height: 1200 },
  ])('never enlarges a $width × $height photo on its way back to a smaller thumbnail', (source) => {
    const { scaleAt } = setup(true, source);
    let previous = scaleAt(0);
    for (let step = 1; step <= 100; step += 1) {
      const scale = scaleAt(step / 100);
      expect(scale).toBeLessThanOrEqual(previous + 1e-8);
      previous = scale;
    }
    const fittedHeight = Math.min(390 / source.width, 844 / source.height) * source.height;
    const fittedWidth = fittedHeight * source.width / source.height;
    expect(scaleAt(1)).toBeCloseTo(Math.max(96 / fittedWidth, 96 / fittedHeight));
  });
});
