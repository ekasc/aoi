import { useCallback, useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  withSpring,
} from 'react-native-reanimated';

import {
  CLOSE_SPRING,
  DRAG_RESISTANCE_RANGE,
  DRAG_SPRING,
  dampedDragOffset,
  progressVelocityFor,
  scrubProgress,
  shouldDismissOnRelease,
  type PhotoOrigin,
  type ViewerHome,
  type ViewerMorph,
} from '@/components/moments/zoomable-photo';

/** How much the page itself shrinks as it fades into the hand-off. */
export const MEDIA_DISMISS_SHRINK = 0.06;

/**
 * The pull at which the tile-shaped hand-off starts appearing. Before it, the
 * page is still the page; after it, the reader is watching it become its tile.
 */
const HANDOFF_APPEARS_AT = 0.35;

/**
 * Swipe to close, for the pages that have no thumbnail to land in.
 *
 * The rule is the photo viewer's own: the pull's length scrubs one progress
 * value (so any direction counts), the hand's travel rides along damped, and
 * on release either the gesture clearly meant it or it springs back. What
 * differs is the ending — a clip or a voice note has no tile to morph into,
 * so it shrinks and fades from wherever the hand left it.
 *
 * Horizontal drags are left to the pager: the page still swipes sideways to
 * the next piece of media, and only a mostly-vertical pull dismisses.
 */
export function useMediaDismiss({
  active,
  morph,
  home,
  origin,
  onClose,
  onDismissStart,
}: {
  /** Only the visible page takes the gesture; the pager mounts neighbours. */
  active: boolean;
  morph: ViewerMorph;
  /** Where the tile is, in window coordinates, for the hand-off to land on. */
  home: ViewerHome;
  /** The same rect as plain numbers, for the hand-off's static layout. */
  origin?: PhotoOrigin;
  onClose: () => void;
  /** Called the instant a dismiss starts, so touches are handed back early. */
  onDismissStart: () => void;
}) {
  const { height: windowHeight, width: frameWidth } = useWindowDimensions();
  const frameHeight = windowHeight;
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

  // The page follows the hand and fades: it is a page of controls, and no
  // tile is shaped like one.
  const style = useAnimatedStyle(() => ({
    opacity: morph.overlay.value * (1 - morph.t.value),
    transform: [
      { translateX: morph.residualX.value },
      { translateY: morph.residualY.value },
      { scale: 1 - MEDIA_DISMISS_SHRINK * morph.t.value },
    ],
  }));

  /**
   * The hand-off: the tile's own look, travelling from where the page was to
   * where the tile is, so the dismissal lands on the thumbnail the way a
   * photo's does. It is the same look the wall drew, from gallery-tile.
   */
  const previewStyle = useAnimatedStyle(() => {
    const t = morph.t.value;
    if (!home.valid.value) {
      return { opacity: 0 };
    }
    const appear = interpolate(
      t,
      [HANDOFF_APPEARS_AT, 1],
      [0, 1],
      Extrapolation.CLAMP,
    );
    const centreX = frameWidth / 2;
    const centreY = frameHeight / 2;
    const targetCentreX = home.x.value + home.width.value / 2;
    const targetCentreY = home.y.value + home.height.value / 2;
    return {
      opacity: morph.overlay.value * appear,
      borderRadius: home.radius.value,
      transform: [
        { translateX: (targetCentreX - centreX) * t },
        { translateY: (targetCentreY - centreY) * t },
      ],
    };
  });

  return { gesture, style, previewStyle };
}

/**
 * Closes a media page from the Close control: the same shrink-and-fade the
 * swipe runs, so the two ways out of a page look like one another.
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
