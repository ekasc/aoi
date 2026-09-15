import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AudioWaveform } from '@/components/media/audio-waveform';
import { VideoSurface } from '@/components/media/video-player';
import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing } from '@/constants/theme';
import { resolveStagedUri } from '@/features/composer/staged-uri';
import { formatPlaybackSeconds, useVoicePlayback } from '@/hooks/use-voice-playback';
import { useThemeColor } from '@/hooks/use-theme-color';

/**
 * The two full-screen pages the Gallery's album adds to the viewer: a clip
 * and a voice note. They are why the album can page through everything a
 * month holds instead of only its photos.
 *
 * Both only come alive on the page the reader is actually on. A pager mounts
 * its neighbours, and a video or a recording that starts on a page nobody is
 * looking at is the worst kind of bug: sound from nowhere. Off-page, each of
 * these is a still frame of itself.
 */

const WAVE_BARS = 34;
const WAVE_HEIGHT = 96;

export type ViewerVideoPageProps = {
  uri: string;
  /** The clip's still; the page shows it if the clip cannot start. */
  posterUri?: string | null;
  label: string;
  width: number;
  height: number;
  /** True for the page the reader is on. Only then does the clip exist. */
  active: boolean;
};

export function ViewerVideoPage({
  uri,
  posterUri,
  label,
  width,
  height,
  active,
}: ViewerVideoPageProps) {
  const backgroundSubtle = useThemeColor({}, 'backgroundSubtle');

  return (
    <View style={[styles.page, { width, height }]}>
      {active ? (
        <VideoSurface contentFit="contain" label={label} uri={uri} />
      ) : posterUri ? (
        <Image
          accessible={false}
          contentFit="contain"
          source={{ uri: resolveStagedUri(posterUri) }}
          style={styles.still}
        />
      ) : (
        <View style={[styles.still, { backgroundColor: backgroundSubtle }]} />
      )}
    </View>
  );
}

/** The voice page while it is off-screen: the print, without the playback. */
function RestingVoicePage({ seed, label }: { seed: string; label: string }) {
  const muted = useThemeColor({}, 'muted');
  const textPrimary = useThemeColor({}, 'textPrimary');
  const accent = useThemeColor({}, 'accent');

  return (
    <View style={styles.voiceBody}>
      <Ionicons color={muted} name="mic-outline" size={22} />
      <ThemedText type="title" style={[styles.voiceTitle, { color: textPrimary }]}>
        Voice note
      </ThemedText>
      <ThemedText type="caption" style={{ color: muted }}>
        {label}
      </ThemedText>
      <View style={styles.waveWrap}>
        <AudioWaveform
          animate={false}
          count={WAVE_BARS}
          height={WAVE_HEIGHT}
          playedColor={accent}
          playing={false}
          progress={0}
          restColor={muted}
          seed={seed}
        />
      </View>
    </View>
  );
}

/** The page the reader is on: it plays, and its wave moves with the note. */
function PlayingVoicePage({ seed, label, uri }: { seed: string; label: string; uri: string }) {
  const accent = useThemeColor({}, 'accent');
  const muted = useThemeColor({}, 'muted');
  const onAccent = useThemeColor({}, 'onAccent');
  const textPrimary = useThemeColor({}, 'textPrimary');
  const { isPlaying, progress, seconds, toggle } = useVoicePlayback(uri);
  const started = useRef(false);

  // A full-screen recording that lands silent would look broken, so it
  // starts itself once. The control below still owns play and pause.
  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;
    toggle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.voiceBody}>
      <ThemedText type="title" style={[styles.voiceTitle, { color: textPrimary }]}>
        Voice note
      </ThemedText>
      <ThemedText type="caption" style={{ color: muted }}>
        {label}
      </ThemedText>
      <View style={styles.waveWrap}>
        <AudioWaveform
          count={WAVE_BARS}
          height={WAVE_HEIGHT}
          playedColor={accent}
          playing={isPlaying}
          progress={progress}
          restColor={muted}
          seed={seed}
        />
      </View>
      <Pressable
        accessibilityHint="Plays and pauses this voice note"
        accessibilityLabel={`${isPlaying ? 'Pause' : 'Play'} voice note: ${label}`}
        accessibilityRole="button"
        accessibilityState={{ busy: isPlaying }}
        onPress={toggle}
        style={[styles.voiceButton, { backgroundColor: accent }]}
      >
        <Ionicons color={onAccent} name={isPlaying ? 'pause' : 'play'} size={24} />
      </Pressable>
      <ThemedText
        type="caption"
        style={{ color: muted, fontVariant: ['tabular-nums'] }}
      >
        {formatPlaybackSeconds(seconds)}
      </ThemedText>
    </View>
  );
}

export type ViewerVoicePageProps = {
  uri: string;
  label: string;
  /** Stable shape seed, so the page and the wall tile draw the same print. */
  seed: string;
  width: number;
  height: number;
  active: boolean;
};

export function ViewerVoicePage({ uri, label, seed, width, height, active }: ViewerVoicePageProps) {
  return (
    <View style={[styles.page, { width, height }]}>
      {active ? (
        <PlayingVoicePage label={label} seed={seed} uri={uri} />
      ) : (
        <RestingVoicePage label={label} seed={seed} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  still: {
    height: '100%',
    width: '100%',
  },
  voiceBody: {
    alignItems: 'center',
    gap: Spacing[12],
    paddingHorizontal: Spacing[32],
    width: '100%',
  },
  voiceTitle: {
    textAlign: 'center',
  },
  waveWrap: {
    paddingVertical: Spacing[16],
    width: '100%',
  },
  voiceButton: {
    alignItems: 'center',
    borderRadius: Radii.pill,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
});
