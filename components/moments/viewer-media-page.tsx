import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { LiveWaveform } from '@/components/media/live-waveform';
import { VideoSurface } from '@/components/media/video-player';
import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing } from '@/constants/theme';
import { resolveStagedUri } from '@/features/composer/staged-uri';
import {
  SCRUB_READOUT_INTERVAL_MS,
  SCRUB_SEEK_INTERVAL_MS,
  scrubFractionForOffset,
  scrubSecondsForOffset,
} from '@/features/moments/audio-scrub';
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

/** 0..1 of a recording, for the bars behind the playhead. */
function playheadFraction(seconds: number, duration: number): number {
  if (!(duration > 0)) {
    return 0;
  }
  return Math.min(1, Math.max(0, seconds / duration));
}
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
 *
 * The wave is also the scrubbing surface: tap it to jump, drag along it to
 * go back and forth. Horizontal drags on the band scrub and vertical drags
 * still belong to the viewer's dismiss, so neither gesture has to be guessed
 * at, and the wave never has to claim a touch the reader meant for the page.
 */
function PlayingVoicePage({ label, uri }: { label: string; uri: string }) {
  const accent = useThemeColor({}, 'accent');
  const muted = useThemeColor({}, 'muted');
  const onAccent = useThemeColor({}, 'onAccent');
  const textPrimary = useThemeColor({}, 'textPrimary');
  const playback = useVoicePlayback(uri);
  const { isPlaying, progress, duration, currentTime, toggle, seek, setPlaying } = playback;
  const started = useRef(false);
  // The wave is only built once the width is known: its bar count has to be
  // fixed before the levels array is created, or the bars and the data
  // disagree about how long the note is.
  const [waveWidth, setWaveWidth] = useState(0);
  const columns = waveformColumnCount(Math.max(waveWidth - WAVE_GUTTERS, 120), WAVE_BAR_WIDTH);
  const { levels, supported } = useLiveWaveform(playback.player, columns);
  // The playhead is a shared value: it follows the finger on the UI thread,
  // and the whole note is drawn twice under it rather than recoloured per bar.
  const playhead = useSharedValue(0);
  const scrubbing = useSharedValue(false);
  const wasPlaying = useRef(false);
  const lastReadout = useRef(0);
  const lastSeek = useRef(0);
  const live = useRef(true);
  const [scrubSeconds, setScrubSeconds] = useState<number | null>(null);

  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );

  useEffect(() => {
    if (!scrubbing.value) {
      playhead.value = progress;
    }
  }, [playhead, progress, scrubbing]);

  const publishScrubSeconds = useCallback((value: number) => {
    const now = Date.now();
    if (now - lastReadout.current < SCRUB_READOUT_INTERVAL_MS) {
      return;
    }
    lastReadout.current = now;
    setScrubSeconds(value);
  }, []);

  // A scrub pauses the note so the finger is not fighting playback, and hands
  // the transport back the way it found it.
  const beginScrub = useCallback(() => {
    wasPlaying.current = isPlaying;
    setPlaying(false);
  }, [isPlaying, setPlaying]);

  const finishScrub = useCallback(
    (resume: boolean) => {
      setScrubSeconds(null);
      if (resume && wasPlaying.current) {
        setPlaying(true);
      }
    },
    [setPlaying],
  );

  /**
   * One finger position, applied. The readout is throttled to what an eye
   * reads, and the seek to what the native player can absorb: a finger fires
   * updates at screen rate, and a native seek behind every one of them is
   * what makes a scrub stutter. `force` is the release, which always lands.
   */
  const scrubTo = useCallback(
    (offsetX: number, force: boolean) => {
      if (!live.current) {
        return;
      }
      const secondsAtFinger = scrubSecondsForOffset(offsetX, waveWidth, duration);
      const now = Date.now();
      if (force || now - lastSeek.current >= SCRUB_SEEK_INTERVAL_MS) {
        lastSeek.current = now;
        seek(secondsAtFinger);
      }
      publishScrubSeconds(secondsAtFinger);
    },
    [duration, publishScrubSeconds, seek, waveWidth],
  );

  const scrubGesture = useMemo(() => {
    const drag = Gesture.Pan()
      // Horizontal along the band scrubs; a vertical drag is the viewer's
      // dismiss and passes straight through.
      .activeOffsetX([-6, 6])
      .failOffsetY([-18, 18])
      .onStart(() => {
        scrubbing.value = true;
        runOnJS(beginScrub)();
      })
      .onUpdate((event) => {
        playhead.value = scrubFractionForOffset(event.x, waveWidth);
        runOnJS(scrubTo)(event.x, false);
      })
      .onFinalize((_, success) => {
        scrubbing.value = false;
        runOnJS(finishScrub)(success);
      });

    const tap = Gesture.Tap()
      .onEnd((event, success) => {
        if (!success) {
          return;
        }
        playhead.value = scrubFractionForOffset(event.x, waveWidth);
        // A tap is one deliberate jump: it always lands.
        runOnJS(scrubTo)(event.x, true);
      });

    // Whichever the hand meant first wins: a drag on movement, a tap on lift.
    return Gesture.Race(drag, tap);
  }, [beginScrub, finishScrub, playhead, scrubTo, scrubbing, waveWidth]);

  const handleWaveLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const width = event.nativeEvent.layout.width;
      setWaveWidth(width);
    },
    [],
  );

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

  const playheadStyle = useAnimatedStyle(() => ({
    opacity: waveWidth > 0 ? 1 : 0,
    transform: [{ translateX: playhead.value * waveWidth }],
  }));

  const readout = scrubSeconds ?? currentTime;
  const filled = scrubSeconds === null ? progress : playheadFraction(scrubSeconds, duration);

  return (
    <View style={styles.voiceBody}>
      <ThemedText type="title" style={{ color: textPrimary }}>
        Voice note
      </ThemedText>
      <ThemedText type="caption" style={{ color: muted }}>
        {label}
      </ThemedText>
      <GestureDetector gesture={scrubGesture}>
        <View onLayout={handleWaveLayout} style={styles.waveWrap}>
          {waveWidth > 0 ? (
            <>
              <LiveWaveform
                barWidth={WAVE_BAR_WIDTH}
                columns={columns}
                height={WAVE_HEIGHT}
                levels={levels}
                progress={filled}
              />
              <Animated.View
                pointerEvents="none"
                style={[styles.playhead, { backgroundColor: accent }, playheadStyle]}
              />
            </>
          ) : null}
        </View>
      </GestureDetector>
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
        {formatPlaybackSeconds(readout)}
        {duration > 0 ? ` / ${formatPlaybackSeconds(duration)}` : ''}
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
    height: WAVE_HEIGHT,
    justifyContent: 'center',
    marginVertical: Spacing[16],
    width: '100%',
  },
  playhead: {
    bottom: 0,
    position: 'absolute',
    top: 0,
    width: 2,
  },
  voiceButton: {
    alignItems: 'center',
    borderRadius: Radii.pill,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
});
