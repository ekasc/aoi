import { memo, useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { waveformBars } from '@/features/media/waveform';

export type AudioWaveformProps = {
  /** Stable seed for the shape (the note's key): same recording, same print. */
  seed: string;
  /** Bars to draw. Callers size this from their own width. */
  count: number;
  /** Height of the tallest bar, in points. */
  height: number;
  playing: boolean;
  /** 0..1 played portion; bars behind it read as played. */
  progress: number;
  playedColor: string;
  restColor: string;
  /** Bars breathe while playing unless the reader asked for less motion. */
  animate?: boolean;
};

/**
 * A voice note's sound print.
 *
 * While it plays, every bar breathes on its own phase, so the shape moves
 * with the recording; while it is paused the bars hold their resting
 * heights, so the print is legible as a shape. Bars behind the playhead
 * carry the accent colour, which is what makes progress readable at a
 * glance in the full-screen player.
 */
function WaveBar({
  base,
  index,
  phase,
  playing,
  played,
  height,
  playedColor,
  restColor,
  animate,
}: {
  base: number;
  index: number;
  phase: SharedValue<number>;
  playing: SharedValue<number>;
  played: boolean;
  height: number;
  playedColor: string;
  restColor: string;
  animate: boolean;
}) {
  // One phase offset per bar: the same wave, read at a different point.
  const offset = index * 0.62;

  const style = useAnimatedStyle(() => {
    const breath = playing.value
      ? 0.45 + 0.55 * Math.abs(Math.sin(phase.value * Math.PI * 2 + offset))
      : 1;
    return { transform: [{ scaleY: Math.max(0.08, breath) }] };
  });

  return (
    <Animated.View
      style={[
        styles.bar,
        {
          backgroundColor: played ? playedColor : restColor,
          height: Math.max(3, Math.round(base * height)),
          opacity: played ? 1 : 0.5,
        },
        animate ? style : null,
      ]}
    />
  );
}

function AudioWaveformComponent({
  seed,
  count,
  height,
  playing,
  progress,
  playedColor,
  restColor,
  animate = true,
}: AudioWaveformProps) {
  const reduceMotion = useReducedMotion();
  const bars = useMemo(() => waveformBars(seed, count), [count, seed]);
  // Two shared values drive every bar: position (one wave) and play state,
  // so the animation is one timeline rather than one per bar.
  const phase = useSharedValue(0);
  const playingValue = useSharedValue(playing ? 1 : 0);
  const shouldAnimate = animate && !reduceMotion;

  useEffect(() => {
    playingValue.value = withTiming(playing ? 1 : 0, { duration: 240 });
    if (playing && shouldAnimate) {
      phase.value = 0;
      phase.value = withRepeat(
        withTiming(1, { duration: 1600, easing: Easing.linear }),
        -1,
        false,
      );
      return;
    }
    // Paused: let the wave settle back to rest instead of freezing mid-beat.
    phase.value = withTiming(0, { duration: 240 });
  }, [phase, playing, playingValue, shouldAnimate]);

  const playedCount = Math.round(Math.min(1, Math.max(0, progress)) * bars.length);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.wave, { height }]}
    >
      {bars.map((base, index) => (
        <WaveBar
          animate={shouldAnimate}
          base={base}
          height={height}
          index={index}
          key={`${seed}:${index}`}
          played={index < playedCount}
          playedColor={playedColor}
          playing={playingValue}
          phase={phase}
          restColor={restColor}
        />
      ))}
    </View>
  );
}

export const AudioWaveform = memo(AudioWaveformComponent);

const styles = StyleSheet.create({
  wave: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 3,
  },
  bar: {
    borderRadius: 999,
    width: 3,
  },
});
