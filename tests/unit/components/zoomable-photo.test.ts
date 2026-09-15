import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
  backdropFor,
  clampPanOffset,
  clampZoom,
  progressVelocityFor,
  containRect,
  dampedDragOffset,
  coverRect,
  DISMISS_PROGRESS,
  DISMISS_VELOCITY,
  DRAG_RESISTANCE_RANGE,
  DOUBLE_TAP_ZOOM,
  focalZoomOffset,
  isZoomedScale,
  lerpRect,
  panBoundsForScale,
  scrubProgress,
  shellRadiusFor,
  zoomPanBounds,
  zoomTargetOnDoubleTap,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOMED_EPS,
} from '@/components/moments/zoomable-photo';

vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  useWindowDimensions: () => ({ width: 390, height: 844 }),
}));

vi.mock('react-native-gesture-handler', () => ({
  Gesture: { Pinch: () => ({}), Pan: () => ({}), Tap: () => ({}), Simultaneous: () => ({}) },
  GestureDetector: ({ children }: { children?: unknown }) => children,
}));

vi.mock('react-native-reanimated', () => ({
  default: {
    createAnimatedComponent: (component: unknown) => component,
    View: ({ children }: { children?: unknown }) => children,
  },
  Easing: { bezier: () => ({}), in: (v: unknown) => v, out: (v: unknown) => v, cubic: {} },
  useAnimatedStyle: () => ({}),
  useReducedMotion: () => false,
  useSharedValue: (initial: unknown) => ({ value: initial }),
  withDelay: (_delay: number, value: unknown) => value,
  withSpring: (value: unknown) => value,
  withTiming: (value: unknown) => value,
  runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
}));

vi.mock('expo-image', () => ({ Image: () => null }));

vi.mock('@/features/composer/staged-uri', () => ({
  resolveStagedUri: (uri: string) => uri,
}));

const FRAME = { x: 0, y: 0, width: 390, height: 844 };

describe('pull-to-dismiss progress', () => {
  it('resists more the further the pull goes', () => {
    const at = (dy: number) => scrubProgress(0, dy, FRAME.height);
    // The bands the owner's feel was tuned against: a slow, weighted pull.
    expect(at(0)).toBe(0);
    expect(at(100)).toBeCloseTo(0.12, 2);
    expect(at(200)).toBeCloseTo(0.23, 2);
    expect(at(300)).toBeCloseTo(0.33, 2);
    expect(at(400)).toBeCloseTo(0.41, 2);
    // Monotonic, and never past home.
    expect(at(200)).toBeGreaterThan(at(100));
    expect(at(400)).toBeGreaterThan(at(200));
    expect(at(5000)).toBeLessThanOrEqual(1);
  });

  it('reads the pull in any direction, up included', () => {
    // Up and down are the same gesture; so is a sideways pull.
    expect(scrubProgress(0, -200, FRAME.height)).toBeCloseTo(
      scrubProgress(0, 200, FRAME.height),
      6,
    );
    expect(scrubProgress(200, 0, FRAME.height)).toBeCloseTo(
      scrubProgress(0, 200, FRAME.height),
      6,
    );
    expect(scrubProgress(Number.NaN, Number.NaN, FRAME.height)).toBe(0);
    // A shorter screen resists a little less, never more.
    expect(scrubProgress(0, 200, 600)).toBeGreaterThan(scrubProgress(0, 200, 900));
  });

  it('damps the finger follow, keeping its direction', () => {
    const range = DRAG_RESISTANCE_RANGE;
    // The photo answers the hand, but never travels as far as it.
    expect(dampedDragOffset(60, range)).toBeGreaterThan(30);
    expect(dampedDragOffset(200, range)).toBeLessThan(200);
    expect(dampedDragOffset(200, range)).toBeGreaterThan(100);
    // Sign preserved, so pulling up mirrors pulling down.
    expect(dampedDragOffset(-60, range)).toBeCloseTo(-dampedDragOffset(60, range), 6);
    expect(dampedDragOffset(Number.NaN, range)).toBe(0);
    expect(dampedDragOffset(40, 0)).toBe(40);
  });

  it('derives the radius and the ground from the same progress', () => {
    expect(shellRadiusFor(0, 12)).toBe(0);
    expect(shellRadiusFor(1, 12)).toBe(12);
    expect(shellRadiusFor(0.5, 12)).toBe(6);
    // Under a transform the radius is divided back out, so the corner still
    // LOOKS the size it should: at 0.25 scale, 12 becomes 48 local points.
    expect(shellRadiusFor(1, 12, 0.25)).toBe(48);
    expect(shellRadiusFor(1, 12, 4)).toBe(3);
    expect(shellRadiusFor(0, 12, 0.25)).toBe(0);
    expect(shellRadiusFor(1, 12, 0)).toBe(12);
    expect(shellRadiusFor(1, -4)).toBe(0);
    expect(backdropFor(0)).toBe(1);
    expect(backdropFor(1)).toBe(0);
    expect(backdropFor(0.25)).toBe(0.75);
  });

  it('carries the release speed into the close', () => {
    // A slow release starts the close gently...
    expect(progressVelocityFor(300, 0, FRAME.height)).toBe(0);
    // ...and a fast one starts it fast: progress per second, so the spring
    // continues the hand's motion instead of stalling first.
    const slow = progressVelocityFor(300, 400, FRAME.height);
    const fast = progressVelocityFor(300, 2000, FRAME.height);
    expect(slow).toBeGreaterThan(0);
    expect(fast).toBeGreaterThan(slow);
    // The further the pull already is, the less the same speed adds (the
    // exponential scrub is already close to home).
    expect(progressVelocityFor(700, 1200, FRAME.height)).toBeLessThan(
      progressVelocityFor(100, 1200, FRAME.height),
    );
    expect(progressVelocityFor(Number.NaN, 1200, FRAME.height)).toBe(0);
  });

  it('dismisses when the pull is far enough or flicked, in any direction', () => {
    expect(DISMISS_PROGRESS).toBeGreaterThan(0);
    expect(DISMISS_PROGRESS).toBeLessThan(0.5);
    expect(DISMISS_VELOCITY).toBeGreaterThan(600);
  });
});

describe('morph geometry', () => {
  it('contain-fits a source inside the frame, centered', () => {
    // Landscape source in a portrait frame: full width, letterboxed.
    expect(containRect(1600, 1200, FRAME)).toEqual({
      x: 0,
      y: (844 - 292.5) / 2,
      width: 390,
      height: 292.5,
    });
    // Portrait source in this frame: the WIDTH fills and the height is
    // letterboxed, because 0.8 is wider than the frame's own 0.46 ratio.
    const portrait = containRect(1200, 1500, FRAME);
    expect(portrait.width).toBe(390);
    expect(portrait.height).toBeCloseTo(487.5, 4);
    expect(portrait.y).toBeCloseTo((844 - 487.5) / 2, 4);
    // Unknown source: the frame itself, so nothing divides by zero.
    expect(containRect(0, 0, FRAME)).toEqual(FRAME);
  });

  it('cover-fills a thumbnail, cropped to it', () => {
    const tile = { x: 24, y: 300, width: 96, height: 96 };
    // Landscape source in a square tile: height fills, width overflows.
    const landscape = coverRect(1600, 1200, tile);
    expect(landscape.height).toBeCloseTo(96, 4);
    expect(landscape.width).toBeCloseTo(128, 4);
    // Cropped evenly left and right, so it overhangs the tile by 16 a side.
    expect(landscape.x).toBeCloseTo(24 - 16, 4);
    expect(landscape.y).toBeCloseTo(300, 4);
    // Degenerate tile: nothing to cover.
    expect(coverRect(100, 100, { x: 0, y: 0, width: 0, height: 0 })).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
  });

  it('interpolates between two rects, exactly at both ends', () => {
    const to = { x: 24, y: 300, width: 96, height: 96 };
    expect(lerpRect(FRAME, to, 0)).toEqual(FRAME);
    expect(lerpRect(FRAME, to, 1)).toEqual(to);
    const half = lerpRect(FRAME, to, 0.5);
    expect(half.width).toBeCloseTo((390 + 96) / 2, 4);
    expect(half.x).toBeCloseTo(12, 4);
    // Out-of-range progress is clamped rather than extrapolated.
    expect(lerpRect(FRAME, to, -1)).toEqual(FRAME);
    expect(lerpRect(FRAME, to, 4)).toEqual(to);
  });

  it('keeps the source aspect at every frame of the morph', () => {
    const tile = { x: 24, y: 300, width: 96, height: 140 };
    const sourceAspect = 1600 / 1200;
    for (const t of [0, 0.2, 0.5, 0.8, 1]) {
      const shell = lerpRect(FRAME, tile, t);
      const image = lerpRect(
        containRect(1600, 1200, FRAME),
        coverRect(1600, 1200, tile),
        t,
      );
      expect(image.width / image.height).toBeCloseTo(sourceAspect, 6);
      // And the image stays anchored to the shell's own origin.
      expect(Number.isFinite(image.x - shell.x)).toBe(true);
    }
  });
});

describe('zoom maths', () => {
  it('clamps pinch scale to the zoom window', () => {
    expect(clampZoom(2.5)).toBe(2.5);
    expect(clampZoom(0.4)).toBe(ZOOM_MIN);
    expect(clampZoom(40)).toBe(ZOOM_MAX);
    expect(clampZoom(Number.NaN)).toBe(ZOOM_MIN);
  });

  it('knows when a scale counts as enlarged', () => {
    expect(isZoomedScale(ZOOM_MIN)).toBe(false);
    expect(isZoomedScale(ZOOM_MIN + ZOOMED_EPS)).toBe(false);
    expect(isZoomedScale(ZOOM_MIN + 0.05)).toBe(true);
    expect(isZoomedScale(Number.NaN)).toBe(false);
  });

  it('toggles zoom on a double tap', () => {
    expect(zoomTargetOnDoubleTap(ZOOM_MIN)).toBe(DOUBLE_TAP_ZOOM);
    expect(zoomTargetOnDoubleTap(DOUBLE_TAP_ZOOM)).toBe(ZOOM_MIN);
    expect(zoomTargetOnDoubleTap(ZOOM_MAX)).toBe(ZOOM_MIN);
  });

  it('keeps the point under the fingers still while zooming', () => {
    expect(focalZoomOffset(0, 0, 0, 2, 500)).toBe(0);
    expect(focalZoomOffset(100, 100, 0, 2, 500)).toBe(-100);
    expect(focalZoomOffset(100, 150, 0, 2, 500)).toBe(-50);
    expect(focalZoomOffset(100, 100, -100, 0.5, 500)).toBe(0);
    expect(focalZoomOffset(400, 400, 0, 4, 120)).toBe(-120);
    expect(focalZoomOffset(Number.NaN, 0, 50, 2, 100)).toBe(50);
  });

  it('clamps pan offsets to the photo bounds', () => {
    expect(clampPanOffset(50, 100)).toBe(50);
    expect(clampPanOffset(150, 100)).toBe(100);
    expect(clampPanOffset(-150, 100)).toBe(-100);
    expect(clampPanOffset(40, 0)).toBe(0);
    expect(clampPanOffset(Number.NaN, 100)).toBe(0);
  });

  it('bounds pans from the contain-fitted size, unknown size included', () => {
    // Portrait source (0.5 aspect) fits 390x780, so at 2x it overflows both
    // ways by half of each overflow.
    expect(panBoundsForScale(1200, 2400, 2, 390, 844)).toEqual({ x: 195, y: 358 });
    // A landscape band gains nothing vertically.
    expect(panBoundsForScale(1600, 1200, 2, 390, 844)).toEqual({ x: 195, y: 0 });
    // At rest a fitted photo has nothing to pan.
    expect(panBoundsForScale(1200, 2400, 1, 390, 844)).toEqual({ x: 0, y: 0 });
    // Source size unknown: zoom is allowed, panning is not.
    expect(panBoundsForScale(0, 0, 4, 390, 844)).toEqual({ x: 0, y: 0 });
    expect(zoomPanBounds(780, 844, 390, 844)).toEqual({ x: 195, y: 0 });
  });
});

describe('gesture and transition contracts (source)', () => {
  const photo = readFileSync('components/moments/zoomable-photo.tsx', 'utf8');
  const viewer = readFileSync('components/moments/photo-viewer.tsx', 'utf8');

  it('activates one manual pan for any pull, without rebuilding gestures', () => {
    expect(photo).toContain('.manualActivation(true)');
    expect(photo).toContain('manager.activate()');
    expect(photo).toContain('manager.fail()');
    // Up and down both activate: only a sideways drag is handed to the pager.
    expect(photo).toMatch(/Math\.abs\(dy\) > PAN_ACTIVATION && Math\.abs\(dy\) > Math\.abs\(dx\)/);
    expect(photo).not.toMatch(/dy < 0/);
    // No state-driven enable/disable anywhere.
    expect(photo).not.toMatch(/\.enabled\(/);
  });

  it('never creates a worklet in the render scope', () => {
    // A component-scope 'worklet' called from a gesture callback is the shape
    // that crashed the app on a real device.
    expect(photo).not.toMatch(/const \w+ = \([^)]*\) => \{\n\s*'worklet'/);
  });

  it('closes on a spring that carries the release velocity, not on a timer', () => {
    // The dismiss springs the progress home and closes when it settles; the
    // velocity is the hand's, so there is no stall before it moves.
    expect(photo).toMatch(/withSpring\(\s*1,[\s\S]{0,240}runOnJS\(onDismiss\)/);
    expect(photo).toContain('velocity: progressVelocityFor(');
    expect(photo).not.toMatch(/setTimeout\([\s\S]{0,80}onDismiss/);
  });

  it('presents from real geometry, and never leaves a modal that eats touches', () => {
    // The Modal must not fade on its own, or the zoom and the fade fight.
    expect(viewer).toContain('animationType="none"');
    // The overlay waits for the viewer's layout, then animates from the
    // thumbnail; the photo's own size only refines the frames.
    expect(viewer).toContain('const presented = laidOut;');
    expect(viewer).toMatch(/withDelay\(\s*OPEN_MORPH_DELAY/);
    // A gate that never opens would freeze the screen behind an invisible
    // modal, so touches pass through until it presents.
    expect(viewer).toMatch(/pointerEvents=\{presented && !handingBack \? ['"]auto['"] : ['"]none['"]\}/);
    expect(viewer).toMatch(/setTimeout\(\(\) => setLaidOut\(true\), 120\)/);
    // And once a dismiss starts, the photo is only finishing its landing: the
    // reader can touch the feed underneath without waiting for it to settle.
    expect(viewer).toContain('setHandingBack(true)');
    expect(photo).toContain('runOnJS(handleDismissStart)()');
  });

  it('exposes the zoom without fingers, and announces the photo once', () => {
    expect(photo).toContain('accessibilityRole="image"');
    expect(photo).toContain("{ name: 'zoomIn', label: 'Zoom in' }");
    expect(photo).toContain("{ name: 'zoomOut', label: 'Zoom out' }");
    expect(photo).toContain("{ name: 'resetZoom', label: 'Reset zoom' }");
    expect(photo).toMatch(/<AnimatedImage\s+accessible=\{false\}/);
  });
});
