import { useAudioPlayer, type AudioPlayer } from 'expo-audio';
import { useCallback, useEffect, useState } from 'react';

import { resolveStagedUri } from '@/features/composer/staged-uri';

export type VoicePlayback = {
  /**
   * The live player, for the surfaces that need more than transport: the
   * full-screen page samples its PCM to draw a real waveform.
   */
  player: AudioPlayer;
  isPlaying: boolean;
  /** 0..1 of the whole recording. */
  progress: number;
  /** Seconds elapsed while playing, the whole length otherwise. */
  seconds: number;
  /** Whole length in seconds, 0 until the player has loaded one. */
  duration: number;
  /** Seconds elapsed, whatever the transport is doing. */
  currentTime: number;
  toggle: () => void;
  /** Jump to a position, for scrubbing a waveform. */
  seek: (seconds: number) => void;
  /** Start or stop without toggling, for a scrub that must not race itself. */
  setPlaying: (playing: boolean) => void;
};

/** `0:33` — the player's clock, in one place. */
export function formatPlaybackSeconds(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0:00';
  }
  const totalSeconds = Math.round(value);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Playback for one voice note, shared by every shape that offers it: the
 * feed's player row and the gallery's audio tile. Staged voice notes are
 * Documents-relative paths until upload; remote URLs pass through untouched.
 *
 * Light polling keeps progress honest without re-render storms.
 */
export function useVoicePlayback(uri: string): VoicePlayback {
  const player = useAudioPlayer(resolveStagedUri(uri));
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((value) => value + 1), 400);

    return () => clearInterval(interval);
  }, []);

  const toggle = useCallback(() => {
    if (player.playing) {
      player.pause();
    } else {
      player.play();
    }
    setTick((value) => value + 1);
  }, [player]);

  const setPlaying = useCallback(
    (playing: boolean) => {
      if (playing === player.playing) {
        return;
      }
      if (playing) {
        player.play();
      } else {
        player.pause();
      }
      setTick((value) => value + 1);
    },
    [player],
  );

  // Seeks are fire-and-forget: a scrub issues them faster than the player
  // settles, and the last one wins.
  const seek = useCallback(
    (seconds: number) => {
      if (!Number.isFinite(seconds) || seconds < 0) {
        return;
      }
      void player.seekTo(seconds).catch(() => {});
    },
    [player],
  );

  const isPlaying = player.playing;
  const duration = player.duration ?? 0;
  const currentTime = player.currentTime ?? 0;

  return {
    player,
    isPlaying,
    progress: duration > 0 ? Math.min(1, currentTime / duration) : 0,
    seconds: isPlaying ? currentTime : duration,
    duration,
    currentTime,
    toggle,
    seek,
    setPlaying,
  };
}
