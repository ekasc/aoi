import { useCallback, useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { runOnJS, useReducedMotion, withSpring } from 'react-native-reanimated';

import {
  CLOSE_SPRING,
  DRAG_RESISTANCE_RANGE,
  DRAG_SPRING,
  dampedDragOffset,
  progressVelocityFor,
  scrubProgress,
  shouldDismissOnRelease,
  type ViewerMorph,
} from '@/components/moments/zoomable-photo';



/**
 * Swipe to close, for the pages that have no thumbnail to land in.
 *
 * The rule is the photo viewer's own: the pull's length scrubs one progress
 * value (so any direction counts), the hand's travel rides along damped, and
 * on release either the gesture clearly meant it or it springs back. The page
 * turns that progress into its own transform, the way a photo's shell does.
 *
 * Horizontal drags are left to the pager: the page still swipes sideways to
 * the next piece of media, and only a mostly-vertical pull dismisses.
 */
export function useMediaDismiss({
  active,
  morph,
  onClose,
  onDismissStart,
}: {
  /** Only the visible page takes the gesture; the pager mounts neighbours. */
  active: boolean;
  morph: ViewerMorph;
  onClose: () => void;
  /** Called the instant a dismiss starts, so touches are handed back early. */
  onDismissStart: () => void;
}) {
  const { height: windowHeight } = useWindowDimensions();
  const reduceMotion = useReducedMotion();

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(active)
        // The pager owns horizontal travel; this page owns the vertical pull.
        .failOffsetX([-24, 24])
        .onUpdate((event) => {
          'worklet';
          const t = scrubProgress(event.translationX, event.translationY, windowHeight);
          const resistance = Math.min(DRAG_RESISTANCE_RANGE, windowHeight * 0.2);
          morph.t.value = t;
          morph.residualX.value =
            dampedDragOffset(event.translationX, resistance) * (1 - t * 0.5);
          morph.residualY.value =
            dampedDragOffset(event.translationY, resistance) * (1 - t * 0.5);
        })
        .onEnd((event) => {
          'worklet';
          const distance = Math.hypot(event.translationX, event.translationY);
          const speed = Math.hypot(event.velocityX, event.velocityY);
          const t = scrubProgress(event.translationX, event.translationY, windowHeight);
          if (!shouldDismissOnRelease(t, speed)) {
            morph.t.value = reduceMotion ? 0 : withSpring(0, DRAG_SPRING);
            morph.residualX.value = reduceMotion ? 0 : withSpring(0, DRAG_SPRING);
            morph.residualY.value = reduceMotion ? 0 : withSpring(0, DRAG_SPRING);
            return;
          }
          runOnJS(onDismissStart)();
          if (reduceMotion) {
            morph.t.value = 1;
            runOnJS(onClose)();
            return;
          }
          // Carry the hand's own pace out, the way the photo path does.
          morph.t.value = withSpring(
            1,
            { ...CLOSE_SPRING, velocity: progressVelocityFor(distance, speed, windowHeight) },
            (finished) => {
              'worklet';
              if (finished) {
                runOnJS(onClose)();
              }
            },
          );
          morph.residualX.value = withSpring(0, { ...CLOSE_SPRING, velocity: event.velocityX });
          morph.residualY.value = withSpring(0, { ...CLOSE_SPRING, velocity: event.velocityY });
        })
        .onFinalize((_, success) => {
          'worklet';
          if (success) {
            return;
          }
          // Cancelled mid-pull: nothing may be left off fullscreen.
          morph.t.value = reduceMotion ? 0 : withSpring(0, DRAG_SPRING);
          morph.residualX.value = reduceMotion ? 0 : withSpring(0, DRAG_SPRING);
          morph.residualY.value = reduceMotion ? 0 : withSpring(0, DRAG_SPRING);
        }),
    [active, morph, onClose, onDismissStart, reduceMotion, windowHeight],
  );

  return { gesture };
}

/**
 * Closes a media page from the Close control: the same motion the swipe runs,
 * so the two ways out of a page look like one another.
 */
export function useMediaCloseAnimation({
  morph,
  onClose,
  onDismissStart,
}: {
  morph: ViewerMorph;
  onClose: () => void;
  onDismissStart: () => void;
}) {
  const reduceMotion = useReducedMotion();
  return useCallback(() => {
    onDismissStart();
    if (reduceMotion) {
      morph.t.value = 1;
      onClose();
      return;
    }
    morph.t.value = withSpring(1, CLOSE_SPRING, (finished) => {
      'worklet';
      if (finished) {
        runOnJS(onClose)();
      }
    });
  }, [morph, onClose, onDismissStart, reduceMotion]);
}
