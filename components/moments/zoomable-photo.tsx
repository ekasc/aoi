import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Image } from 'expo-image';

import { resolveStagedUri } from '@/features/composer/staged-uri';

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;
/** Scale a double tap lands on, and returns from. */
export const DOUBLE_TAP_ZOOM = 2.5;
/** Past this scale the photo counts as zoomed (the pager locks). */
export const ZOOMED_EPS = 0.02;
/** Drag distance that fully fades the viewer behind a dismiss. */
export const DISMISS_RANGE = 160;
/** Release past this offset (or faster than the velocity) closes. */
export const DISMISS_TRANSLATION = 120;
export const DISMISS_VELOCITY = 800;
/** Drag distance before a pan is claimed, so a tap stays a tap. */
export const PAN_ACTIVATION = 12;
/** Milliseconds a zoom settle takes; reduced motion snaps instead. */
const ZOOM_DURATION = 220;

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
 * Offset that keeps the content point under the pinch still: the point that
 * started under the fingers (`startFocal`) has to end up under where the
 * fingers are now (`currentFocal`). Both focals and `startOffset` are
 * relative to the frame center, `ratio` is nextScale / startScale. Using the
 * current focal for the content point instead of the start focal is the
 * classic bug: the photo drifts as soon as the pinch also moves.
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

/** Where a double tap lands: back to rest when zoomed, in when at rest. */
export function zoomTargetOnDoubleTap(scale: number): number {
  'worklet';
  return isZoomedScale(scale) ? ZOOM_MIN : DOUBLE_TAP_ZOOM;
}

/** 0→1 backdrop fade for a downward dismiss drag. */
export function dismissProgressFor(translationY: number): number {
  'worklet';
  if (!Number.isFinite(translationY) || translationY <= 0) {
    return 0;
  }
  return Math.min(1, translationY / DISMISS_RANGE);
}

/**
 * Release closes past the offset, or on a fast downward fling. The velocity
 * only counts while the drag is actually downward, so an upward drag that
 * ends with a positive (but meaningless) velocity reading stays open.
 */
export function shouldDismissPhoto(translationY: number, velocityY: number): boolean {
  'worklet';
  if (!Number.isFinite(translationY) || !Number.isFinite(velocityY)) {
    return false;
  }
  return (
    translationY > DISMISS_TRANSLATION ||
    (translationY > 0 && velocityY > DISMISS_VELOCITY)
  );
}

/** Contain-fit size of a source image inside a frame. */
export function containFittedSize(
  sourceWidth: number,
  sourceHeight: number,
  frameWidth: number,
  frameHeight: number,
): { width: number; height: number } {
  'worklet';
  if (!(sourceWidth > 0) || !(sourceHeight > 0) || !(frameWidth > 0) || !(frameHeight > 0)) {
    return { width: frameWidth, height: frameHeight };
  }
  const scale = Math.min(frameWidth / sourceWidth, frameHeight / sourceHeight);
  return { width: sourceWidth * scale, height: sourceHeight * scale };
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

/**
 * Pan bounds for one photo at one scale inside the viewer frame. An unknown
 * source size (the load has not reported one yet) yields zero bounds: the
 * photo can be zoomed, but not pushed around a box we cannot size, which is
 * what keeps it from being dragged into empty space.
 */
export function panBoundsForScale(
  aspect: number | null,
  scaleValue: number,
  frameWidth: number,
  frameHeight: number,
): { x: number; y: number } {
  'worklet';
  if (aspect == null || !(aspect > 0)) {
    return { x: 0, y: 0 };
  }
  const fitted = containFittedSize(aspect, 1, frameWidth, frameHeight);
  return zoomPanBounds(
    fitted.width * scaleValue,
    fitted.height * scaleValue,
    frameWidth,
    frameHeight,
  );
}

/**
 * One fullscreen photo with finger gestures: pinch to zoom anchored where
 * the fingers are, drag in any direction to pan once enlarged, double tap
 * to zoom in or back out, and a one-finger drag down to dismiss while at
 * rest.
 *
 * The pan is split on purpose. At rest the horizontal axis belongs to the
 * pager (this pan claims vertical drags, which are the dismiss, and fails
 * horizontal ones so the swipe falls through cleanly); once the photo is
 * enlarged the viewer locks the pager, and this pan takes both axes —
 * otherwise the left and right of a zoomed photo would be unreachable. Both
 * pans clamp to the photo's own bounds, so it can never be dragged into
 * empty space.
 *
 * The same zoom is available without gestures: the photo is one accessible
 * element carrying Zoom in / Zoom out / Reset zoom actions, and the image
 * inside it is decorative so it is announced once.
 */
export function ZoomablePhoto({
  uri,
  label,
  onDismiss,
  onDismissProgress,
  onPagerLockChange,
}: {
  uri: string;
  label: string;
  onDismiss: () => void;
  /**
   * Backdrop fade writer (a worklet owned by the viewer); called straight
   * from gestures with the fade 0..1, animated on release when asked.
   */
  onDismissProgress: (progress: number, animated: boolean) => void;
  /**
   * True while the viewer must keep its pager still: from the moment a
   * pinch begins until the return-to-rest animation finishes, so paging can
   * never start against a photo that is still enlarged.
   */
  onPagerLockChange: (locked: boolean) => void;
}) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(ZOOM_MIN);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  // Pinch start snapshot: scale, offsets, and the focal point at the moment
  // the fingers landed, all relative to the frame center.
  const startScale = useSharedValue(ZOOM_MIN);
  const startTx = useSharedValue(0);
  const startTy = useSharedValue(0);
  const startFocalX = useSharedValue(0);
  const startFocalY = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  const sourceAspect = useSharedValue<number | null>(null);
  // UI-thread truth of "the pager must stay still"; React hears about it
  // only on the crossings, never per frame.
  const lockedFlag = useSharedValue(false);
  // Which pan exists is decided when the gesture is composed (`enabled`
  // takes a boolean, not a shared value), so the local pan mode is React
  // state — but it flips only BETWEEN gestures (when a pinch settles), never
  // while one is active: rebuilding the gesture graph mid-pinch would drop
  // the in-flight gesture.
  const [panZoomed, setPanZoomed] = useState(false);

  const announceLock = useCallback(
    (locked: boolean) => {
      onPagerLockChange(locked);
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
      sourceAspect.value = width / height;
      // The real box is known now: pull any stale offset (made while the
      // size was unknown) back inside it before the reader sees it.
      const bounds = panBoundsForScale(sourceAspect.value, scale.value, windowWidth, windowHeight);
      tx.value = clampPanOffset(tx.value, bounds.x);
      ty.value = clampPanOffset(ty.value, bounds.y);
    },
    [scale, sourceAspect, tx, ty, windowWidth, windowHeight],
  );

  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .onStart((event) => {
          'worklet';
          startScale.value = scale.value;
          startTx.value = tx.value;
          startTy.value = ty.value;
          startFocalX.value = event.focalX - windowWidth / 2;
          startFocalY.value = event.focalY - windowHeight / 2;
          // Lock the viewer's pager immediately: one that stays live through
          // the first frames of a pinch competes with it and can steal the
          // gesture. The local pan mode waits for the pinch to settle.
          if (!lockedFlag.value) {
            lockedFlag.value = true;
            runOnJS(announceLock)(true);
          }
        })
        .onUpdate((event) => {
          'worklet';
          const next = clampZoom(startScale.value * event.scale);
          const ratio = startScale.value === 0 ? 1 : next / startScale.value;
          const bounds = panBoundsForScale(sourceAspect.value, next, windowWidth, windowHeight);
          const currentFocalX = event.focalX - windowWidth / 2;
          const currentFocalY = event.focalY - windowHeight / 2;
          scale.value = next;
          tx.value = focalZoomOffset(
            startFocalX.value,
            currentFocalX,
            startTx.value,
            ratio,
            bounds.x,
          );
          ty.value = focalZoomOffset(
            startFocalY.value,
            currentFocalY,
            startTy.value,
            ratio,
            bounds.y,
          );
        })
        .onEnd(() => {
          'worklet';
          settlePinch(true);
        })
        .onFinalize((_, success) => {
          'worklet';
          // A cancelled pinch must not leave a half-applied zoom behind.
          if (!success) {
            settlePinch(false);
          }
        }),
    [announceLock, windowWidth, windowHeight],
  );

  /** Shared pinch finalizer: settle to rest, or clamp and stay enlarged. */
  const settlePinch = (success: boolean) => {
    'worklet';
    if (isZoomedScale(scale.value)) {
      // Stayed enlarged: pull the photo inside its bounds (a cancellation can
      // happen mid-zoom) and hand the drags to the zoomed pan. The pager is
      // already locked from the pinch start.
      const bounds = panBoundsForScale(sourceAspect.value, scale.value, windowWidth, windowHeight);
      tx.value = clampPanOffset(tx.value, bounds.x);
      ty.value = clampPanOffset(ty.value, bounds.y);
      runOnJS(setPanZoomed)(true);
      return;
    }
    const finish = () => {
      'worklet';
      runOnJS(setPanZoomed)(false);
      if (lockedFlag.value) {
        lockedFlag.value = false;
        runOnJS(announceLock)(false);
      }
    };
    if (success && !reduceMotion) {
      scale.value = withTiming(ZOOM_MIN, { duration: ZOOM_DURATION }, (done) => {
        'worklet';
        if (done) {
          finish();
        }
      });
      tx.value = withTiming(0, { duration: ZOOM_DURATION });
      ty.value = withTiming(0, { duration: ZOOM_DURATION });
      return;
    }
    scale.value = ZOOM_MIN;
    tx.value = 0;
    ty.value = 0;
    finish();
  };

  const restPan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!panZoomed)
        .maxPointers(1)
        .activeOffsetY([-PAN_ACTIVATION, PAN_ACTIVATION])
        // Horizontal intent belongs to the pager: give it up explicitly.
        .failOffsetX([-PAN_ACTIVATION, PAN_ACTIVATION])
        .onStart(() => {
          'worklet';
          savedTx.value = tx.value;
          savedTy.value = ty.value;
        })
        .onUpdate((event) => {
          'worklet';
          // The local mode flips in the pinch finalizer, so for the frame
          // between a pinch ending and that render this pan can still be the
          // live one: while the photo is enlarged a drag is a pan, never a
          // dismiss.
          if (isZoomedScale(scale.value)) {
            return;
          }
          onDismissProgress(dismissProgressFor(event.translationY), false);
          ty.value = Math.max(0, event.translationY);
        })
        .onEnd((event) => {
          'worklet';
          if (isZoomedScale(scale.value)) {
            ty.value = 0;
            onDismissProgress(0, false);
            return;
          }
          if (shouldDismissPhoto(event.translationY, event.velocityY)) {
            runOnJS(onDismiss)();
          } else if (reduceMotion) {
            ty.value = 0;
            onDismissProgress(0, false);
          } else {
            ty.value = withTiming(0);
            onDismissProgress(0, true);
          }
        })
        .onFinalize((_, success) => {
          'worklet';
          if (!success) {
            ty.value = 0;
            onDismissProgress(0, false);
          }
        }),
    [panZoomed, onDismiss, onDismissProgress, reduceMotion, scale],
  );

  const zoomedPan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(panZoomed)
        .maxPointers(1)
        // Any direction counts. activeOffsetX + activeOffsetY are AND-ed, so
        // a mostly horizontal drag would never leave the Y dead zone.
        .minDistance(PAN_ACTIVATION)
        .onStart(() => {
          'worklet';
          savedTx.value = tx.value;
          savedTy.value = ty.value;
        })
        .onUpdate((event) => {
          'worklet';
          const bounds = panBoundsForScale(sourceAspect.value, scale.value, windowWidth, windowHeight);
          tx.value = clampPanOffset(savedTx.value + event.translationX, bounds.x);
          ty.value = clampPanOffset(savedTy.value + event.translationY, bounds.y);
        }),
    [panZoomed, windowWidth, windowHeight],
  );

  /**
   * Animate to a target zoom anchored at a point (0, 0 = frame center).
   * Shared by double tap and the accessibility actions, so the two can never
   * disagree about how zoom behaves.
   */
  const zoomTo = useCallback(
    (target: number, focusX: number, focusY: number) => {
      const startFrom = scale.value;
      const ratio = startFrom === 0 ? 1 : target / startFrom;
      const bounds = panBoundsForScale(sourceAspect.value, target, windowWidth, windowHeight);
      const atRest = !isZoomedScale(target);
      const nextX = atRest ? 0 : focalZoomOffset(focusX, focusX, tx.value, ratio, bounds.x);
      const nextY = atRest ? 0 : focalZoomOffset(focusY, focusY, ty.value, ratio, bounds.y);
      // Lock before the animation, not after: the pager must not start
      // paging while the photo is still growing.
      if (!lockedFlag.value) {
        lockedFlag.value = true;
        announceLock(true);
      }
      // Enlarging hands the drags to the zoomed pan straight away (the photo
      // is already growing). Shrinking does NOT: while the return to rest is
      // still animating the photo is still enlarged, so the zoomed pan keeps
      // the drags and a touch in that window cannot become a dismiss.
      if (!atRest) {
        setPanZoomed(true);
      }
      const settle = (done?: boolean) => {
        'worklet';
        if (done === false) {
          // Replaced by another action: that one owns the next state.
          return;
        }
        if (!atRest) {
          return;
        }
        runOnJS(setPanZoomed)(false);
        if (lockedFlag.value) {
          lockedFlag.value = false;
          runOnJS(announceLock)(false);
        }
      };
      if (reduceMotion) {
        scale.value = target;
        tx.value = nextX;
        ty.value = nextY;
        settle(true);
        return;
      }
      scale.value = withTiming(target, { duration: ZOOM_DURATION }, (done) => {
        'worklet';
        settle(done);
      });
      tx.value = withTiming(nextX, { duration: ZOOM_DURATION });
      ty.value = withTiming(nextY, { duration: ZOOM_DURATION });
    },
    [announceLock, reduceMotion, scale, sourceAspect, tx, ty, windowWidth, windowHeight],
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
          const target = zoomTargetOnDoubleTap(scale.value);
          const focusX = event.x - windowWidth / 2;
          const focusY = event.y - windowHeight / 2;
          const startFrom = scale.value;
          const ratio = startFrom === 0 ? 1 : target / startFrom;
          const bounds = panBoundsForScale(sourceAspect.value, target, windowWidth, windowHeight);
          const atRest = !isZoomedScale(target);
          const nextX = atRest ? 0 : focalZoomOffset(focusX, focusX, tx.value, ratio, bounds.x);
          const nextY = atRest ? 0 : focalZoomOffset(focusY, focusY, ty.value, ratio, bounds.y);
          // The pager locks for the whole gesture: from here until the return
          // to rest finishes, if this tap is a zoom-out.
          if (!lockedFlag.value) {
            lockedFlag.value = true;
            runOnJS(announceLock)(true);
          }
          const unlockWhenDone = (done?: boolean) => {
            'worklet';
            if (done === false) {
              return;
            }
            if (lockedFlag.value && atRest) {
              lockedFlag.value = false;
              runOnJS(announceLock)(false);
            }
          };
          if (reduceMotion) {
            scale.value = target;
            tx.value = nextX;
            ty.value = nextY;
            runOnJS(setPanZoomed)(!atRest);
            unlockWhenDone(true);
            return;
          }
          scale.value = withTiming(target, { duration: ZOOM_DURATION }, (done) => {
            'worklet';
            if (done) {
              runOnJS(setPanZoomed)(!atRest);
            }
            unlockWhenDone(done);
          });
          tx.value = withTiming(nextX, { duration: ZOOM_DURATION });
          ty.value = withTiming(nextY, { duration: ZOOM_DURATION });
        }),
    [announceLock, reduceMotion, scale, sourceAspect, tx, ty, windowWidth, windowHeight],
  );

  const handleAccessibilityAction = useCallback(
    (event: { nativeEvent: { actionName: string } }) => {
      const action = event.nativeEvent.actionName;
      if (action === 'zoomIn') {
        // Never a step down: the action says in, whatever the current scale.
        zoomTo(Math.min(ZOOM_MAX, scale.value * DOUBLE_TAP_ZOOM), 0, 0);
        return;
      }
      if (action === 'zoomOut') {
        zoomTo(Math.max(ZOOM_MIN, scale.value / DOUBLE_TAP_ZOOM), 0, 0);
        return;
      }
      if (action === 'resetZoom') {
        zoomTo(ZOOM_MIN, 0, 0);
      }
    },
    [scale, zoomTo],
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, restPan, zoomedPan, doubleTap)}>
      <Animated.View
        // A View is only an accessibility element when it says so; role and
        // actions alone are not enough.
        accessible
        accessibilityActions={[
          { name: 'zoomIn', label: 'Zoom in' },
          { name: 'zoomOut', label: 'Zoom out' },
          { name: 'resetZoom', label: 'Reset zoom' },
        ]}
        accessibilityLabel={label}
        accessibilityRole="image"
        onAccessibilityAction={handleAccessibilityAction}
        style={[styles.fill, animatedStyle]}
      >
        <Image
          accessible={false}
          contentFit="contain"
          source={{ uri: resolveStagedUri(uri) }}
          style={styles.image}
          transition={reduceMotion ? 0 : 200}
          onLoad={handleLoad}
        />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: {
    width: '100%',
    height: '100%',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
