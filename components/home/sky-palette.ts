/**
 * Aoi's sky palette, in one Skia-free module so any surface (including
 * non-native prototypes) can speak the same colour language without pulling
 * the canvas. Re-exported from `memory-sky` for existing callers.
 */

/**
 * Light dusk: a hue-coherent plum → violet-mauve ramp that lands in the
 * lilac paper (#F6F2F7). The mid *must* sit in the same violet family as the
 * paper — a warmer pink-mauve mid blends to gray where it meets the paper,
 * which is what made light mode look muddy.
 */
export const LIGHT_SKY_TOP = '#452C4B';
export const LIGHT_SKY_MID = '#8C6E99';
export const DARK_SKY_TOP = '#0D0912';
export const DARK_SKY_MID = '#4A2C4E';

/** Warm starlight: dim points read on dusk, memory tones stay wine-rose/gold. */
export const DAY_SKY_STAR_DIM = '#FFF3EA';
export const DAY_SKY_STAR_YOU = '#F2AEC2';
export const DAY_SKY_STAR_PARTNER = '#FFD9A0';

export type StarTone = 'dim' | 'you' | 'partner';

export function starToneColor(tone: StarTone): string {
  if (tone === 'partner') {
    return DAY_SKY_STAR_PARTNER;
  }
  if (tone === 'you') {
    return DAY_SKY_STAR_YOU;
  }
  return DAY_SKY_STAR_DIM;
}

/** The colour of one person's mark in the sky. */
export function starColorForRole(role: 'you' | 'partner'): string {
  return role === 'partner' ? DAY_SKY_STAR_PARTNER : DAY_SKY_STAR_YOU;
}

/** Parse #RGB/#RRGGBB/#RRGGBBAA or rgb()/rgba() to [r, g, b]. */
function parseRgb(color: string): [number, number, number] {
  const hex = color.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
  if (hex) {
    let body = hex[1];
    if (body.length === 3) {
      body = body
        .split('')
        .map((char) => char + char)
        .join('');
    }
    return [
      parseInt(body.slice(0, 2), 16),
      parseInt(body.slice(2, 4), 16),
      parseInt(body.slice(4, 6), 16),
    ];
  }
  const rgb = color.match(/rgba?\(\s*(\d+)\s*[,\s]+\s*(\d+)\s*[,\s]+\s*(\d+)/);
  if (rgb) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }
  return [0, 0, 0];
}

/** Mix two colours (#RRGGBB or rgb()/rgba()); t=0 → a, t=1 → b. */
export function mixHex(a: string, b: string, t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  const ca = parseRgb(a);
  const cb = parseRgb(b);
  const mixed = ca.map((value, index) =>
    Math.round(value + (cb[index] - value) * clamped)
  );
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}
