import { Ionicons } from '@expo/vector-icons';
import { memo, useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { resolveStagedUri } from '@/features/composer/staged-uri';
import { useThemeColor } from '@/hooks/use-theme-color';

import { useAudioPlayer } from 'expo-audio';

export type AudioPlayerProps = {
  uri: string;
  /**
   * What this recording is, in words: a title, a date, whose voice. Falls
   * back to the generic phrase so the control is never unlabelled.
   */
  label?: string;
};

function formatSeconds(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0:00';
  }

  const totalSeconds = Math.round(value);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Minimal playback for voice traces: one button, a progress thread, time.
 */
function AudioPlayerComponent({ uri, label }: AudioPlayerProps) {
  const accent = useThemeColor({}, 'accent');
  const onAccent = useThemeColor({}, 'onAccent');
  const surface2 = useThemeColor({}, 'surface2');
  const muted = useThemeColor({}, 'muted');
  // Staged voice notes are Documents-relative paths until upload; remote
  // URLs pass through untouched.
  const player = useAudioPlayer(resolveStagedUri(uri));
  const [, setTick] = useState(0);

  // Light polling keeps progress honest without re-render storms.
  useEffect(() => {
    const interval = setInterval(() => setTick((value) => value + 1), 400);

    return () => clearInterval(interval);
  }, []);

  const isPlaying = player.playing;
  const duration = player.duration ?? 0;
  const currentTime = player.currentTime ?? 0;
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  // Unlabelled keeps the original wording; a labelled player names what it
  // holds, so a row of recordings is never a row of identical buttons.
  const playLabel = label
    ? `${isPlaying ? 'Pause' : 'Play'} voice note: ${label}`
    : `${isPlaying ? 'Pause' : 'Play'} voice note`;

  const handleToggle = useCallback(() => {
    if (player.playing) {
      player.pause();
    } else {
      player.play();
    }
    setTick((value) => value + 1);
  }, [player]);

  return (
    <View
      accessible
      accessibilityLabel={label ? `Voice note: ${label}` : 'Voice note player'}
      style={[styles.row, { backgroundColor: surface2 }]}
    >
      <Pressable
        accessibilityLabel={playLabel}
        accessibilityRole="button"
        onPress={handleToggle}
        style={[styles.playButton, { backgroundColor: accent }]}
      >
        <Ionicons color={onAccent} name={isPlaying ? 'pause' : 'play'} size={16} />
      </Pressable>
      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            { backgroundColor: accent, width: `${progress * 100}%` },
          ]}
        />
      </View>
      <ThemedText
        type="meta"
        style={{ color: muted, fontVariant: ['tabular-nums'] }}
        suppressHighlighting
      >
        {formatSeconds(isPlaying ? currentTime : duration)}
      </ThemedText>
    </View>
  );
}

export const AudioPlayer = memo(AudioPlayerComponent);

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    borderRadius: 22,
    flexDirection: 'row',
    gap: Spacing[12],
    paddingHorizontal: Spacing[12],
    paddingVertical: Spacing[8],
  },
  playButton: {
    alignItems: 'center',
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  progressTrack: {
    backgroundColor: 'rgba(128, 128, 128, 0.25)',
    borderRadius: 2,
    flex: 1,
    height: 4,
    overflow: 'hidden',
  },
  progressFill: {
    borderRadius: 2,
    height: '100%',
  },
});
