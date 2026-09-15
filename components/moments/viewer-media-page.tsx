import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { LiveWaveform } from '@/components/media/live-waveform';
import { VideoSurface } from '@/components/media/video-player';
import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing } from '@/constants/theme';
import { resolveStagedUri } from '@/features/composer/staged-uri';
import { formatPlaybackSeconds, useVoicePlayback } from '@/hooks/use-voice-playback';
import { useLiveWaveform, waveformColumnCount } from '@/hooks/use-live-waveform';
import { useThemeColor } from '@/hooks/use-theme-color';

/**
 * The two full-screen pages the Gallery's album adds to the viewer: a clip
 * and a voice note. They are why the album can page through everything a
 * month holds instead of only its photos.
 *
 * Both only come alive on the page the reader is on. A pager mounts its
 * neighbours, and a clip or a recording that starts on a page nobody is
 * looking at is the worst kind of bug: sound from nowhere. Off-page, each of
 * these is a still frame of itself — and neither starts by itself even on the
 * page the reader is on. Looking is not asking to listen.
 */

const WAVE_HEIGHT = 128;
const WAVE_BAR_WIDTH = 3;
const WAVE_GUTTERS = Spacing[16] * 2;

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
  const textPrimary = useThemeColor({}, 'textPrimary');
  const [started, setStarted] = useState(false);
  const handlePlay = useCallback(() => setStarted(true), []);
  const playing = active && started;

  const still = posterUri ? (
    <Image
      accessible={false}
      contentFit="contain"
      source={{ uri: resolveStagedUri(posterUri) }}
      style={styles.still}
    />
  ) : (
    <View style={[styles.still, { backgroundColor: backgroundSubtle }]} />
  );

  if (playing) {
    return (
      <View style={[styles.page, { width, height }]}>
        <VideoSurface contentFit="contain" label={label} uri={uri} />
      </View>
    );
  }

  return (
    <View style={[styles.page, { width, height }]}>
      {active ? (
        // Only the page the reader is on offers the clip: an off-page still
        // is scenery, and a control on it would be a button nobody can press.
        <Pressable
          accessibilityHint="Plays this clip"
          accessibilityLabel={`Play video: ${label}`}
          accessibilityRole="button"
          onPress={handlePlay}
          style={styles.stillPress}
        >
          {still}
          <View pointerEvents="none" style={styles.playOverlay}>
            <View style={styles.playButton}>
              <Ionicons color={textPrimary} name="play" size={30} style={styles.playGlyph} />
            </View>
          </View>
        </Pressable>
      ) : (
        <View style={styles.stillPress}>{still}</View>
      )}
    </View>
  );
}

/** The voice page off the reader's eye: a flat line, and no player at all. */
function RestingVoicePage({ label }: { label: string }) {
  const muted = useThemeColor({}, 'muted');
  const textPrimary = useThemeColor({}, 'textPrimary');

  return (
    <View style={styles.voiceBody}>
      <ThemedText type="title" style={{ color: textPrimary }}>
        Voice note
      </ThemedText>
      <ThemedText type="caption" style={{ color: muted }}>
        {label}
      </ThemedText>
    </View>
  );
}

/**
 * The page the reader is on. The waveform here is measured from the audio's
 * own samples as it plays (see useLiveWaveform), so it is the note's shape
 * rather than a shape chosen for it — and it spans the width, because a
 * waveform that stops a third of the way short reads as a broken one.
 */
function PlayingVoicePage({ label, uri }: { label: string; uri: string }) {
  const accent = useThemeColor({}, 'accent');
  const muted = useThemeColor({}, 'muted');
  const onAccent = useThemeColor({}, 'onAccent');
  const textPrimary = useThemeColor({}, 'textPrimary');
  const { player, isPlaying, progress, seconds, toggle } = useVoicePlayback(uri);
  const started = useRef(false);
  // The wave is only built once the width is known: its bar count has to be
  // fixed before the levels array is created, or the bars and the data
  // disagree about how long the note is.
  const [waveWidth, setWaveWidth] = useState(0);
  const columns = waveformColumnCount(Math.max(waveWidth - WAVE_GUTTERS, 120), WAVE_BAR_WIDTH);
  const { levels, supported } = useLiveWaveform(player, columns);
  const handleWaveLayout = useCallback((event: LayoutChangeEvent) => {
    setWaveWidth(event.nativeEvent.layout.width);
  }, []);

  // A full-screen recording that lands silent looks broken, so it starts
  // itself once. The control below still owns play and pause.
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
      <ThemedText type="title" style={{ color: textPrimary }}>
        Voice note
      </ThemedText>
      <ThemedText type="caption" style={{ color: muted }}>
        {label}
      </ThemedText>
      <View onLayout={handleWaveLayout} style={styles.waveWrap}>
        {waveWidth > 0 ? (
          <LiveWaveform
            barWidth={WAVE_BAR_WIDTH}
            columns={columns}
            height={WAVE_HEIGHT}
            levels={levels}
            progress={progress}
          />
        ) : null}
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
      <ThemedText type="caption" style={{ color: muted, fontVariant: ['tabular-nums'] }}>
        {formatPlaybackSeconds(seconds)}
        {supported ? '' : ' · waveform unavailable here'}
      </ThemedText>
    </View>
  );
}

export type ViewerVoicePageProps = {
  uri: string;
  label: string;
  /** Kept for callers that seed a shape; the live waveform ignores it. */
  seed?: string;
  width: number;
  height: number;
  active: boolean;
};

export function ViewerVoicePage({ uri, label, width, height, active }: ViewerVoicePageProps) {
  return (
    <View style={[styles.page, { width, height }]}>
      {active ? (
        <PlayingVoicePage label={label} uri={uri} />
      ) : (
        <RestingVoicePage label={label} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  stillPress: {
    height: '100%',
    width: '100%',
  },
  still: {
    height: '100%',
    width: '100%',
  },
  playOverlay: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  playButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.42)',
    borderRadius: Radii.pill,
    height: 68,
    justifyContent: 'center',
    width: 68,
  },
  playGlyph: {
    marginLeft: 4,
  },
  voiceBody: {
    alignItems: 'center',
    gap: Spacing[12],
    paddingHorizontal: Spacing[16],
    width: '100%',
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
