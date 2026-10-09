import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import {
  LiveWaveform,
  WAVE_BAR_GAP,
  WAVE_BAR_WIDTH,
} from '@/components/media/live-waveform';
import { MorphShell } from '@/components/moments/morph-shell';
import {
  shellRadiusFor,
  type PhotoOrigin,
  type ViewerHome,
  type ViewerMorph,
} from '@/components/moments/zoomable-photo';
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

export type ViewerVideoPageProps = {
  uri: string;
  /** The clip's still; the page shows it if the clip cannot start. */
  posterUri?: string | null;
  label: string;
  width: number;
  height: number;
  /** True for the page the reader is on. Only then does the clip exist. */
  active: boolean;
  morph: ViewerMorph;
  home: ViewerHome;
  /** The tile's box, in plain numbers, for the shell's layout. */
  origin?: PhotoOrigin;
};

export function ViewerVideoPage({
  uri,
  posterUri,
  label,
  width,
  height,
  active,
  morph,
  home,
  origin,
}: ViewerVideoPageProps) {
  const backgroundSubtle = useThemeColor({}, 'backgroundSubtle');
  const textPrimary = useThemeColor({}, 'textPrimary');
  const [started, setStarted] = useState(false);
  const [stillSize, setStillSize] = useState<{ width: number; height: number } | null>(null);
  const handlePlay = useCallback(() => setStarted(true), []);
  const handleStillLoad = useCallback((event: { source?: { width?: number; height?: number } }) => {
    const sourceWidth = event.source?.width ?? 0;
    const sourceHeight = event.source?.height ?? 0;
    if (sourceWidth > 0 && sourceHeight > 0) {
      setStillSize({ height: sourceHeight, width: sourceWidth });
    }
  }, []);
  const playing = active && started;

  const still = posterUri ? (
    <Image
      accessible={false}
      contentFit="contain"
      onLoad={handleStillLoad}
      source={{ uri: resolveStagedUri(posterUri) }}
      style={styles.still}
    />
  ) : (
    <View style={[styles.still, { backgroundColor: backgroundSubtle }]} />
  );

  return (
    <View style={[styles.page, { height, width }]}>
      <MorphShell
        frame={{ height, width }}
        home={home}
        morph={morph}
        sourceHeight={stillSize?.height ?? 0}
        sourceWidth={stillSize?.width ?? 0}
        tile={{
          height: origin?.height ?? 0,
          radius: origin?.radius ?? 0,
          width: origin?.width ?? 0,
        }}
      >
        {playing ? (
          <VideoSurface contentFit="contain" label={label} uri={uri} />
        ) : active ? (
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
      </MorphShell>
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
 * Nothing plays until the reader asks. A note opened from the wall arrives
 * paused, with a flat line where its sound will be, and the transport below
 * starts it. The wave holds its last shape when paused, so a note that has
 * been played reads as itself rather than resetting to a line.
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
  // The wave is only built once the width is known: its bar count has to be
  // fixed before the levels array is created, or the bars and the data
  // disagree about how long the note is.
  const [waveWidth, setWaveWidth] = useState(0);
  const columns = waveformColumnCount(
    Math.max(waveWidth, 120),
    WAVE_BAR_WIDTH,
    WAVE_BAR_GAP,
  );
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
    if (!scrubbing.get()) {
      playhead.set(progress);
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
    // These callbacks hand JS functions to runOnJS. React Compiler reads that as
    // a ref-reading closure passed to a function during render, but runOnJS only
    // stores the function and never invokes it while rendering, so no ref is read
    // during render. A reduced reproduction confirms the trigger is the real
    // useRef these callbacks close over, not the shared values: the identical
    // closure with no useRef in reach lints clean.
    /* eslint-disable react-hooks/refs -- runOnJS defers these callbacks. */
    const drag = Gesture.Pan()
      // Horizontal along the band scrubs; a vertical drag is the viewer's
      // dismiss and passes straight through.
      .activeOffsetX([-6, 6])
      .failOffsetY([-18, 18])
      .onStart(() => {
        'worklet';
        scrubbing.set(true);
        runOnJS(beginScrub)();
      })
      .onUpdate((event) => {
        'worklet';
        playhead.set(scrubFractionForOffset(event.x, waveWidth));
        runOnJS(scrubTo)(event.x, false);
      })
      .onFinalize((_, success) => {
        'worklet';
        scrubbing.set(false);
        runOnJS(finishScrub)(success);
      });

    const tap = Gesture.Tap()
      .onEnd((event, success) => {
        'worklet';
        if (!success) {
          return;
        }
        playhead.set(scrubFractionForOffset(event.x, waveWidth));
        // A tap is one deliberate jump: it always lands.
        runOnJS(scrubTo)(event.x, true);
      });

    // Whichever the hand meant first wins: a drag on movement, a tap on lift.
    return Gesture.Race(drag, tap);
    /* eslint-enable react-hooks/refs */
  }, [beginScrub, finishScrub, playhead, scrubTo, scrubbing, waveWidth]);

  const handleWaveLayout = useCallback((event: LayoutChangeEvent) => {
    setWaveWidth(event.nativeEvent.layout.width);
  }, []);

  const readout = scrubSeconds ?? currentTime;

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
                gap={WAVE_BAR_GAP}
                height={WAVE_HEIGHT}
                levels={levels}
                progress={playhead}
                width={waveWidth}
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

/** The pull at which a voice page starts dissolving into its tile. */
const VOICE_FADE_FROM = 0.85;

export type ViewerVoicePageProps = {
  uri: string;
  label: string;
  /** Kept for callers that seed a shape; the live waveform ignores it. */
  seed?: string;
  width: number;
  height: number;
  active: boolean;
  morph: ViewerMorph;
  home: ViewerHome;
};

/**
 * A voice note has no picture, so nothing on it can be the tile's microphone.
 * The page itself travels instead: it scales toward the tile with the tile's
 * radius, keeps the waveform visible the whole way, and only dissolves in the
 * last stretch, where the tile's own look takes over.
 */
export function ViewerVoicePage({
  uri,
  label,
  width,
  height,
  active,
  morph,
  home,
}: ViewerVoicePageProps) {
  const pageStyle = useAnimatedStyle(() => {
    const t = morph.t.get();
    const hasHome = home.valid.get();
    const cover = hasHome
      ? Math.max(home.width.get() / width, home.height.get() / height)
      : 1;
    const scale = 1 + (Math.min(cover, 1) - 1) * t;
    const centreX = width / 2;
    const centreY = height / 2;
    const targetCentreX = hasHome ? home.x.get() + home.width.get() / 2 : centreX;
    const targetCentreY = hasHome ? home.y.get() + home.height.get() / 2 : centreY;
    return {
      opacity: 1 - Math.max(0, (t - VOICE_FADE_FROM) / (1 - VOICE_FADE_FROM)),
      // Clipped at the radius, so the page's corners round as it lands.
      overflow: 'hidden',
      borderRadius: shellRadiusFor(t, home.radius.get(), scale),
      transform: [
        { translateX: morph.residualX.get() },
        { translateY: morph.residualY.get() },
        { translateX: (targetCentreX - centreX) * t },
        { translateY: (targetCentreY - centreY) * t },
        { scale },
      ],
    };
  });

  return (
    <Animated.View style={[styles.voicePage, { height, width }, pageStyle]}>
      {active ? (
        <PlayingVoicePage label={label} uri={uri} />
      ) : (
        <RestingVoicePage label={label} />
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  page: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  voicePage: {
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
