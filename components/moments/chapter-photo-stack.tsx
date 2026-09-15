import { memo, useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { IconButton } from '@/components/ui/icon-button';
import { Radii, Spacing } from '@/constants/theme';
import type { Moment } from '@/features/moments/types';
import { resolveStagedUri } from '@/features/composer/staged-uri';
import { useThemeColor } from '@/hooks/use-theme-color';

/** Small keepsake footprint: fits a 320pt screen inside chapter padding. */
export const CHAPTER_PHOTO_STACK_WIDTH = 216;
export const CHAPTER_PHOTO_STACK_HEIGHT = 270;
/** Top plus three peeking behind; deeper photos wait their turn. */
const VISIBLE_CARDS = 4;
/** 10pt hysteresis before a touch becomes a swipe; taps stay taps. */
const SWIPE_DISTANCE = 60;
const SWIPE_VELOCITY = 700;
/** Clamped settle: never overshoots past center (damping 32 ~= critical for stiffness 240). */
const SETTLE_SPRING = { damping: 32, stiffness: 240, overshootClamping: true } as const;
const SCALE_BY_DEPTH = [1, 0.94, 0.88, 0.83];
const OFFSET_Y_BY_DEPTH = [0, 10, 20, 30];
const ROTATION_BY_DEPTH = ['0deg', '-4deg', '3deg', '-2deg'];

export type ChapterPhotoMoment = Moment & { mediaPreview: string };

export function isChapterPhotoMoment(moment: Moment): moment is ChapterPhotoMoment {
  return moment.type === 'media' && typeof moment.mediaPreview === 'string' && moment.mediaPreview.length > 0;
}

/** Only real attached photos, in chapter order. Never placeholders. */
export function getChapterPhotoMoments(moments: Moment[]): ChapterPhotoMoment[] {
  return moments.filter(isChapterPhotoMoment);
}

export type ChapterPhotoStackProps = {
  moments: Moment[];
  onOpenMoment: (moment: Moment) => void;
};

type StackCardProps = {
  photo: ChapterPhotoMoment;
  depth: number;
  dragX: SharedValue<number>;
  reduceMotion: boolean;
  isTop: boolean;
  position: number;
  total: number;
  onPress?: () => void;
};

const StackCard = memo(function StackCard({
  photo,
  depth,
  dragX,
  reduceMotion,
  isTop,
  position,
  total,
  onPress,
}: StackCardProps) {
  const border = useThemeColor({}, 'border');
  const backgroundSubtle = useThemeColor({}, 'backgroundSubtle');
  const clampedDepth = Math.min(depth, VISIBLE_CARDS - 1);

  const animatedStyle = useAnimatedStyle(() => {
    if (reduceMotion) {
      return {};
    }
    const parallax = isTop ? 1 : 0.12 / Math.max(1, clampedDepth);
    return {
      transform: [
        { translateX: dragX.value * parallax },
        { translateY: OFFSET_Y_BY_DEPTH[clampedDepth] ?? 0 },
        { scale: SCALE_BY_DEPTH[clampedDepth] ?? 1 },
        {
          rotate: isTop
            ? `${(dragX.value / CHAPTER_PHOTO_STACK_WIDTH) * 6}deg`
            : (ROTATION_BY_DEPTH[clampedDepth] ?? '0deg'),
        },
      ],
    };
  });

  const staticStyle = useMemo(
    () => ({
      transform: [
        { translateY: OFFSET_Y_BY_DEPTH[clampedDepth] ?? 0 },
        { scale: SCALE_BY_DEPTH[clampedDepth] ?? 1 },
      ],
    }),
    [clampedDepth],
  );

  const title = photo.title.trim();
  const label = `Photo${title ? `: ${title}` : ''}, ${position} of ${total}`;
  const zIndex = VISIBLE_CARDS - clampedDepth;

  const frame = (
    <View style={[styles.card, { borderColor: border, backgroundColor: backgroundSubtle }]}>
      {isTop ? (
        <Pressable
          accessibilityHint="Opens this memory"
          accessibilityLabel={`Open ${label.toLowerCase()}`}
          accessibilityRole="button"
          onPress={onPress}
          style={styles.topPressable}
          testID="chapter-photo-stack-top"
        >
          <Image
            accessible={false}
            contentFit="cover"
            source={{ uri: resolveStagedUri(photo.mediaPreview) }}
            style={styles.photo}
            transition={200}
          />
        </Pressable>
      ) : (
        <Image
          accessible={false}
          contentFit="cover"
          source={{ uri: resolveStagedUri(photo.mediaPreview) }}
          style={styles.photo}
          transition={200}
        />
      )}
    </View>
  );

  if (reduceMotion) {
    return (
      <View
        accessible={false}
        accessibilityElementsHidden={isTop ? undefined : true}
        importantForAccessibility={isTop ? undefined : 'no-hide-descendants'}
        aria-hidden={isTop ? undefined : true}
        style={[styles.slot, staticStyle, { zIndex, elevation: zIndex }]}
      >
        {frame}
      </View>
    );
  }

  return (
    <Animated.View
      accessible={false}
      accessibilityElementsHidden={isTop ? undefined : true}
      importantForAccessibility={isTop ? undefined : 'no-hide-descendants'}
      aria-hidden={isTop ? undefined : true}
      style={[styles.slot, animatedStyle, { zIndex, elevation: zIndex }]}
    >
      {frame}
    </Animated.View>
  );
});

/**
 * Keepsake photo stack for one chapter: the chapter's real photos fanned
 * with slight rotation and depth. The top photo tracks the finger 1:1 and
 * settles with a clamped spring (no bounce); releasing past a
 * short threshold steps to the next or previous photo, wrapping so the
 * stack never empties. Tapping the top photo opens that memory. Previous
 * and next buttons offer the same steps without swiping. Reduced motion
 * renders a static fanned stack with instant steps. Empty and photo-less
 * chapters render nothing, leaving the archive list untouched.
 */
export function ChapterPhotoStack({ moments, onOpenMoment }: ChapterPhotoStackProps) {
  const reduceMotion = useReducedMotion();
  const muted = useThemeColor({}, 'muted');
  const photos = useMemo(() => getChapterPhotoMoments(moments), [moments]);
  const [selectedIndex, setActiveIndex] = useState(0);
  const dragX = useSharedValue(0);
  const count = photos.length;

  const activeIndex = count > 0 ? selectedIndex % count : 0;

  const goNext = useCallback(() => {
    if (count <= 1) {
      return;
    }
    setActiveIndex((prev) => (prev + 1) % count);
  }, [count]);

  const goPrevious = useCallback(() => {
    if (count <= 1) {
      return;
    }
    setActiveIndex((prev) => (prev - 1 + count) % count);
  }, [count]);

  const handleOpenTop = useCallback(() => {
    const current = photos[activeIndex];
    if (current) {
      onOpenMoment(current);
    }
  }, [photos, activeIndex, onOpenMoment]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-10, 10])
        .failOffsetY([-12, 12])
        .onUpdate((event) => {
          'worklet';
          dragX.value = event.translationX;
        })
        .onEnd((event) => {
          'worklet';
          if (event.translationX <= -SWIPE_DISTANCE || event.velocityX <= -SWIPE_VELOCITY) {
            // Reset synchronously before the index swap so the incoming top
            // card mounts at rest instead of inheriting the swipe offset.
            dragX.value = 0;
            runOnJS(goNext)();
          } else if (event.translationX >= SWIPE_DISTANCE || event.velocityX >= SWIPE_VELOCITY) {
            dragX.value = 0;
            runOnJS(goPrevious)();
          } else {
            dragX.value = withSpring(0, { ...SETTLE_SPRING });
          }
        })
        .onFinalize(() => {
          'worklet';
          // Cancellation (system interrupt, competing gesture) never leaves
          // a stuck translation behind.
          dragX.value = withSpring(0, { ...SETTLE_SPRING });
        }),
    [goNext, goPrevious],
  );

  if (count === 0) {
    return null;
  }

  const visibleCount = Math.min(count, VISIBLE_CARDS);
  const behind: React.ReactNode[] = [];
  for (let depth = visibleCount - 1; depth >= 1; depth -= 1) {
    const photoIndex = (activeIndex + depth) % count;
    const photo = photos[photoIndex];
    if (!photo) {
      continue;
    }
    behind.push(
      <StackCard
        key={photo.id}
        photo={photo}
        depth={depth}
        dragX={dragX}
        reduceMotion={reduceMotion}
        isTop={false}
        position={photoIndex + 1}
        total={count}
      />,
    );
  }
  const topPhoto = photos[activeIndex];
  const top =
    topPhoto == null ? null : (
      <StackCard
        key={topPhoto.id}
        photo={topPhoto}
        depth={0}
        dragX={dragX}
        reduceMotion={reduceMotion}
        isTop
        position={activeIndex + 1}
        total={count}
        onPress={handleOpenTop}
      />
    );
  const topNode =
    top == null || reduceMotion ? top : <GestureDetector gesture={pan}>{top}</GestureDetector>;

  return (
    <GestureHandlerRootView testID="chapter-photo-stack" style={styles.root}>
      <View style={styles.stage}>
        {behind}
        {topNode}
      </View>
      {count > 1 ? (
        <View style={styles.controls}>
          <IconButton
            accessibilityLabel="Show previous photo"
            label="Show previous photo"
            onPress={goPrevious}
            testID="chapter-photo-stack-prev"
            variant="ghost"
          >
            {'‹'}
          </IconButton>
          <ThemedText
            accessibilityLabel={`Photo ${activeIndex + 1} of ${count}`}
            testID="chapter-photo-stack-counter"
            type="caption"
            style={[styles.counter, { color: muted }]}
          >
            {`${activeIndex + 1} of ${count}`}
          </ThemedText>
          <IconButton
            accessibilityLabel="Show next photo"
            label="Show next photo"
            onPress={goNext}
            testID="chapter-photo-stack-next"
            variant="ghost"
          >
            {'›'}
          </IconButton>
        </View>
      ) : null}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    width: '100%',
    maxWidth: 320,
    alignSelf: 'center',
    alignItems: 'center',
    gap: Spacing[12],
  },
  stage: {
    width: CHAPTER_PHOTO_STACK_WIDTH,
    maxWidth: '100%',
    height: CHAPTER_PHOTO_STACK_HEIGHT + 30,
    alignItems: 'center',
  },
  slot: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: CHAPTER_PHOTO_STACK_WIDTH,
    height: CHAPTER_PHOTO_STACK_HEIGHT,
  },
  card: {
    width: '100%',
    height: '100%',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.md,
    overflow: 'hidden',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  topPressable: {
    width: '100%',
    height: '100%',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[12],
    width: '100%',
  },
  counter: {
    minWidth: 64,
    textAlign: 'center',
  },
});
