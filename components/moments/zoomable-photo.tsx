import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { Image } from 'expo-image';

import { Spacing, Springs } from '@/constants/theme';
import { imageSourceForUri } from '@/features/media/image-source';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;
/** Scale a double tap lands on, and returns from. */
export const DOUBLE_TAP_ZOOM = 2.5;
/** Past this scale the photo counts as zoomed (the pager locks). */
export const ZOOMED_EPS = 0.02;
/** Drag distance before a pan is claimed, so a tap stays a tap. */
export const PAN_ACTIVATION = 12;
/** How much of the sideways travel rides along as finger attachment. */
export const DRAG_RESIDUAL_FACTOR = 0.08;
/** Progress at which letting go dismisses. */
export const DISMISS_PROGRESS = 0.24;
/** Outward fling that dismisses regardless of distance. */
export const DISMISS_VELOCITY = 1050;
const DISMISS_REVERSAL_VELOCITY = 300;
/** Open: quick, eased out of the thumbnail into place. */
export const OPEN_MORPH_DURATION = 300;
/** Frames to wait before the open animation, so the first frame is laid out. */
export const OPEN_MORPH_DELAY = 16;
const ZOOM_DURATION = 220;

/** The window frame of the thumbnail a viewer session opened from. */
export type PhotoOrigin = {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Corner radius of that thumbnail, in points. */
  radius?: number;
};

/** A rectangle in window coordinates. */
export type Rect = { x: number; y: number; width: number; height: number };

/**
 * The viewer's whole transition state. One progress value drives everything —
 * the photo's rect, its corner radius and the ground behind it — so a finger
 * drag and the open/close animations cannot disagree, and a release has
 * nothing to reconcile: it simply finishes the animation the finger started.
 *
 * 0 = fullscreen, 1 = home on the thumbnail.
 */
export type ViewerMorph = {
  t: SharedValue<number>;
  /** Small finger attachment while dragging, on top of the progress. */
  residualX: SharedValue<number>;
  residualY: SharedValue<number>;
  /** Intrinsic size of the visible photo, written by its own load. */
  sourceWidth: SharedValue<number>;
  sourceHeight: SharedValue<number>;
  /** 1 once the overlay is presented; drives the scrim with `t`. */
  overlay: SharedValue<number>;
};

/** Where home is for this session: the thumbnail's own frame. */
export type ViewerHome = {
  x: SharedValue<number>;
  y: SharedValue<number>;
  width: SharedValue<number>;
  height: SharedValue<number>;
  radius: SharedValue<number>;
  /** False when nothing was measured: the session then just fades. */
  valid: SharedValue<boolean>;
};

/** Open easing: eases out of the thumbnail, weight at the start. */
export const OPEN_EASING = Easing.bezier(0.22, 1, 0.36, 1);
export const RETURN_MORPH_DURATION = 280;
export const DRAG_SPRING = Springs.rest;

const AnimatedImage = Animated.createAnimatedComponent(Image);

function clamp(value: number, min: number, max: number): number {
  'worklet';
  return Math.min(max, Math.max(min, value));
}

/** Cubic Hermite timing: start with the displayed velocity, arrive at rest. */
export function returnTimingFor({ from, to, velocity = 0, constrain = false }: {
  from: number;
  to: number;
  velocity?: number;
  constrain?: boolean;
}) {
  'worklet';
  const slope = to === from ? 0 : velocity * RETURN_MORPH_DURATION / 1000 / (to - from);
  // Progress must not overshoot its crop endpoints. Position offsets may
  // briefly continue away from home when that is how the finger was moving.
  const initialSlope = constrain ? clamp(slope, 0, 3) : slope;
  return {
    duration: RETURN_MORPH_DURATION,
    easing: (progress: number) => {
      'worklet';
      return progress * progress * (3 - 2 * progress)
        + initialSlope * progress * (1 - progress) * (1 - progress);
    },
  };
}

/** Pinch scale clamped to the zoom window; non-finite input resets. */
export function clampZoom(value: number): number {
  'worklet';
  if (!Number.isFinite(value)) {
    return ZOOM_MIN;
  }
  return clamp(value, ZOOM_MIN, ZOOM_MAX);
}

/** Pan offset clamped to one axis' bound (never past the photo's edge). */
export function clampPanOffset(value: number, bound: number): number {
  'worklet';
  if (!Number.isFinite(value) || !Number.isFinite(bound)) {
    return 0;
  }
  const limit = Math.max(0, bound);
  return clamp(value, -limit, limit);
}

/** True while a scale counts as enlarged. */
export function isZoomedScale(scale: number): boolean {
  'worklet';
  return Number.isFinite(scale) && scale > ZOOM_MIN + ZOOMED_EPS;
}

/**
 * Progress of a pull, in ANY direction: exponential, so it answers the finger
 * immediately and then gives ground — the resistance the owner asked for.
 * Direction-agnostic on purpose: dragging up dismisses exactly like dragging
 * down, and the drag itself carries the direction.
 */
export function scrubProgress(dx: number, dy: number, frameHeight: number): number {
  'worklet';
  const distance = Math.hypot(
    Number.isFinite(dx) ? dx : 0,
    Number.isFinite(dy) ? dy : 0,
  );
  const resistance = Math.max(700, frameHeight * 0.9);
  return clamp(1 - Math.exp(-distance / resistance), 0, 1);
}

/** Travel at which the drag's resistance has taken most of its effect. */
export const DRAG_RESISTANCE_RANGE = 180;

/**
 * Does a released drag close the viewer, or spring back?
 *
 * One rule for every page: past a fraction of the way, or moving fast enough
 * that the hand clearly meant it. Photos land back in their tile; a clip or a
 * voice note has no tile and shrinks away instead, but the decision is the
 * same decision.
 */
export function shouldDismissOnRelease(progress: number, outwardSpeed: number): boolean {
  'worklet';
  if (outwardSpeed < -DISMISS_REVERSAL_VELOCITY) return false;
  return progress >= DISMISS_PROGRESS || outwardSpeed > DISMISS_VELOCITY;
}

/**
 * Finger attachment: the photo follows the hand, damped, so it keeps weight
 * instead of being welded to the glass. The sign is kept, so this works in
 * every direction.
 */
export function dampedDragOffset(value: number, range: number): number {
  'worklet';
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (!(range > 0)) {
    return value;
  }
  const magnitude = Math.abs(value);
  const damped = range * (1 - Math.exp(-magnitude / range));
  return value < 0 ? -damped : damped;
}

/**
 * Corner radius at one progress: square at fullscreen, the tile's own at
 * home. `scale` is the transform the shell is under — a radius rides its
 * parent's scale, so it is divided back out here. Without that the corner
 * shrinks with the photo and the rounding is invisible at the end of a close,
 * which is exactly where it has to match the thumbnail.
 */
export function shellRadiusFor(t: number, homeRadius: number, scale = 1): number {
  'worklet';
  const visual = Math.max(0, homeRadius) * clamp(t, 0, 1);
  if (!Number.isFinite(scale) || scale <= 0.01) {
    return visual;
  }
  return visual / scale;
}

/** Ground opacity at one progress: it fades as the photo goes home. */
export function backdropFor(t: number): number {
  'worklet';
  return 1 - clamp(t, 0, 1);
}

/** Linear interpolation between two rectangles. */
export function lerpRect(from: Rect, to: Rect, t: number): Rect {
  'worklet';
  const p = clamp(Number.isFinite(t) ? t : 0, 0, 1);
  return {
    x: from.x + (to.x - from.x) * p,
    y: from.y + (to.y - from.y) * p,
    width: from.width + (to.width - from.width) * p,
    height: from.height + (to.height - from.height) * p,
  };
}

/** Contain-fit rect of a source inside a frame (centered). */
export function containRect(
  sourceWidth: number,
  sourceHeight: number,
  frame: Rect,
): Rect {
  'worklet';
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) {
    return frame;
  }
  const scale = Math.min(frame.width / sourceWidth, frame.height / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: frame.x + (frame.width - width) / 2,
    y: frame.y + (frame.height - height) / 2,
    width,
    height,
  };
}

/**
 * The static layout one session morphs between. `base` is the box the clip
 * lives on: it takes the THUMBNAIL's aspect (so its corners are the corners
 * the photo lands on) and is sized to contain the photo's fullscreen box, so
 * the image can start contain-fit and end covering it.
 *
 * Everything here is computed once per session and never animated: only the
 * transform and the radius move, which is what keeps this off the layout
 * thread (animating a rect per frame froze the app on device).
 */
export function buildMorphGeometry(
  sourceWidth: number,
  sourceHeight: number,
  frameWidth: number,
  frameHeight: number,
  homeWidth: number,
  homeHeight: number,
): {
  baseWidth: number;
  baseHeight: number;
  fullWidth: number;
  fullHeight: number;
  coverScale: number;
} {
  'worklet';
  const full = containRect(sourceWidth, sourceHeight, {
    x: 0,
    y: 0,
    width: frameWidth,
    height: frameHeight,
  });
  const homeAspect =
    homeWidth > 0 && homeHeight > 0 ? homeWidth / homeHeight : frameWidth / frameHeight;
  const baseWidth = Math.max(full.width, full.height * homeAspect);
  const baseHeight = homeAspect > 0 ? baseWidth / homeAspect : frameHeight;
  const coverScale =
    full.width > 0 && full.height > 0
      ? Math.max(baseWidth / full.width, baseHeight / full.height)
      : 1;
  return {
    baseWidth,
    baseHeight,
    fullWidth: full.width,
    fullHeight: full.height,
    coverScale,
  };
}

/** Compensate for the shell so the displayed image scales linearly, without a zoom bump. */
export function morphCropScale(progress: number, coverScale: number, targetShellScale: number): number {
  'worklet';
  const t = clamp(progress, 0, 1);
  const shellScale = 1 + (targetShellScale - 1) * t;
  const imageScale = 1 + (coverScale * targetShellScale - 1) * t;
  return imageScale / shellScale;
}

/** Cover-fit rect of a source inside a frame (centered, cropped). */
export function coverRect(sourceWidth: number, sourceHeight: number, frame: Rect): Rect {
  'worklet';
  if (!(sourceWidth > 0) || !(sourceHeight > 0) || !(frame.width > 0) || !(frame.height > 0)) {
    return frame;
  }
  const scale = Math.max(frame.width / sourceWidth, frame.height / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: frame.x + (frame.width - width) / 2,
    y: frame.y + (frame.height - height) / 2,
    width,
    height,
  };
}

/** Where a double tap lands: back to rest when zoomed, in when at rest. */
export function zoomTargetOnDoubleTap(scale: number): number {
  'worklet';
  return isZoomedScale(scale) ? ZOOM_MIN : DOUBLE_TAP_ZOOM;
}

/**
 * Offset that keeps the content point under the pinch still. Both focals and
 * `startOffset` are relative to the frame center, `ratio` is
 * nextScale / startScale.
 */
export function focalZoomOffset(
  startFocal: number,
  currentFocal: number,
  startOffset: number,
  ratio: number,
  bound: number,
): number {
  'worklet';
  if (
    !Number.isFinite(startFocal) ||
    !Number.isFinite(currentFocal) ||
    !Number.isFinite(startOffset) ||
    !Number.isFinite(ratio)
  ) {
    return clampPanOffset(startOffset, bound);
  }
  return clampPanOffset(currentFocal - (startFocal - startOffset) * ratio, bound);
}

/** Max pan offset keeping a fitted photo covering its frame. */
export function zoomPanBounds(
  fittedWidth: number,
  fittedHeight: number,
  frameWidth: number,
  frameHeight: number,
): { x: number; y: number } {
  'worklet';
  return {
    x: Math.max(0, (fittedWidth - frameWidth) / 2),
    y: Math.max(0, (fittedHeight - frameHeight) / 2),
  };
}

/** Pan bounds for the visible photo at one scale, inside the viewer frame. */
export function panBoundsForScale(
  sourceWidth: number,
  sourceHeight: number,
  scaleValue: number,
  frameWidth: number,
  frameHeight: number,
): { x: number; y: number } {
  'worklet';
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) {
    // Nothing measured yet: zoom is allowed, pushing the photo around a box
    // we cannot size is not.
    return { x: 0, y: 0 };
  }
  const fitted = containRect(sourceWidth, sourceHeight, {
    x: 0,
    y: 0,
    width: frameWidth,
    height: frameHeight,
  });
  return zoomPanBounds(
    fitted.width * scaleValue,
    fitted.height * scaleValue,
    frameWidth,
    frameHeight,
  );
}

/**
 * Signed radial velocity translated into progress per second, using the
 * same resistance as the displayed drag.
 */
export function progressVelocityFor(
  distance: number,
  radialSpeed: number,
  frameHeight: number,
): number {
  'worklet';
  if (!Number.isFinite(distance) || !Number.isFinite(radialSpeed)) {
    return 0;
  }
  const resistance = Math.max(700, frameHeight * 0.9);
  const travelled = Math.max(0, distance);
  return (radialSpeed * Math.exp(-travelled / resistance)) / resistance;
}

/** Derivative of the same damped offsets the drag displays, not raw touch speed. */
export function releaseMotionFor(dx: number, dy: number, vx: number, vy: number, frameHeight: number) {
  'worklet';
  const distance = Math.hypot(dx, dy);
  const outwardSpeed = distance > 0 ? (dx * vx + dy * vy) / distance : 0;
  const progressVelocity = progressVelocityFor(distance, outwardSpeed, frameHeight);
  const progress = scrubProgress(dx, dy, frameHeight);
  const range = Math.min(DRAG_RESISTANCE_RANGE, frameHeight * 0.2);
  const attenuation = 1 - progress * 0.5;
  return {
    outwardSpeed,
    progressVelocity,
    residualVelocityX: (range > 0 ? Math.exp(-Math.abs(dx) / range) : 1) * vx * attenuation
      - dampedDragOffset(dx, range) * 0.5 * progressVelocity,
    residualVelocityY: (range > 0 ? Math.exp(-Math.abs(dy) / range) : 1) * vy * attenuation
      - dampedDragOffset(dy, range) * 0.5 * progressVelocity,
  };
}

/**
 * One fullscreen photo: pinch to zoom (anchored under the fingers), pan while
 * enlarged, double tap to zoom in or out, and — at rest — a downward pull
 * that scrubs the same progress the open and close use, so letting go either
 * finishes the zoom-out into the thumbnail or springs back to fullscreen.
 *
 * The shell is the animated rectangle (clipping and rounding the photo), the
 * zoom layer inside it carries the pinch, and the image's own rect is
 * interpolated between its fullscreen contain box and the thumbnail's cover
 * crop. Both endpoints share the source aspect, so the interpolation does
 * too, which is what makes it a real shared-element zoom.
 */
export function ZoomablePhoto({
  uri,
  label,
  morph,
  home,
  active = true,
  morphOut = false,
  onDismiss,
  onDismissStart,
  onImageReady,
  onPagerLockChange,
}: {
  uri: string;
  label: string;
  morph: ViewerMorph;
  home: ViewerHome;
  /** Only the visible page scrubs the morph; the others stay at rest. */
  active?: boolean;
  /** Set by the viewer when its Close control asks to morph out. */
  morphOut?: boolean;
  /** Called once the dismiss morph has finished, never before. */
  onDismiss: () => void;
  /**
   * Called the instant a dismiss starts, before the morph runs: the viewer
   * uses it to hand touches back to the screen behind, so a swipe-close can
   * be followed by a scroll straight away instead of waiting for the settle.
   */
  onDismissStart?: () => void;
  /** Called when the visible photo reports its intrinsic size. */
  onImageReady?: () => void;
  /** True while the viewer must keep its pager still. */
  onPagerLockChange: (locked: boolean) => void;
}) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const zoom = useSharedValue(ZOOM_MIN);
  const panX = useSharedValue(0);
  const panY = useSharedValue(0);
  const startZoom = useSharedValue(ZOOM_MIN);
  const startPanX = useSharedValue(0);
  const startPanY = useSharedValue(0);
  const touchX = useSharedValue(0);
  const touchY = useSharedValue(0);
  const startFocalX = useSharedValue(0);
  const startFocalY = useSharedValue(0);
  const sourceWidth = useSharedValue(0);
  const sourceHeight = useSharedValue(0);
  const zoomedFlag = useSharedValue(false);
  const [locked, setLocked] = useState(false);
  // Where the photo sits and how big its clip box is, computed once from the
  // image's own load. Held as state because it is LAYOUT, and layout has to be
  // static: the clip box carries the corner radius, so the rounding rides the
  // photo through the whole swipe instead of happening on a full-window
  // rectangle's far-away corners.
  const [geometry, setGeometry] = useState<ReturnType<typeof buildMorphGeometry> | null>(null);
  const readySentRef = useRef(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const imageSource = imageSourceForUri(uri);
  void locked;

  const frame = useMemo(
    () => ({ x: 0, y: 0, width: windowWidth, height: windowHeight }),
    [windowWidth, windowHeight],
  );

  const announceLock = useCallback(
    (next: boolean) => {
      setLocked(next);
      onPagerLockChange(next);
    },
    [onPagerLockChange],
  );

  const handleLoad = useCallback(
    (event: { source?: { width?: number; height?: number } }) => {
      const width = event.source?.width ?? 0;
      const height = event.source?.height ?? 0;
      if (!(width > 0) || !(height > 0)) {
        return;
      }
      sourceWidth.set(width);
      sourceHeight.set(height);
      setGeometry(
        buildMorphGeometry(
          width,
          height,
          windowWidth,
          windowHeight,
          home.width.get(),
          home.height.get(),
        ),
      );
      if (active) {
        // The visible photo tells the viewer its intrinsic size, which is
        // what the morph needs to interpolate the image's rect, and the
        // viewer will not present until it has it.
        morph.sourceWidth.set(width);
        morph.sourceHeight.set(height);
        onImageReady?.();
      }
      const bounds = panBoundsForScale(width, height, zoom.get(), windowWidth, windowHeight);
      panX.set(clampPanOffset(panX.get(), bounds.x));
      panY.set(clampPanOffset(panY.get(), bounds.y));
    },
    [
      active,
      home,
      morph,
      onImageReady,
      panX,
      panY,
      sourceHeight,
      sourceWidth,
      windowHeight,
      windowWidth,
      zoom,
    ],
  );

  /**
   * Finish the zoom-out the finger started: the same progress, carried to
   * home, with the finger attachment released as it goes. Completion runs the
   * close, so a stalled frame cannot close the viewer before it arrives.
   */
  const playDismiss = useCallback(() => {
    onDismissStart?.();
    if (reduceMotion) {
      morph.t.set(1);
      morph.residualX.set(0);
      morph.residualY.set(0);
      onDismiss();
      return;
    }
    morph.t.set(withTiming(1, returnTimingFor({ from: morph.t.get(), to: 1, constrain: true }), (finished) => {
      'worklet';
      if (finished) {
        runOnJS(onDismiss)();
      }
    }));
    morph.residualX.set(withTiming(0, returnTimingFor({ from: morph.residualX.get(), to: 0 })));
    morph.residualY.set(withTiming(0, returnTimingFor({ from: morph.residualY.get(), to: 0 })));
  }, [morph, onDismiss, onDismissStart, reduceMotion]);

  // The viewer's Close control asks for the same finish a swipe plays.
  useEffect(() => {
    if (morphOut) {
      playDismiss();
    }
  }, [morphOut, playDismiss]);

  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .onStart((event) => {
          'worklet';
          startZoom.set(zoom.get());
          startPanX.set(panX.get());
          startPanY.set(panY.get());
          startFocalX.set(event.focalX - windowWidth / 2);
          startFocalY.set(event.focalY - windowHeight / 2);
          // Lock the pager the moment a pinch begins: one that stays live
          // through the first frames competes with the pinch.
          if (!zoomedFlag.get()) {
            zoomedFlag.set(true);
            runOnJS(announceLock)(true);
          }
        })
        .onUpdate((event) => {
          'worklet';
          const next = clampZoom(startZoom.get() * event.scale);
          const ratio = startZoom.get() === 0 ? 1 : next / startZoom.get();
          const bounds = panBoundsForScale(
            sourceWidth.get(),
            sourceHeight.get(),
            next,
            windowWidth,
            windowHeight,
          );
          zoom.set(next);
          panX.set(focalZoomOffset(
            startFocalX.get(),
            event.focalX - windowWidth / 2,
            startPanX.get(),
            ratio,
            bounds.x,
          ));
          panY.set(focalZoomOffset(
            startFocalY.get(),
            event.focalY - windowHeight / 2,
            startPanY.get(),
            ratio,
            bounds.y,
          ));
        })
        .onEnd(() => {
          'worklet';
          if (isZoomedScale(zoom.get())) {
            const bounds = panBoundsForScale(
              sourceWidth.get(),
              sourceHeight.get(),
              zoom.get(),
              windowWidth,
              windowHeight,
            );
            panX.set(clampPanOffset(panX.get(), bounds.x));
            panY.set(clampPanOffset(panY.get(), bounds.y));
            return;
          }
          const duration = reduceMotion ? 0 : ZOOM_DURATION;
          zoom.set(withTiming(ZOOM_MIN, { duration }));
          panX.set(withTiming(0, { duration }));
          panY.set(withTiming(0, { duration }));
          if (zoomedFlag.get()) {
            zoomedFlag.set(false);
            runOnJS(announceLock)(false);
          }
        })
        .onFinalize((_, success) => {
          'worklet';
          if (success || isZoomedScale(zoom.get())) {
            return;
          }
          // Cancelled mid-pinch: never leave a half-applied zoom behind.
          zoom.set(ZOOM_MIN);
          panX.set(0);
          panY.set(0);
          if (zoomedFlag.get()) {
            zoomedFlag.set(false);
            runOnJS(announceLock)(false);
          }
        }),
    [
      announceLock,
      panX,
      panY,
      reduceMotion,
      sourceHeight,
      sourceWidth,
      startFocalX,
      startFocalY,
      startPanX,
      startPanY,
      startZoom,
      windowHeight,
      windowWidth,
      zoom,
      zoomedFlag,
    ],
  );

  /**
   * One pan, activated by hand. While enlarged it takes either axis (the
   * pager is locked, so that is the only way to reach the photo's edges). At
   * rest it takes a downward drag that is more vertical than not, and fails
   * everything else so horizontal swipes pass to the pager untouched.
   */
  const handleDismissStart = useCallback(() => {
    onDismissStart?.();
  }, [onDismissStart]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .maxPointers(1)
        .manualActivation(true)
        .onTouchesDown((event) => {
          'worklet';
          const touch = event.allTouches[0];
          if (touch) {
            touchX.set(touch.absoluteX);
            touchY.set(touch.absoluteY);
          }
        })
        .onTouchesMove((event, manager) => {
          'worklet';
          const touch = event.allTouches[0];
          if (!touch) {
            return;
          }
          const dx = touch.absoluteX - touchX.get();
          const dy = touch.absoluteY - touchY.get();
          if (isZoomedScale(zoom.get())) {
            if (Math.abs(dx) > PAN_ACTIVATION || Math.abs(dy) > PAN_ACTIVATION) {
              manager.activate();
            }
            return;
          }
          if (Math.abs(dy) > PAN_ACTIVATION && Math.abs(dy) > Math.abs(dx)) {
            // Up or down: both are a pull.
            manager.activate();
            return;
          }
          if (Math.abs(dx) > PAN_ACTIVATION && Math.abs(dx) > Math.abs(dy)) {
            manager.fail();
          }
        })
        .onStart(() => {
          'worklet';
          startPanX.set(panX.get());
          startPanY.set(panY.get());
        })
        .onUpdate((event) => {
          'worklet';
          if (isZoomedScale(zoom.get())) {
            const bounds = panBoundsForScale(
              sourceWidth.get(),
              sourceHeight.get(),
              zoom.get(),
              windowWidth,
              windowHeight,
            );
            panX.set(clampPanOffset(startPanX.get() + event.translationX, bounds.x));
            panY.set(clampPanOffset(startPanY.get() + event.translationY, bounds.y));
            return;
          }
          if (!active) {
            return;
          }
          // One progress value scrubs how far home the photo is, measured on
          // the pull's length so any direction counts; the hand's own travel
          // rides along, damped, so the photo follows with weight.
          const t = scrubProgress(event.translationX, event.translationY, windowHeight);
          const resistance = Math.min(DRAG_RESISTANCE_RANGE, windowHeight * 0.2);
          morph.t.set(t);
          morph.residualX.set(dampedDragOffset(event.translationX, resistance) * (1 - t * 0.5));
          morph.residualY.set(dampedDragOffset(event.translationY, resistance) * (1 - t * 0.5));
        })
        .onEnd((event) => {
          'worklet';
          if (!active || isZoomedScale(zoom.get())) {
            return;
          }
          const release = releaseMotionFor(event.translationX, event.translationY, event.velocityX, event.velocityY, windowHeight);
          const t = scrubProgress(event.translationX, event.translationY, windowHeight);
          if (shouldDismissOnRelease(t, release.outwardSpeed)) {
            runOnJS(handleDismissStart)();
            if (reduceMotion) {
              morph.t.set(1);
              morph.residualX.set(0);
              morph.residualY.set(0);
              runOnJS(onDismiss)();
              return;
            }
            morph.t.set(withTiming(
              1,
              returnTimingFor({ from: morph.t.get(), to: 1, velocity: release.progressVelocity, constrain: true }),
              (finished) => {
                'worklet';
                if (finished) {
                  runOnJS(onDismiss)();
                }
              },
            ));
            morph.residualX.set(withTiming(0, returnTimingFor({ from: morph.residualX.get(), to: 0, velocity: release.residualVelocityX })));
            morph.residualY.set(withTiming(0, returnTimingFor({ from: morph.residualY.get(), to: 0, velocity: release.residualVelocityY })));
            return;
          }
          morph.t.set(reduceMotion ? 0 : withSpring(0, DRAG_SPRING));
          morph.residualX.set(reduceMotion ? 0 : withSpring(0, DRAG_SPRING));
          morph.residualY.set(reduceMotion ? 0 : withSpring(0, DRAG_SPRING));
        })
        .onFinalize((_, success) => {
          'worklet';
          if (success || !active || isZoomedScale(zoom.get())) {
            return;
          }
          // Cancelled mid-drag: never park the photo away from fullscreen.
          morph.t.set(reduceMotion ? 0 : withSpring(0, DRAG_SPRING));
          morph.residualX.set(reduceMotion ? 0 : withSpring(0, DRAG_SPRING));
          morph.residualY.set(reduceMotion ? 0 : withSpring(0, DRAG_SPRING));
        }),
    [
      active,
      handleDismissStart,
      morph,
      onDismiss,
      panX,
      panY,
      reduceMotion,
      sourceHeight,
      sourceWidth,
      startPanX,
      startPanY,
      touchX,
      touchY,
      windowHeight,
      windowWidth,
      zoom,
    ],
  );

  /** Zoom without fingers: the same maths, from the accessibility actions. */
  const zoomTo = useCallback(
    (target: number, focusX: number, focusY: number) => {
      const startFrom = zoom.get();
      const ratio = startFrom === 0 ? 1 : target / startFrom;
      const bounds = panBoundsForScale(
        sourceWidth.get(),
        sourceHeight.get(),
        target,
        windowWidth,
        windowHeight,
      );
      const atRest = !isZoomedScale(target);
      const nextX = atRest ? 0 : focalZoomOffset(focusX, focusX, panX.get(), ratio, bounds.x);
      const nextY = atRest ? 0 : focalZoomOffset(focusY, focusY, panY.get(), ratio, bounds.y);
      const duration = reduceMotion ? 0 : ZOOM_DURATION;
      if (!zoomedFlag.get()) {
        zoomedFlag.set(true);
        announceLock(true);
      }
      zoom.set(withTiming(target, { duration }));
      panX.set(withTiming(nextX, { duration }));
      panY.set(withTiming(nextY, { duration }));
      if (atRest) {
        const release = () => {
          if (zoomedFlag.get()) {
            zoomedFlag.set(false);
            announceLock(false);
          }
        };
        setTimeout(release, duration);
      }
    },
    [
      announceLock,
      panX,
      panY,
      reduceMotion,
      sourceHeight,
      sourceWidth,
      windowHeight,
      windowWidth,
      zoom,
      zoomedFlag,
    ],
  );

  const doubleTap = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .maxDuration(260)
        .onEnd((event, success) => {
          'worklet';
          if (!success) {
            return;
          }
          const target = zoomTargetOnDoubleTap(zoom.get());
          const focusX = event.x - windowWidth / 2;
          const focusY = event.y - windowHeight / 2;
          const startFrom = zoom.get();
          const ratio = startFrom === 0 ? 1 : target / startFrom;
          const bounds = panBoundsForScale(
            sourceWidth.get(),
            sourceHeight.get(),
            target,
            windowWidth,
            windowHeight,
          );
          const atRest = !isZoomedScale(target);
          const nextX = atRest ? 0 : focalZoomOffset(focusX, focusX, panX.get(), ratio, bounds.x);
          const nextY = atRest ? 0 : focalZoomOffset(focusY, focusY, panY.get(), ratio, bounds.y);
          const duration = reduceMotion ? 0 : ZOOM_DURATION;
          zoom.set(withTiming(target, { duration }));
          panX.set(withTiming(nextX, { duration }));
          panY.set(withTiming(nextY, { duration }));
          if (!zoomedFlag.get()) {
            zoomedFlag.set(true);
            runOnJS(announceLock)(true);
          }
          if (atRest) {
            // Back to rest: the pager gets its axis back once the return has
            // played out.
            runOnJS(releasePagerAfter)(duration, announceLock);
          }
        }),
    [
      announceLock,
      panX,
      panY,
      reduceMotion,
      sourceHeight,
      sourceWidth,
      windowHeight,
      windowWidth,
      zoom,
      zoomedFlag,
    ],
  );

  const handleAccessibilityAction = useCallback(
    (event: { nativeEvent: { actionName: string } }) => {
      const action = event.nativeEvent.actionName;
      if (action === 'zoomIn') {
        zoomTo(Math.min(ZOOM_MAX, zoom.get() * DOUBLE_TAP_ZOOM), 0, 0);
        return;
      }
      if (action === 'zoomOut') {
        zoomTo(Math.max(ZOOM_MIN, zoom.get() / DOUBLE_TAP_ZOOM), 0, 0);
        return;
      }
      if (action === 'resetZoom') {
        zoomTo(ZOOM_MIN, 0, 0);
      }
    },
    [zoom, zoomTo],
  );

  // The clip box: the photo's frame, moved and scaled from centred at rest to
  // exactly covering the thumbnail at home. It is sized statically (its
  // aspect is the thumbnail's), so only transform and radius animate — a
  // per-frame width/height animation inside a Modal froze the app.
  const shellStyle = useAnimatedStyle(
    () => {
      const t = clamp(morph.t.get(), 0, 1);
      const hasHome = home.valid.get();
      const baseWidth = geometry?.baseWidth ?? frame.width;
      const baseHeight = geometry?.baseHeight ?? frame.height;
      const target = hasHome
        ? {
            x: home.x.get(),
            y: home.y.get(),
            width: home.width.get(),
            height: home.height.get(),
          }
        : frame;
      const cover = hasHome
        ? Math.max(target.width / baseWidth, target.height / baseHeight)
        : 1;
      const scale = 1 + (Math.min(cover, 1) - 1) * t;
      const centerX = frame.x + frame.width / 2;
      const centerY = frame.y + frame.height / 2;
      const targetCenterX = hasHome ? target.x + target.width / 2 : centerX;
      const targetCenterY = hasHome ? target.y + target.height / 2 : centerY;
      return {
        transform: [
          { translateX: morph.residualX.get() },
          { translateY: morph.residualY.get() },
          { translateX: (targetCenterX - centerX) * t },
          { translateY: (targetCenterY - centerY) * t },
          { scale },
        ],
        // Exact: the box's aspect IS the thumbnail's, so at t = 1 its corners
        // land on the thumbnail's corners at the thumbnail's radius.
        borderRadius: shellRadiusFor(t, home.radius.get(), scale),
        opacity: morph.overlay.get() * (hasHome ? 1 : backdropFor(t)),
      };
    },
    [geometry, frame, home, morph],
  );

  // The image turns from contain into the thumbnail's cover crop, so it
  // fills the clip box by the time it lands: one uniform scale, because both
  // rects keep the source aspect.
  const cropStyle = useAnimatedStyle(() => {
    if (!home.valid.get()) {
      return { transform: [{ scale: 1 }] };
    }
    const targetScale = Math.min(1, Math.max(
      home.width.get() / (geometry?.baseWidth ?? frame.width),
      home.height.get() / (geometry?.baseHeight ?? frame.height),
    ));
    return {
      transform: [{ scale: morphCropScale(morph.t.get(), geometry?.coverScale ?? 1, targetScale) }],
    };
  });

  /** Once the clip box has laid out, the session may present. */
  const handleMorphLayout = useCallback(() => {
    // Only the real geometry counts: the box lays out once at the frame size
    // while the image loads, and again at its own size. Presenting on the
    // first would start the zoom from a box that is about to change.
    if (!active || !geometry || readySentRef.current) {
      return;
    }
    readySentRef.current = true;
    onImageReady?.();
  }, [active, geometry, onImageReady]);

  const zoomStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: panX.get() }, { translateY: panY.get() }, { scale: zoom.get() }],
  }));

  return (
    <View style={styles.surface}>
      <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, doubleTap)}>
        <View style={styles.gestureLayer}>
          <View pointerEvents="none" style={styles.centerLayer}>
            <Animated.View
              onLayout={handleMorphLayout}
              style={[
                {
                  // Until the image reports its size the box is the frame: the
                  // image has to be laid out somewhere for that report to
                  // happen at all, so it can never be gated on the geometry it
                  // itself produces.
                  width: geometry?.baseWidth ?? frame.width,
                  height: geometry?.baseHeight ?? frame.height,
                },
                styles.shell,
                shellStyle,
              ]}
            >
              <Animated.View
                // A View is only an accessibility element when it says so.
                accessible
                accessibilityActions={[
                  { name: 'zoomIn', label: 'Zoom in' },
                  { name: 'zoomOut', label: 'Zoom out' },
                  { name: 'resetZoom', label: 'Reset zoom' },
                ]}
                accessibilityLabel={label}
                accessibilityRole="image"
                onAccessibilityAction={handleAccessibilityAction}
                style={[styles.fill, zoomStyle]}
              >
                <Animated.View style={[styles.fill, cropStyle]}>
                  <AnimatedImage
                    accessible={false}
                    key={attempt}
                    contentFit="contain"
                    onLoad={handleLoad}
                    onError={() => setFailed(true)}
                    source={imageSource}
                    style={styles.fill}
                    transition={0}
                  />
                </Animated.View>
              </Animated.View>
            </Animated.View>
          </View>
        </View>
      </GestureDetector>
      {failed || !imageSource ? (
        <View style={styles.photoError}>
          <ThemedText accessibilityRole="alert">Could not load this photo.</ThemedText>
          <Button
            label="Retry photo"
            variant="secondary"
            onPress={() => { setFailed(false); setAttempt((current) => current + 1); }}
          />
        </View>
      ) : null}
    </View>
  );
}

/** Releases the pager lock a beat after a zoom-out animation finishes. */
function releasePagerAfter(delay: number, announceLock: (locked: boolean) => void): void {
  setTimeout(() => announceLock(false), delay);
}

const styles = StyleSheet.create({
  photoError: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing[24],
    gap: Spacing[12],
  },
  surface: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  gestureLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  // Centring is layout, not arithmetic: the clip box is centred by the frame
  // it sits in, so no computed offset can put it in the wrong place.
  centerLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shell: {
    overflow: 'hidden',
  },
  fill: {
    width: '100%',
    height: '100%',
  },
});
