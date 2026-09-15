import { describe, expect, it, vi } from 'vitest';

import {
  clampZoom,
  containFittedSize,
  DISMISS_RANGE,
  DISMISS_TRANSLATION,
  DISMISS_VELOCITY,
  dismissProgressFor,
  shouldDismissPhoto,
  ZOOM_MAX,
  ZOOM_MIN,
  zoomPanBounds,
} from '@/components/moments/zoomable-photo';

vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  useWindowDimensions: () => ({ width: 390, height: 844 }),
}));

vi.mock('react-native-gesture-handler', () => ({
  Gesture: { Pinch: () => ({}), Pan: () => ({}), Simultaneous: () => ({}) },
  GestureDetector: ({ children }: any) => children,
}));

vi.mock('react-native-reanimated', () => ({
  default: { View: ({ children }: any) => children },
  useAnimatedStyle: () => ({}),
  useReducedMotion: () => false,
  useSharedValue: (initial: any) => ({ value: initial }),
  withTiming: (value: any) => value,
  runOnJS: (fn: (...args: any[]) => unknown) => fn,
}));

vi.mock('expo-image', () => ({
  Image: () => null,
}));

vi.mock('@/features/composer/staged-uri', () => ({
  resolveStagedUri: (uri: string) => uri,
}));

describe('zoom math', () => {
  it('clamps pinch scale to the zoom window', () => {
    expect(clampZoom(2.5)).toBe(2.5);
    expect(clampZoom(0.4)).toBe(ZOOM_MIN);
    expect(clampZoom(40)).toBe(ZOOM_MAX);
    expect(clampZoom(Number.NaN)).toBe(ZOOM_MIN);
  });

  it('maps dismiss drags to 0..1 backdrop fade', () => {
    expect(dismissProgressFor(-20)).toBe(0);
    expect(dismissProgressFor(0)).toBe(0);
    expect(dismissProgressFor(DISMISS_RANGE / 2)).toBeCloseTo(0.5);
    expect(dismissProgressFor(DISMISS_RANGE * 3)).toBe(1);
  });

  it('closes past the offset or on a fast fling', () => {
    expect(shouldDismissPhoto(DISMISS_TRANSLATION + 1, 0)).toBe(true);
    expect(shouldDismissPhoto(10, DISMISS_VELOCITY + 1)).toBe(true);
    expect(shouldDismissPhoto(10, 100)).toBe(false);
  });

  it('contain-fits source images into the frame', () => {
    expect(containFittedSize(1600, 1200, 390, 844)).toEqual({ width: 390, height: 292.5 });
    expect(containFittedSize(1200, 1500, 390, 844)).toEqual({ width: 390, height: 487.5 });
    expect(containFittedSize(0, 0, 390, 844)).toEqual({ width: 390, height: 844 });
  });

  it('bounds pans to the overflow beyond the frame', () => {
    expect(zoomPanBounds(780, 844, 390, 844)).toEqual({ x: 195, y: 0 });
    expect(zoomPanBounds(390, 844, 390, 844)).toEqual({ x: 0, y: 0 });
    expect(zoomPanBounds(100, 100, 390, 844)).toEqual({ x: 0, y: 0 });
  });
});
