import { useAudioSampleListener, type AudioPlayer } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

/**
 * A voice note's waveform, measured from the audio itself.
 *
 * expo-audio hands the player's raw PCM frames to a listener while it plays
 * (`useAudioSampleListener`), which is real data rather than a decorative
 * animation: every bar is the peak amplitude of the sound that actually went
 * to the speaker, in its own slice of time. Nothing is decoded up front and
 * nothing is invented — when the note is silent the bars are flat, and when
 * there is no sampling support (Android needs the RECORD_AUDIO permission
 * for it) there is no waveform to pretend with.
 *
 * The levels live in one shared value so the bars animate on the UI thread:
 * at sample rates the JS thread would otherwise drop most updates.
 */

/** Frames folded into one bar. More frames per bar keeps the window longer. */
const FRAMES_PER_COLUMN = 24;

export type LiveWaveform = {
  /** Per-bar peak amplitude, 0..1, newest window each update. */
  levels: SharedValue<number[]>;
  /** False when this platform cannot sample playback at all. */
  supported: boolean;
};

/**
 * Split a window of PCM frames into `columns` bars, each the loudest frame in
 * its slice. Pure, so the shape can be tested without a player.
 */
export function envelopeFromFrames(frames: number[], columns: number): number[] {
  if (columns <= 0) {
    return [];
  }
  const levels: number[] = [];
  const perColumn = Math.max(1, Math.floor(frames.length / columns));
  for (let column = 0; column < columns; column += 1) {
    const start = column * perColumn;
    const end = column === columns - 1 ? frames.length : start + perColumn;
    let peak = 0;
    for (let index = start; index < end; index += 1) {
      const value = Math.abs(frames[index]);
      if (value > peak) {
        peak = value;
      }
    }
    levels.push(Math.min(1, peak));
  }
  return levels;
}

/** Bars that fit a width, so the waveform spans it instead of stopping short. */
export function waveformColumnCount(width: number, barWidth = 3, gap = 2): number {
  const step = Math.max(1, barWidth + gap);
  return Math.max(12, Math.min(96, Math.floor(width / step)));
}

/**
 * Sampling is native-only on purpose. On web the only way to read the
 * player's samples is a Web Audio analyser hung off the media element, and a
 * remote memory's audio is cross-origin: the analyser reads zeros, and
 * routing playback through the audio context can stall it outright. Rather
 * than ship a waveform that is flat on web and wrong about why, web reports
 * no support and the page says so.
 */
const SAMPLING_SUPPORTED_PLATFORM = process.env.EXPO_OS !== 'web';

export function useLiveWaveform(player: AudioPlayer, columns: number): LiveWaveform {
  const levels = useSharedValue<number[]>(() =>
    Array.from({ length: columns }, () => 0),
  );
  const windowRef = useRef<number[]>([]);
  const capacity = columns * FRAMES_PER_COLUMN;
  const [supported, setSupported] = useState(!!player.isAudioSamplingSupported);

  // Sampling has to be ASKED for: expo-audio's listener hook bails out
  // immediately unless the player already reports support, and on web that
  // flag only turns true once sampling has been enabled. Registered before
  // the listener hook below, so it runs first and the listener finds a
  // player that is ready.
  useEffect(() => {
    if (!SAMPLING_SUPPORTED_PLATFORM) {
      return;
    }
    try {
      player.setAudioSamplingEnabled(true);
    } catch {
      // A platform that cannot sample simply leaves the waveform flat.
    }
    setSupported(!!player.isAudioSamplingSupported);
    return () => {
      try {
        player.setAudioSamplingEnabled(false);
      } catch {
        // Nothing to turn off.
      }
    };
  }, [player]);

  useAudioSampleListener(player, (sample) => {
    const frames = sample.channels[0]?.frames;
    if (!frames || frames.length === 0) {
      return;
    }
    // Keep the tail of the signal, so the shape scrolls with the sound
    // instead of flickering on whatever the last callback happened to hold.
    const previous = windowRef.current;
    const next =
      frames.length >= capacity
        ? frames.slice(frames.length - capacity)
        : previous.concat(frames).slice(-capacity);
    windowRef.current = next;
    levels.value = envelopeFromFrames(next, columns);
  });

  return { levels, supported };
}
