import Ionicons from '@expo/vector-icons/Ionicons';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { useSkyEntry } from '@/components/home/sky-entry-provider';
import {
  ANDROID_TAB_BAR_HEIGHT,
  ANDROID_TAB_BAR_SIDE_MARGIN,
} from '@/components/home/compact-sky-geometry';
import { Spacing } from '@/constants/theme';
import { haptics } from '@/features/haptics/haptics';
import { useAoiTheme } from '@/features/theme/theme-context';

type TabMeta = {
  label: string;
  outline: keyof typeof Ionicons.glyphMap;
  filled: keyof typeof Ionicons.glyphMap;
};

const TICK_WIDTH = 18;

/**
 * Motion, tuned once.
 *
 * Damped past the point of visible overshoot: this is a page turning between
 * four places, not a toy. Long enough to read as travel (~260ms), short enough
 * that a second tap never waits on the first.
 */
const TRAVEL = { damping: 22, stiffness: 210, mass: 0.7 };
/** The icon lift is smaller and settles faster than the tick's travel. */
const LIFT = { damping: 20, stiffness: 260, mass: 0.5 };

/**
 * The four places, as the app draws them.
 *
 * iOS keeps the system tab bar: UITabBar with liquid glass is better than
 * anything hand-drawn and costs nothing. Android's Material bar is not, so
 * Android gets the app's own footer — and the difference between a footer and
 * a good footer is where the eye goes when you switch: one accent mark that
 * travels, one icon that lifts, one label that gains weight. Nothing else
 * moves.
 */
const TABS: Record<string, TabMeta> = {
  '(memories)': { label: 'Memories', outline: 'book-outline', filled: 'book' },
  together: { label: 'Us', outline: 'sparkles-outline', filled: 'sparkles' },
  plans: { label: 'Plans', outline: 'calendar-outline', filled: 'calendar' },
  ours: { label: 'Lists', outline: 'grid-outline', filled: 'grid' },
};

export function AoiTabBar({ state, insets, navigateToTab }: BottomTabBarProps) {
  const { colors } = useAoiTheme();
  const { entry } = useSkyEntry();
  const reduceMotion = useReducedMotion();
  const [rowWidth, setRowWidth] = useState(0);

  const routes = state.routes.filter((route) => TABS[route.name]);
  const activeIndex = Math.max(
    0,
    routes.findIndex((route) => route.key === state.routes[state.index]?.key)
  );
  // The row is padded, so the items do not start at the bar's edge. The mark
  // is positioned against the bar, so that padding has to be added back in.
  const sidePad = ANDROID_TAB_BAR_SIDE_MARGIN / 2;
  const cell =
    rowWidth > 0 ? (rowWidth - sidePad * 2) / Math.max(1, routes.length) : 0;

  // One shared value for the mark's position, so a tap reads as the tick
  // leaving one place and arriving at another rather than two ticks blinking.
  const position = useSharedValue(activeIndex);
  useEffect(() => {
    position.value = reduceMotion
      ? activeIndex
      : withSpring(activeIndex, TRAVEL);
  }, [activeIndex, position, reduceMotion]);

  const tickStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX:
          sidePad + position.value * cell + cell / 2 - TICK_WIDTH / 2,
      },
    ],
  }));

  // The arrival hides the bar: the sky is the whole screen while it lands.
  if (entry !== null && entry.kind !== 'fading') {
    return null;
  }

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.host,
        {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          paddingBottom: insets.bottom,
        },
      ]}
    >
      <Animated.View
        accessible={false}
        aria-hidden
        pointerEvents="none"
        style={[styles.tick, { backgroundColor: colors.accentInk }, tickStyle]}
      />
      <View
        onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}
        style={styles.row}
      >
        {routes.map((route, index) => (
          <AoiTab
            key={route.key}
            active={index === activeIndex}
            colors={colors}
            meta={TABS[route.name]}
            onPress={() => {
              if (index === activeIndex) {
                return;
              }
              haptics.select();
              navigateToTab(route.key);
            }}
            reduceMotion={reduceMotion}
          />
        ))}
      </View>
    </View>
  );
}

type Palette = ReturnType<typeof useAoiTheme>['colors'];

function AoiTab({
  active,
  colors,
  meta,
  onPress,
  reduceMotion,
}: {
  active: boolean;
  colors: Palette;
  meta: TabMeta;
  onPress: () => void;
  reduceMotion: boolean;
}) {
  // 0 = resting, 1 = current. Every visual difference between the two states
  // is a read of this one number, so they can never disagree mid-flight.
  const current = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    current.value = reduceMotion
      ? active
        ? 1
        : 0
      : withSpring(active ? 1 : 0, LIFT);
  }, [active, current, reduceMotion]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -2 * current.value },
      { scale: 1 + 0.06 * current.value },
    ],
  }));
  const outlineStyle = useAnimatedStyle(() => ({ opacity: 1 - current.value }));
  const filledStyle = useAnimatedStyle(() => ({ opacity: current.value }));
  const quietLabelStyle = useAnimatedStyle(() => ({ opacity: 1 - current.value }));
  const loudLabelStyle = useAnimatedStyle(() => ({ opacity: current.value }));

  return (
    <Pressable
      accessibilityLabel={meta.label}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={styles.item}
    >
      {({ pressed }) => (
        <View style={[styles.itemInner, pressed ? styles.pressed : undefined]}>
          <Animated.View style={[styles.icon, iconStyle]}>
            <Animated.View style={[styles.iconLayer, outlineStyle]}>
              <Ionicons
                accessible={false}
                aria-hidden
                color={colors.textMuted}
                name={meta.outline}
                size={21}
              />
            </Animated.View>
            <Animated.View style={[styles.iconLayer, filledStyle]}>
              <Ionicons
                accessible={false}
                aria-hidden
                color={colors.accentInk}
                name={meta.filled}
                size={21}
              />
            </Animated.View>
          </Animated.View>

          {/* Both labels are always laid out, one over the other: the weight
              change is a crossfade, so the row never reflows on selection. */}
          <View style={styles.labelBox}>
            <Animated.View style={quietLabelStyle}>
              <ThemedText
                numberOfLines={1}
                style={[styles.label, styles.labelQuiet, { color: colors.textMuted }]}
              >
                {meta.label}
              </ThemedText>
            </Animated.View>
            <Animated.View style={[styles.iconLayer, loudLabelStyle]}>
              <ThemedText
                numberOfLines={1}
                style={[styles.label, styles.labelLoud, { color: colors.accentInk }]}
              >
                {meta.label}
              </ThemedText>
            </Animated.View>
          </View>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  /** Docked, not floating: a footer belongs to the page, not to the content. */
  host: {
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  /** One mark for the whole bar; it travels rather than multiplying. */
  tick: {
    borderRadius: 1,
    height: 2,
    position: 'absolute',
    top: 6,
    width: TICK_WIDTH,
  },
  row: {
    flexDirection: 'row',
    height: ANDROID_TAB_BAR_HEIGHT,
    paddingHorizontal: ANDROID_TAB_BAR_SIDE_MARGIN / 2,
  },
  item: {
    flex: 1,
    justifyContent: 'center',
  },
  itemInner: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    paddingTop: 14,
  },
  pressed: {
    opacity: 0.6,
  },
  icon: {
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  iconLayer: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  labelBox: {
    alignItems: 'center',
    height: 16,
    justifyContent: 'center',
    marginTop: Spacing[4],
    width: '100%',
  },
  label: {
    fontSize: 11,
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  labelQuiet: {
    fontWeight: '500',
  },
  labelLoud: {
    fontWeight: '700',
  },
});
