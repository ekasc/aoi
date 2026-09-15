/**
 * Waveform shapes for voice notes, without decoding anything.
 *
 * A recording has no poster to show, so it gets a sound print instead: a
 * stable bar pattern derived from the note's own key. The same recording
 * therefore always draws the same shape, on the wall tile and in the
 * full-screen player alike, and nothing has to be fetched to draw it.
 *
 * This is a SHAPE, not amplitude analysis: expo-audio exposes metering for
 * recording only, never for playback, so nothing here claims to be the real
 * envelope. The player animates these bars with the playback state and wipes
 * them with the playback position.
 */

/** FNV-1a, so a seed maps to the same pattern across sessions and re-renders. */
function seedHash(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Relative bar heights in `[0.22, 1]`, deterministic per seed and always
 * the same length, so two callers showing the same note agree.
 */
export function waveformBars(seed: string, count: number): number[] {
  const bars: number[] = [];
  let state = seedHash(seed) || 1;
  for (let index = 0; index < count; index += 1) {
    // Park-Miller step, on the unsigned low 32 bits (Math.imul is signed, so
    // the `>>> 0` is what keeps the next state positive).
    state = (Math.imul(state, 48271) >>> 0) % 2147483647;
    const unit = state / 2147483647;
    bars.push(0.22 + Math.min(1, Math.max(0, unit)) * 0.78);
  }
  return bars;
}

/** How many bars a given width can hold without turning them into noise. */
export function waveformBarCount(width: number, barWidth = 3, gap = 3): number {
  const step = Math.max(1, barWidth + gap);
  return Math.max(8, Math.floor(width / step));
}
