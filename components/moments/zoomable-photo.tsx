import { useCallback, useMemo } from 'react';
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
/** Past this scale the photo counts as zoomed (pager locks). */
export const ZOOMED_EPS = 0.02;
/** Drag distance that fully fades the viewer behind a dismiss. */
export const DISMISS_RANGE = 160;
/** Release past this offset (or faster than the velocity) closes. */
export const DISMISS_TRANSLATION = 120;
export const DISMISS_VELOCITY = 800;

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

/** 0→1 backdrop fade for a downward dismiss drag. */
export function dismissProgressFor(translationY: number): number {
  'worklet';
  if (!Number.isFinite(translationY) || translationY <= 0) {
    return 0;
  }
  return Math.min(1, translationY / DISMISS_RANGE);
}

/** Release closes past the offset, or on a fast downward fling. */
export function shouldDismissPhoto(translationY: number, velocityY: number): boolean {
  'worklet';
  return translationY > DISMISS_TRANSLATION || velocityY > DISMISS_VELOCITY;
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
 * One fullscreen photo with finger gestures: pinch to zoom (center
 * anchored, clamped), one-finger drag to pan while zoomed or to dismiss
 * down while at rest. The pager owns horizontal swipes — this pan only
 * claims vertical drags, and reports zoom so the viewer can lock paging
 * while a photo is enlarged.
 */
export function ZoomablePhoto({
  uri,
  label,
  onDismiss,
  onDismissProgress,
  onZoomChange,
}: {
  uri: string;
  label: string;
  onDismiss: () => void;
  /**
   * Backdrop fade writer (a worklet owned by the viewer); called straight
   * from gestures with the fade 0..1, animated on release when asked.
   */
  onDismissProgress: (progress: number, animated: boolean) => void;
  onZoomChange: (zoomed: boolean) => void;
}) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(ZOOM_MIN);
  const savedScale = useSharedValue(ZOOM_MIN);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  const sourceAspect = useSharedValue<number | null>(null);
  const zoomedFlag = useSharedValue(false);

  const handleLoad = useCallback(
    (event: { source?: { width?: number; height?: number } }) => {
      const width = event.source?.width ?? 0;
      const height = event.source?.height ?? 0;
      if (width > 0 && height > 0) {
        sourceAspect.value = width / height;
      }
    },
    [],
  );

  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .onStart(() => {
          'worklet';
          savedScale.value = scale.value;
        })
        .onUpdate((event) => {
          'worklet';
          const next = clampZoom(savedScale.value * event.scale);
          scale.value = next;
          if (next <= ZOOM_MIN + ZOOMED_EPS) {
            tx.value = 0;
            ty.value = 0;
          }
          const zoomed = next > ZOOM_MIN + ZOOMED_EPS;
          if (zoomed !== zoomedFlag.value) {
            zoomedFlag.value = zoomed;
            runOnJS(onZoomChange)(zoomed);
          }
        })
        .onEnd(() => {
          'worklet';
          if (scale.value <= ZOOM_MIN + ZOOMED_EPS) {
            scale.value = ZOOM_MIN;
            tx.value = 0;
            ty.value = 0;
            if (zoomedFlag.value) {
              zoomedFlag.value = false;
              runOnJS(onZoomChange)(false);
            }
          } else if (!zoomedFlag.value) {
            zoomedFlag.value = true;
            runOnJS(onZoomChange)(true);
          }
        }),
    [onZoomChange],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .maxPointers(1)
        .activeOffsetY([-12, 12])
        .onStart(() => {
          'worklet';
          savedTx.value = tx.value;
          savedTy.value = ty.value;
        })
        .onUpdate((event) => {
          'worklet';
          if (scale.value > ZOOM_MIN + ZOOMED_EPS) {
            const aspect = sourceAspect.value;
            const fittedWidth =
              aspect == null ? windowWidth : Math.min(windowWidth, windowHeight * aspect);
            const fittedHeight =
              aspect == null ? windowHeight : Math.min(windowHeight, windowWidth / aspect);
            const bounds = zoomPanBounds(
              fittedWidth * scale.value,
              fittedHeight * scale.value,
              windowWidth,
              windowHeight,
            );
            tx.value = clamp(savedTx.value + event.translationX, -bounds.x, bounds.x);
            ty.value = clamp(savedTy.value + event.translationY, -bounds.y, bounds.y);
          } else {
            onDismissProgress(dismissProgressFor(event.translationY), false);
            ty.value = Math.max(0, event.translationY);
          }
        })
        .onEnd((event) => {
          'worklet';
          if (scale.value > ZOOM_MIN + ZOOMED_EPS) {
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
          if (!success && scale.value <= ZOOM_MIN + ZOOMED_EPS) {
            ty.value = 0;
            onDismissProgress(0, false);
          }
        }),
    [
      onDismiss,
      onDismissProgress,
      reduceMotion,
      windowWidth,
      windowHeight,
    ],
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, pan)}>
      <Animated.View style={[styles.fill, animatedStyle]}>
        <Image
          accessibilityLabel={label}
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
