/**
 * Where a finger on a voice note's waveform points in the recording.
 *
 * Pure, so the mapping can be checked without a gesture or a player: the
 * waveform is drawn to a known width, so an offset along it is a fraction of
 * the note, and a fraction of the note is a time to seek to.
 */

/** 0..1 along the waveform. Offsets outside it clamp to the ends. */
export function scrubFractionForOffset(offsetX: number, width: number): number {
  if (!Number.isFinite(offsetX) || !(width > 0)) {
    return 0;
  }
  return Math.min(1, Math.max(0, offsetX / width));
}

/** Seconds into a recording, for a finger at `offsetX` along `width`. */
export function scrubSecondsForOffset(
  offsetX: number,
  width: number,
  duration: number,
): number {
  if (!Number.isFinite(duration) || duration <= 0) {
    return 0;
  }
  return scrubFractionForOffset(offsetX, width) * duration;
}

/**
 * How often the scrub readout may re-render while the finger moves. The
 * waveform follows the finger on the UI thread; only the clock text needs
 * React, and it does not need every frame.
 */
export const SCRUB_READOUT_INTERVAL_MS = 120;
