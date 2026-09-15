import { useAudioPlayer } from 'expo-audio';
import { useCallback, useEffect, useState } from 'react';

import { resolveStagedUri } from '@/features/composer/staged-uri';

export type VoicePlayback = {
  isPlaying: boolean;
  /** 0..1 of the whole recording. */
  progress: number;
  /** Seconds elapsed while playing, the whole length otherwise. */
  seconds: number;
  toggle: () => void;
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

  const isPlaying = player.playing;
  const duration = player.duration ?? 0;
  const currentTime = player.currentTime ?? 0;

  return {
    isPlaying,
    progress: duration > 0 ? Math.min(1, currentTime / duration) : 0,
    seconds: isPlaying ? currentTime : duration,
    toggle,
  };
}
