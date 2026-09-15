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
  /**
   * Bars behind the playhead carry the accent colour, so the same drawing
   * says both what the sound is doing and how far in it is.
   */
  progress: number;
  height: number;
  barWidth?: number;
};

/** Floor and ceiling, so silence still reads as a line rather than nothing. */
const MIN_SCALE = 0.06;

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
  playedColor,
  restColor,
  played,
}: {
  index: number;
  levels: SharedValue<number[]>;
  height: number;
  barWidth: number;
  playedColor: string;
  restColor: string;
  played: boolean;
}) {
  const style = useAnimatedStyle(() => ({
    transform: [{ scaleY: Math.max(MIN_SCALE, levels.value[index] ?? 0) }],
  }));

  return (
    <Animated.View
      style={[
        styles.bar,
        {
          backgroundColor: played ? playedColor : restColor,
          height,
          opacity: played ? 1 : 0.4,
          width: barWidth,
        },
        style,
      ]}
    />
  );
}

function LiveWaveformComponent({
  levels,
  columns,
  progress,
  height,
  barWidth = 3,
}: LiveWaveformProps) {
  const accent = useThemeColor({}, 'accent');
  const muted = useThemeColor({}, 'muted');
  const played = Math.round(Math.min(1, Math.max(0, progress)) * columns);

  return (
    <View style={[styles.wave, { height }]}>
      {Array.from({ length: columns }, (_, index) => (
        <WaveBar
          barWidth={barWidth}
          height={height}
          index={index}
          key={index}
          levels={levels}
          played={index < played}
          playedColor={accent}
          restColor={muted}
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
