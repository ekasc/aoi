import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { useThemeColor } from '@/hooks/use-theme-color';

export type LiveWaveformProps = {
  /** Per-bar amplitude from the audio's own samples (see useLiveWaveform). */
  levels: SharedValue<number[]>;
  /** How many bars the levels hold. Passed in: reading it off a shared value
   *  during render would not re-render when it changed. */
  columns: number;
  height: number;
  barWidth?: number;
  /** 0..1 played portion. Bars behind it carry the accent colour. */
  progress: number;
};

/** Floor, so silence still reads as a line rather than nothing. */
const MIN_SCALE = 0.06;

/**
 * A bar of the waveform.
 *
 * One copy, one animated style per bar, reading the level on the UI thread:
 * the wave follows the audio without a React render per sample. The played
 * portion is a normal prop rather than a second clipped wave — a copy for
 * every bar is twice the drawing for the same picture, and animating a
 * clipping box means animating layout on every frame of a scrub.
 */
function WaveBar({
  index,
  levels,
  height,
  barWidth,
  color,
  opacity,
}: {
  index: number;
  levels: SharedValue<number[]>;
  height: number;
  barWidth: number;
  color: string;
  opacity: number;
}) {
  const style = useAnimatedStyle(() => ({
    transform: [{ scaleY: Math.max(MIN_SCALE, levels.value[index] ?? 0) }],
  }));

  return (
    <Animated.View
      style={[
        styles.bar,
        { backgroundColor: color, height, opacity, width: barWidth },
        // Transform only: a static opacity here would be overwritten.
        style,
      ]}
    />
  );
}

function LiveWaveformComponent({
  levels,
  columns,
  height,
  barWidth = 3,
  progress,
}: LiveWaveformProps) {
  const accent = useThemeColor({}, 'accent');
  const muted = useThemeColor({}, 'muted');
  const played = Math.round(Math.min(1, Math.max(0, progress)) * columns);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.wave, { height }]}
    >
      {Array.from({ length: columns }, (_, index) => (
        <WaveBar
          barWidth={barWidth}
          color={index < played ? accent : muted}
          height={height}
          index={index}
          key={index}
          levels={levels}
          opacity={index < played ? 1 : 0.45}
        />
      ))}
    </View>
  );
}

export const LiveWaveform = memo(LiveWaveformComponent);

const styles = StyleSheet.create({
  wave: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  bar: {
    borderRadius: 999,
  },
});
