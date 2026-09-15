import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { haptics } from '@/features/haptics/haptics';
import { useThemeColor } from '@/hooks/use-theme-color';

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  accessibilityHint?: string;
};

export type SegmentedControlProps<T extends string> = {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel?: string;
  hidden?: boolean;
};

/**
 * Compact two-or-more way switch for views that share one screen. Keeps a
 * single route (no nested screens) while showing one mode at a time.
 *
 * The selected pill is one sliding thumb (transform-only, ease-out-expo over
 * 220ms, interruptible), not a per-segment background swap — so switching
 * reads as one fluid glide. Reduced motion snaps instead of gliding.
 */
const TRACK_PADDING = Spacing[4];
const TRACK_GAP = Spacing[4];
const THUMB_DURATION_MS = 220;

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  hidden = false,
}: SegmentedControlProps<T>) {
  const border = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const surface2 = useThemeColor({}, 'surface2');
  const text = useThemeColor({}, 'textPrimary');
  const muted = useThemeColor({}, 'muted');
  const reduceMotion = useReducedMotion();
  const hiddenProps = hidden
    ? {
        accessible: false,
        accessibilityElementsHidden: true,
        importantForAccessibility: 'no-hide-descendants' as const,
        pointerEvents: 'none' as const,
      }
    : {};
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  // Track width measured on layout; the thumb is only rendered once known,
  // so it never flashes at zero width.
  const [trackWidth, setTrackWidth] = useState(0);
  const [thumbX] = useState(() => new Animated.Value(0));
  const mountedRef = useRef(false);
  const segmentWidth =
    trackWidth > 0
      ? (trackWidth - TRACK_PADDING * 2 - TRACK_GAP * (options.length - 1)) /
        options.length
      : 0;
  useEffect(() => {
    if (trackWidth <= 0) {
      return;
    }
    const target = selectedIndex * (segmentWidth + TRACK_GAP);
    // First measure snaps (no glide from 0 on mount); later changes glide.
    // Reduced motion always snaps.
    if (!mountedRef.current || reduceMotion) {
      mountedRef.current = true;
      thumbX.setValue(target);
      return;
    }
    Animated.timing(thumbX, {
      toValue: target,
      duration: THUMB_DURATION_MS,
      easing: Easing.out(Easing.exp),
      useNativeDriver: true,
    }).start();
  }, [selectedIndex, trackWidth, segmentWidth, thumbX, reduceMotion]);

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="tablist"
      onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
      style={[styles.track, { backgroundColor: surface2, borderColor: border }]}
      {...hiddenProps}
    >
      {segmentWidth > 0 ? (
        <Animated.View
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          testID="segment-thumb"
          style={[
            styles.thumb,
            {
              backgroundColor: surface,
              width: segmentWidth,
              transform: [{ translateX: thumbX }],
            },
          ]}
        />
      ) : null}
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            accessibilityLabel={option.label}
            accessibilityHint={option.accessibilityHint}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={option.value}
            onPress={() => {
              if (!selected) {
                haptics.select();
              }
              onChange(option.value);
            }}
            style={[
              styles.segment,
              // Fallback selection wash before the first measure (tests and
              // the first frame); once measured the sliding thumb owns it.
              segmentWidth <= 0 && selected
                ? { backgroundColor: surface }
                : null,
            ]}
          >
            <ThemedText
              type="bodyEmphasis"
              style={{ color: selected ? text : muted }}
            >
              {option.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TRACK_GAP,
    padding: TRACK_PADDING,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  thumb: {
    position: 'absolute',
    top: TRACK_PADDING,
    bottom: TRACK_PADDING,
    left: TRACK_PADDING,
    borderRadius: 999,
  },
  segment: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
});
