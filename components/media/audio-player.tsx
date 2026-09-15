import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { formatPlaybackSeconds, useVoicePlayback } from '@/hooks/use-voice-playback';
import { useThemeColor } from '@/hooks/use-theme-color';

export type AudioPlayerProps = {
  uri: string;
  /**
   * What this recording is, in words: a title, a date, whose voice. Falls
   * back to the generic phrase so the control is never unlabelled.
   */
  label?: string;
};

/**
 * Minimal playback for voice traces: one button, a progress thread, time.
 */
function AudioPlayerComponent({ uri, label }: AudioPlayerProps) {
  const accent = useThemeColor({}, 'accent');
  const onAccent = useThemeColor({}, 'onAccent');
  const surface2 = useThemeColor({}, 'surface2');
  const muted = useThemeColor({}, 'muted');
  const { isPlaying, progress, seconds, toggle } = useVoicePlayback(uri);

  // Unlabelled keeps the original wording; a labelled player names what it
  // holds, so a row of recordings is never a row of identical buttons.
  const playLabel = label
    ? `${isPlaying ? 'Pause' : 'Play'} voice note: ${label}`
    : `${isPlaying ? 'Pause' : 'Play'} voice note`;

  return (
    <View
      accessible
      accessibilityLabel={label ? `Voice note: ${label}` : 'Voice note player'}
      style={[styles.row, { backgroundColor: surface2 }]}
    >
      <Pressable
        accessibilityLabel={playLabel}
        accessibilityRole="button"
        onPress={toggle}
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
        {formatPlaybackSeconds(seconds)}
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
