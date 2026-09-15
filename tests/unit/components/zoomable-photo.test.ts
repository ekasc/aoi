import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
  clampPanOffset,
  clampZoom,
  containFittedSize,
  DISMISS_RANGE,
  DISMISS_TRANSLATION,
  DISMISS_VELOCITY,
  dismissProgressFor,
  DOUBLE_TAP_ZOOM,
  focalZoomOffset,
  isZoomedScale,
  panBoundsForScale,
  shouldDismissPhoto,
  ZOOMED_EPS,
  zoomTargetOnDoubleTap,
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

  it('closes past the offset or on a fast downward fling', () => {
    expect(shouldDismissPhoto(DISMISS_TRANSLATION + 1, 0)).toBe(true);
    expect(shouldDismissPhoto(10, DISMISS_VELOCITY + 1)).toBe(true);
    expect(shouldDismissPhoto(10, 100)).toBe(false);
    // An upward drag never dismisses, whatever the release velocity says.
    expect(shouldDismissPhoto(-40, DISMISS_VELOCITY + 1)).toBe(false);
    expect(shouldDismissPhoto(-DISMISS_TRANSLATION * 3, DISMISS_VELOCITY + 500)).toBe(false);
    expect(shouldDismissPhoto(Number.NaN, DISMISS_VELOCITY)).toBe(false);
  });

  it('knows when a scale counts as enlarged', () => {
    expect(isZoomedScale(ZOOM_MIN)).toBe(false);
    expect(isZoomedScale(ZOOM_MIN + ZOOMED_EPS)).toBe(false);
    expect(isZoomedScale(ZOOM_MIN + 0.05)).toBe(true);
    expect(isZoomedScale(Number.NaN)).toBe(false);
  });

  it('contain-fits source images into the frame', () => {
    expect(containFittedSize(1600, 1200, 390, 844)).toEqual({ width: 390, height: 292.5 });
    expect(containFittedSize(1200, 1500, 390, 844)).toEqual({ width: 390, height: 487.5 });
    expect(containFittedSize(0, 0, 390, 844)).toEqual({ width: 390, height: 844 });
  });

  it('clamps pan offsets to the photo bounds', () => {
    expect(clampPanOffset(50, 100)).toBe(50);
    expect(clampPanOffset(150, 100)).toBe(100);
    expect(clampPanOffset(-150, 100)).toBe(-100);
    // A photo with no overflow cannot move at all, and junk resets.
    expect(clampPanOffset(40, 0)).toBe(0);
    expect(clampPanOffset(Number.NaN, 100)).toBe(0);
    expect(clampPanOffset(10, Number.NaN)).toBe(0);
  });

  it('keeps the point under the fingers still while zooming', () => {
    // Fingers on the frame center, scale 1x -> 2x: nothing to compensate.
    expect(focalZoomOffset(0, 0, 0, 2, 500)).toBe(0);
    // Fingers right of center: the photo moves left so that point stays put.
    expect(focalZoomOffset(100, 100, 0, 2, 500)).toBe(-100);
    // The pinch also drags: the point follows the hand.
    expect(focalZoomOffset(100, 150, 0, 2, 500)).toBe(-50);
    // Zooming 2x -> 1x from a panned position returns to the center.
    expect(focalZoomOffset(100, 100, -100, 0.5, 500)).toBe(0);
    // All four corners behave the same way (signs flip, magnitude does not).
    expect(focalZoomOffset(-100, -100, 0, 2, 500)).toBe(100);
    expect(focalZoomOffset(200, 200, 0, 2, 600)).toBe(-200);
    expect(focalZoomOffset(-200, -200, 0, 2, 600)).toBe(200);
    // A long zoom back out (4x -> 1x) from a panned photo lands the anchored
    // content point exactly where the fingers are.
    expect(focalZoomOffset(100, 100, -100, 0.25, 500)).toBe(50);
    // Never past the bound, even when the anchor asks for it.
    expect(focalZoomOffset(400, 400, 0, 4, 120)).toBe(-120);
    // Junk input falls back to a clamped standing offset instead of NaN.
    expect(focalZoomOffset(Number.NaN, 0, 50, 2, 100)).toBe(50);
    expect(focalZoomOffset(0, Number.POSITIVE_INFINITY, 50, 2, 100)).toBe(50);
    expect(focalZoomOffset(0, 0, 50, Number.NaN, 100)).toBe(50);
  });

  it('bounds pans from the contain-fitted size, unknown size included', () => {
    const frame = { width: 390, height: 844 };
    // Portrait source (aspect 0.5) fits 390x780, so at 2x it overflows
    // vertically and horizontally by half of each overflow.
    expect(panBoundsForScale(0.5, 2, frame.width, frame.height)).toEqual({
      x: 195,
      y: 358,
    });
    // Landscape source (aspect 2) fits 390x195: at 2x both axes overflow.
    expect(panBoundsForScale(2, 2, frame.width, frame.height)).toEqual({
      x: 195,
      y: 0,
    });
    // At rest a fitted photo has nothing to pan.
    expect(panBoundsForScale(0.5, 1, frame.width, frame.height)).toEqual({ x: 0, y: 0 });
    // Source size unknown: zoom is allowed, panning is not.
    expect(panBoundsForScale(null, 4, frame.width, frame.height)).toEqual({ x: 0, y: 0 });
    expect(panBoundsForScale(0, 4, frame.width, frame.height)).toEqual({ x: 0, y: 0 });
  });

  it('toggles zoom on a double tap', () => {
    expect(zoomTargetOnDoubleTap(ZOOM_MIN)).toBe(DOUBLE_TAP_ZOOM);
    expect(zoomTargetOnDoubleTap(ZOOM_MIN + 0.01)).toBe(DOUBLE_TAP_ZOOM);
    expect(zoomTargetOnDoubleTap(DOUBLE_TAP_ZOOM)).toBe(ZOOM_MIN);
    expect(zoomTargetOnDoubleTap(ZOOM_MAX)).toBe(ZOOM_MIN);
  });

  it('bounds pans to the overflow beyond the frame', () => {
    expect(zoomPanBounds(780, 844, 390, 844)).toEqual({ x: 195, y: 0 });
    expect(zoomPanBounds(390, 844, 390, 844)).toEqual({ x: 0, y: 0 });
    expect(zoomPanBounds(100, 100, 390, 844)).toEqual({ x: 0, y: 0 });
  });
});

describe('gesture composition (source contract)', () => {
  // Pinch/pan/tap payloads cannot fire in jsdom, so the composition itself is
  // pinned here: these are the lines that decide who owns which axis.
  const source = readFileSync('components/moments/zoomable-photo.tsx', 'utf8');

  it('keeps the pager own horizontal swipes at rest and hands them over zoomed', () => {
    // Rest pan claims vertical drags and gives horizontal intent to the pager.
    expect(source).toContain('.activeOffsetY([-PAN_ACTIVATION, PAN_ACTIVATION])');
    expect(source).toContain('.failOffsetX([-PAN_ACTIVATION, PAN_ACTIVATION])');
    // Zoomed pan takes movement in ANY direction (activeOffsetX and
    // activeOffsetY are AND-ed, so both would never fire on a side drag).
    expect(source).toMatch(/\.enabled\(panZoomed\)[\s\S]{0,400}?\.minDistance\(PAN_ACTIVATION\)/);
    expect(source).toMatch(/\.enabled\(!panZoomed\)/);
    // No axis thresholds on the zoom pan: they are AND-ed and would strand a
    // side drag inside the other axis' dead zone.
    expect(source).not.toMatch(/\.enabled\(panZoomed\)[\s\S]{0,400}?\.activeOffset[XY]\(/);
  });

  it('never rebuilds the gesture graph while a pinch is active', () => {
    const pinchBody = source.slice(
      source.indexOf('Gesture.Pinch()'),
      source.indexOf('const settlePinch'),
    );
    // The parent lock is announced at start, but the local pan mode (which
    // decides the gesture composition) only changes in the finalizer.
    expect(pinchBody).toContain('runOnJS(announceLock)(true)');
    expect(pinchBody).not.toContain('setPanZoomed');
    const finalizer = source.slice(source.indexOf('const settlePinch'), source.indexOf('const restPan'));
    expect(finalizer).toContain('runOnJS(setPanZoomed)');
  });

  it('never lets the rest pan dismiss an enlarged photo', () => {
    const restPan = source.slice(source.indexOf('const restPan'), source.indexOf('const zoomedPan'));
    // While the scale is enlarged a drag is a pan, whatever local mode the
    // composition is still in for that frame.
    expect(restPan.match(/isZoomedScale\(scale\.value\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('keeps the zoomed pan live until a zoom-out finishes', () => {
    const zoomTo = source.slice(source.indexOf('const zoomTo'), source.indexOf('const doubleTap'));
    // Enlarging switches the pan mode up front...
    expect(zoomTo).toMatch(/if \(!atRest\) \{\n\s*setPanZoomed\(true\);/);
    // ...shrinking only after the return-to-rest animation settles, so a
    // touch mid-animation cannot dismiss a still-enlarged photo.
    const settle = zoomTo.slice(zoomTo.indexOf('const settle'), zoomTo.indexOf('if (reduceMotion)'));
    expect(settle).toContain('runOnJS(setPanZoomed)(false)');
    expect(settle).toContain('done === false');
    expect(zoomTo.match(/setPanZoomed\(true\)/g)?.length ?? 0).toBe(1);
  });

  it('marks the photo as an accessibility element with monotonic steps', () => {
    expect(source).toContain('accessible\n');
    expect(source).toMatch(/zoomIn[\s\S]{0,240}Math\.min\(ZOOM_MAX/);
    expect(source).toMatch(/zoomOut[\s\S]{0,240}Math\.max\(ZOOM_MIN/);
    expect(source).toContain("action === 'resetZoom'");
  });

  it('locks the pager from the moment a pinch begins', () => {
    const pinchStart = source.slice(source.indexOf('Gesture.Pinch()'), source.indexOf('Gesture.Pan()'));
    expect(pinchStart).toContain('lockedFlag.value = true');
    expect(pinchStart).toContain('settlePinch(false)');
  });

  it('exposes the zoom without fingers, and announces the photo once', () => {
    expect(source).toContain("accessibilityRole=\"image\"");
    expect(source).toContain("{ name: 'zoomIn', label: 'Zoom in' }");
    expect(source).toContain("{ name: 'zoomOut', label: 'Zoom out' }");
    expect(source).toContain("{ name: 'resetZoom', label: 'Reset zoom' }");
    // One accessible element: the image inside it is decorative.
    expect(source).toMatch(/<Image\s+accessible=\{false\}/);
  });

  it('snaps instead of animating under reduced motion', () => {
    expect(source.match(/if \(reduceMotion\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});
