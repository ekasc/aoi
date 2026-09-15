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
  /**
   * Explicit width, for the copy that is clipped by the playhead: a wave that
   * is laid out inside a narrowing box would compress its bars instead of
   * being cut off at the playhead.
   */
  width?: number;
  /**
   * Which side of the playhead this copy draws. The player draws the wave
   * twice — the whole note in the resting colour, and the played part in the
   * accent, clipped to the playhead — so the played region follows a scrub on
   * the UI thread instead of needing a colour animation per bar.
   */
  tone: 'rest' | 'played';
};

/** Floor, so silence still reads as a line rather than nothing. */
const MIN_SCALE = 0.06;
/** Resting bars are quieter than the played ones, which is the playhead cue. */
const REST_OPACITY = 0.45;

/**
 * The waveform of a voice note, drawn from its samples.
 *
 * Bars scale from the centre line, the way a symmetric waveform reads, and
 * each one is driven on the UI thread straight from the shared levels — no
 * React render per sample, which at audio rates would only show a fraction
 * of the sound.
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
  width,
  tone,
}: LiveWaveformProps) {
  const accent = useThemeColor({}, 'accent');
  const muted = useThemeColor({}, 'muted');

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.wave, { height, width: width ?? '100%' }]}
    >
      {Array.from({ length: columns }, (_, index) => (
        <WaveBar
          barWidth={barWidth}
          color={tone === 'played' ? accent : muted}
          height={height}
          index={index}
          key={index}
          levels={levels}
          opacity={tone === 'played' ? 1 : REST_OPACITY}
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
