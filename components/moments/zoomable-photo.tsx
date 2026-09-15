import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
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

import { resolveStagedUri } from '@/features/composer/staged-uri';

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
/** Downward fling that dismisses regardless of distance. */
export const DISMISS_VELOCITY = 1050;
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
/**
 * The close is a spring, not a timing curve: it carries the speed the finger
 * had into the tile and settles. A reversed open curve (slow, then fast)
 * reads as a stall followed by whiplash — momentum, stop, momentum — which is
 * exactly what a hand-off should never feel like.
 */
export const CLOSE_SPRING = {
  stiffness: 220,
  damping: 26,
  mass: 1,
  overshootClamping: true,
};
/** Spring for a released drag that does not dismiss. */
export const DRAG_SPRING = {
  stiffness: 240,
  damping: 30,
  mass: 1,
  overshootClamping: true,
};

const AnimatedImage = Animated.createAnimatedComponent(Image);

function clamp(value: number, min: number, max: number): number {
  'worklet';
  return Math.min(max, Math.max(min, value));
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
 * The finger's speed translated into progress per second, so a spring can
 * start the close at exactly the pace the hand let go with. `resistance` is
 * the same constant `scrubProgress` uses, so the two always agree.
 */
export function progressVelocityFor(
  distance: number,
  speed: number,
  frameHeight: number,
): number {
  'worklet';
  if (!Number.isFinite(distance) || !Number.isFinite(speed) || speed <= 0) {
    return 0;
  }
  const resistance = Math.max(700, frameHeight * 0.9);
  const travelled = Math.max(0, distance);
  // d(progress)/d(distance) for the exponential scrub, times the speed.
  return (speed * Math.exp(-travelled / resistance)) / resistance;
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
      sourceWidth.value = width;
      sourceHeight.value = height;
      if (active) {
        // The visible photo tells the viewer its intrinsic size, which is
        // what the morph needs to interpolate the image's rect, and the
        // viewer will not present until it has it.
        morph.sourceWidth.value = width;
        morph.sourceHeight.value = height;
        onImageReady?.();
      }
      const bounds = panBoundsForScale(width, height, zoom.value, windowWidth, windowHeight);
      panX.value = clampPanOffset(panX.value, bounds.x);
      panY.value = clampPanOffset(panY.value, bounds.y);
    },
    [
      active,
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
    const duration = reduceMotion ? 0 : 180;
    if (reduceMotion) {
      morph.t.value = 1;
      morph.residualX.value = 0;
      morph.residualY.value = 0;
      onDismiss();
      return;
    }
    morph.t.value = withSpring(1, CLOSE_SPRING, (finished) => {
      'worklet';
      if (finished) {
        runOnJS(onDismiss)();
      }
    });
    morph.residualX.value = withSpring(0, CLOSE_SPRING);
    morph.residualY.value = withSpring(0, CLOSE_SPRING);
    void duration;
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
          startZoom.value = zoom.value;
          startPanX.value = panX.value;
          startPanY.value = panY.value;
          startFocalX.value = event.focalX - windowWidth / 2;
          startFocalY.value = event.focalY - windowHeight / 2;
          // Lock the pager the moment a pinch begins: one that stays live
          // through the first frames competes with the pinch.
          if (!zoomedFlag.value) {
            zoomedFlag.value = true;
            runOnJS(announceLock)(true);
          }
        })
        .onUpdate((event) => {
          'worklet';
          const next = clampZoom(startZoom.value * event.scale);
          const ratio = startZoom.value === 0 ? 1 : next / startZoom.value;
          const bounds = panBoundsForScale(
            sourceWidth.value,
            sourceHeight.value,
            next,
            windowWidth,
            windowHeight,
          );
          zoom.value = next;
          panX.value = focalZoomOffset(
            startFocalX.value,
            event.focalX - windowWidth / 2,
            startPanX.value,
            ratio,
            bounds.x,
          );
          panY.value = focalZoomOffset(
            startFocalY.value,
            event.focalY - windowHeight / 2,
            startPanY.value,
            ratio,
            bounds.y,
          );
        })
        .onEnd(() => {
          'worklet';
          if (isZoomedScale(zoom.value)) {
            const bounds = panBoundsForScale(
              sourceWidth.value,
              sourceHeight.value,
              zoom.value,
              windowWidth,
              windowHeight,
            );
            panX.value = clampPanOffset(panX.value, bounds.x);
            panY.value = clampPanOffset(panY.value, bounds.y);
            return;
          }
          const duration = reduceMotion ? 0 : ZOOM_DURATION;
          zoom.value = withTiming(ZOOM_MIN, { duration });
          panX.value = withTiming(0, { duration });
          panY.value = withTiming(0, { duration });
          if (zoomedFlag.value) {
            zoomedFlag.value = false;
            runOnJS(announceLock)(false);
          }
        })
        .onFinalize((_, success) => {
          'worklet';
          if (success || isZoomedScale(zoom.value)) {
            return;
          }
          // Cancelled mid-pinch: never leave a half-applied zoom behind.
          zoom.value = ZOOM_MIN;
          panX.value = 0;
          panY.value = 0;
          if (zoomedFlag.value) {
            zoomedFlag.value = false;
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
            touchX.value = touch.absoluteX;
            touchY.value = touch.absoluteY;
          }
        })
        .onTouchesMove((event, manager) => {
          'worklet';
          const touch = event.allTouches[0];
          if (!touch) {
            return;
          }
          const dx = touch.absoluteX - touchX.value;
          const dy = touch.absoluteY - touchY.value;
          if (isZoomedScale(zoom.value)) {
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
          startPanX.value = panX.value;
          startPanY.value = panY.value;
        })
        .onUpdate((event) => {
          'worklet';
          if (isZoomedScale(zoom.value)) {
            const bounds = panBoundsForScale(
              sourceWidth.value,
              sourceHeight.value,
              zoom.value,
              windowWidth,
              windowHeight,
            );
            panX.value = clampPanOffset(startPanX.value + event.translationX, bounds.x);
            panY.value = clampPanOffset(startPanY.value + event.translationY, bounds.y);
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
          morph.t.value = t;
          morph.residualX.value = dampedDragOffset(event.translationX, resistance) * (1 - t * 0.5);
          morph.residualY.value = dampedDragOffset(event.translationY, resistance) * (1 - t * 0.5);
        })
        .onEnd((event) => {
          'worklet';
          if (!active || isZoomedScale(zoom.value)) {
            return;
          }
          const distance = Math.hypot(event.translationX, event.translationY);
          const speed = Math.hypot(event.velocityX, event.velocityY);
          const t = scrubProgress(event.translationX, event.translationY, windowHeight);
          if (t >= DISMISS_PROGRESS || speed > DISMISS_VELOCITY) {
            runOnJS(handleDismissStart)();
            // Continue the motion the hand started, at the hand's own pace, and
            // settle into the tile: a spring carries that velocity, a timing
            // curve would restart from zero and stall first.
            morph.t.value = withSpring(
              1,
              {
                ...CLOSE_SPRING,
                velocity: progressVelocityFor(distance, speed, windowHeight),
              },
              (finished) => {
                'worklet';
                if (finished) {
                  runOnJS(onDismiss)();
                }
              },
            );
            morph.residualX.value = withSpring(0, { ...CLOSE_SPRING, velocity: event.velocityX });
            morph.residualY.value = withSpring(0, { ...CLOSE_SPRING, velocity: event.velocityY });
            return;
          }
          morph.t.value = withSpring(0, DRAG_SPRING);
          morph.residualX.value = withSpring(0, DRAG_SPRING);
          morph.residualY.value = withSpring(0, DRAG_SPRING);
        })
        .onFinalize((_, success) => {
          'worklet';
          if (success || !active || isZoomedScale(zoom.value)) {
            return;
          }
          // Cancelled mid-drag: never park the photo away from fullscreen.
          morph.t.value = withSpring(0, DRAG_SPRING);
          morph.residualX.value = withSpring(0, DRAG_SPRING);
          morph.residualY.value = withSpring(0, DRAG_SPRING);
        }),
    [
      active,
      handleDismissStart,
      morph,
      onDismiss,
      panX,
      panY,
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
      const startFrom = zoom.value;
      const ratio = startFrom === 0 ? 1 : target / startFrom;
      const bounds = panBoundsForScale(
        sourceWidth.value,
        sourceHeight.value,
        target,
        windowWidth,
        windowHeight,
      );
      const atRest = !isZoomedScale(target);
      const nextX = atRest ? 0 : focalZoomOffset(focusX, focusX, panX.value, ratio, bounds.x);
      const nextY = atRest ? 0 : focalZoomOffset(focusY, focusY, panY.value, ratio, bounds.y);
      const duration = reduceMotion ? 0 : ZOOM_DURATION;
      if (!zoomedFlag.value) {
        zoomedFlag.value = true;
        announceLock(true);
      }
      zoom.value = withTiming(target, { duration });
      panX.value = withTiming(nextX, { duration });
      panY.value = withTiming(nextY, { duration });
      if (atRest) {
        const release = () => {
          if (zoomedFlag.value) {
            zoomedFlag.value = false;
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
          const target = zoomTargetOnDoubleTap(zoom.value);
          const focusX = event.x - windowWidth / 2;
          const focusY = event.y - windowHeight / 2;
          const startFrom = zoom.value;
          const ratio = startFrom === 0 ? 1 : target / startFrom;
          const bounds = panBoundsForScale(
            sourceWidth.value,
            sourceHeight.value,
            target,
            windowWidth,
            windowHeight,
          );
          const atRest = !isZoomedScale(target);
          const nextX = atRest ? 0 : focalZoomOffset(focusX, focusX, panX.value, ratio, bounds.x);
          const nextY = atRest ? 0 : focalZoomOffset(focusY, focusY, panY.value, ratio, bounds.y);
          const duration = reduceMotion ? 0 : ZOOM_DURATION;
          zoom.value = withTiming(target, { duration });
          panX.value = withTiming(nextX, { duration });
          panY.value = withTiming(nextY, { duration });
          if (!zoomedFlag.value) {
            zoomedFlag.value = true;
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
        zoomTo(Math.min(ZOOM_MAX, zoom.value * DOUBLE_TAP_ZOOM), 0, 0);
        return;
      }
      if (action === 'zoomOut') {
        zoomTo(Math.max(ZOOM_MIN, zoom.value / DOUBLE_TAP_ZOOM), 0, 0);
        return;
      }
      if (action === 'resetZoom') {
        zoomTo(ZOOM_MIN, 0, 0);
      }
    },
    [zoom, zoomTo],
  );

  // The shell: the photo's frame, moved and scaled from the whole window at
  // rest to covering the thumbnail at home. Transform-only on purpose — it is
  // composited, so it cannot stall layout the way an animated rect does (a
  // per-frame width/height animation inside a Modal froze the app).
  const shellStyle = useAnimatedStyle(() => {
    const t = morph.t.value;
    const hasHome = home.valid.value;
    const target = hasHome
      ? {
          x: home.x.value,
          y: home.y.value,
          width: home.width.value,
          height: home.height.value,
        }
      : frame;
    // Scale that makes the window cover the thumbnail (the thumbnail is a
    // cropped fill, so covering reproduces it), eased with the same progress.
    const cover = hasHome
      ? Math.max(target.width / frame.width, target.height / frame.height)
      : 1;
    const scale = 1 + (Math.min(cover, 1) - 1) * t;
    const centerX = frame.x + frame.width / 2;
    const centerY = frame.y + frame.height / 2;
    const targetCenterX = hasHome ? target.x + target.width / 2 : centerX;
    const targetCenterY = hasHome ? target.y + target.height / 2 : centerY;
    return {
      transform: [
        { translateX: morph.residualX.value },
        { translateY: morph.residualY.value },
        { translateX: (targetCenterX - centerX) * t },
        { translateY: (targetCenterY - centerY) * t },
        { scale },
      ],
      borderRadius: shellRadiusFor(t, home.radius.value, scale),
      opacity: morph.overlay.value,
    };
  });

  const zoomStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: panX.value }, { translateY: panY.value }, { scale: zoom.value }],
  }));

  return (
    <Animated.View style={[styles.shell, shellStyle]}>
      <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, doubleTap)}>
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
          <AnimatedImage
            accessible={false}
            contentFit="contain"
            onLoad={handleLoad}
            source={{ uri: resolveStagedUri(uri) }}
            style={styles.image}
            transition={0}
          />
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

/** Releases the pager lock a beat after a zoom-out animation finishes. */
function releasePagerAfter(delay: number, announceLock: (locked: boolean) => void): void {
  setTimeout(() => announceLock(false), delay);
}

const styles = StyleSheet.create({
  shell: {
    width: '100%',
    height: '100%',
    overflow: 'hidden',
  },
  fill: {
    width: '100%',
    height: '100%',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
