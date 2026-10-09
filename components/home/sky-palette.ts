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
 *
 * These four constants are the After Hours stops. Every other theme has its
 * own ramp in `THEME_SKY_RAMPS` below; they stay exported so existing callers
 * (and the After Hours fallback) keep working.
 */
export const LIGHT_SKY_TOP = '#452C4B';
export const LIGHT_SKY_MID = '#8C6E99';
export const DARK_SKY_TOP = '#0D0912';
export const DARK_SKY_MID = '#4A2C4E';

/** Warm starlight: dim points read on dusk, memory tones stay wine-rose/gold. */
export const DAY_SKY_STAR_DIM = '#FFF3EA';
export const DAY_SKY_STAR_YOU = '#F2AEC2';
export const DAY_SKY_STAR_PARTNER = '#FFD9A0';

export const PHOTO_SKY_STAR_COOL = '#E5E6FF';
export const PHOTO_SKY_STAR_WARM = '#FFE2B8';
export const PHOTO_SKY_DEPTH = '#201B38';
export const PHOTO_SKY_HAZE_COOL = '#AAA0DF';
export const PHOTO_SKY_HAZE_WARM = '#EFC6B6';

/** Opaque sky controls keep starlight text readable across both sky ramps. */
export const SKY_CONTROL_INK = '#FFF8FA';
export const SKY_CONTROL_FILL = '#382038';

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

/**
 * Lagoon is the beach theme: bubbles rise where stars would be, and shells
 * rest along the sand line. True only for `lagoon`, so After Hours and every
 * other dusk keep the star field untouched.
 */
export function isBeachTheme(themeId: string): boolean {
  return themeId === 'lagoon';
}

/**
 * Shoreline sand, per mode: a sunlit top and the deeper floor it settles to,
 * so the sand reads as a surface with depth rather than a flat band.
 */
export const SEA_SAND_LIGHT_TOP = '#EBD8B1';
export const SEA_SAND_LIGHT_DEEP = '#D4B583';
export const SEA_SAND_DARK_TOP = '#3A3126';
export const SEA_SAND_DARK_DEEP = '#241D15';

/** Beach water, per mode: shallow near the shore, deep away from it. */
export const SEA_WATER_LIGHT_SHALLOW = '#8AD8CE';
export const SEA_WATER_LIGHT_DEEP = '#20788A';
export const SEA_WATER_DARK_SHALLOW = '#22525F';
export const SEA_WATER_DARK_DEEP = '#0A2028';
/** Sea foam: near-white, cool. Dimmed at night so it does not glare. */
export const SEA_FOAM = '#F3FCFA';
export const SEA_FOAM_DARK = '#C6DEDB';
/** Wet sand at the waterline, per mode. */
export const SEA_WET_LIGHT = '#C0A369';
export const SEA_WET_DARK = '#191410';

/**
 * Shell tones for memory/photo shells: a pearly body with a warm rib so a
 * shell reads on bright sand and on night sand alike. Blush marks the
 * partner's shells; the rest are pearl.
 */
export const SEA_SHELL_PEARL = '#FFF6E6';
export const SEA_SHELL_PEARL_RIB = '#D8B884';
export const SEA_SHELL_BLUSH = '#FFD9C4';
export const SEA_SHELL_BLUSH_RIB = '#D69A78';

/**
 * Shell tints, as the beach actually offers them: pearl, cream, blush, sand,
 * mauve, and a warm brown. A shell's body and its growth-line rib travel
 * together, so every shell reads as one material.
 */
export const SEA_SHELL_PALETTE: { body: string; rib: string }[] = [
  { body: '#FFF3DE', rib: '#B8894A' },
  { body: '#F9D9A8', rib: '#B57F38' },
  { body: '#F2C6B2', rib: '#B07355' },
  { body: '#E9DCBB', rib: '#A98A4E' },
  { body: '#EFBFD2', rib: '#B36A8B' },
  { body: '#E0C69F', rib: '#9C7040' },
];

export type SkyMode = 'light' | 'dark';

export type SkyRamp = {
  top: string;
  mid: string;
};

/**
 * One dusk per theme, per mode. The rule that shaped After Hours holds for
 * every entry: the light mid sits in the same hue family as that theme's own
 * paper, so the gradient melts into the page instead of crossing through
 * gray. The top carries the theme's identity (ember, sea depth, pine night,
 * espresso ink) — a top-to-mid hue shift reads as dusk, while a mid-to-paper
 * hue shift reads as mud, so only the mid is constrained.
 *
 * Dark ramps bridge the theme's near-black background instead: both stops
 * stay in the background's hue family, lifted enough to read as sky.
 */
export const THEME_SKY_RAMPS: Record<string, Record<SkyMode, SkyRamp>> = {
  'after-hours': {
    light: { top: LIGHT_SKY_TOP, mid: LIGHT_SKY_MID },
    dark: { top: DARK_SKY_TOP, mid: DARK_SKY_MID },
  },
  'sunset-shore': {
    light: { top: '#4A2E28', mid: '#C08A67' },
    dark: { top: '#110C09', mid: '#6B4A3A' },
  },
  'sea-glass': {
    light: { top: '#1E3E3B', mid: '#7FBFB8' },
    dark: { top: '#0B1211', mid: '#2E5A56' },
  },
  'deep-ocean': {
    light: { top: '#1A3330', mid: '#A89A86' },
    dark: { top: '#0C100E', mid: '#33544E' },
  },
  'editorial-paper': {
    light: { top: '#2B2620', mid: '#B3A48C' },
    dark: { top: '#0F0C09', mid: '#5A4A3C' },
  },
  /**
   * Lagoon is a daytime beach, not a dusk: bright cyan water at the top
   * melting into the aqua paper. Dark mode is the same lagoon at night —
   * deep lagoon water under a teal night, never the wine dusk.
   */
  'lagoon': {
    light: { top: '#1FA8C9', mid: '#9ADFD8' },
    dark: { top: '#06232B', mid: '#136073' },
  },
};

/**
 * The dusk stops for a theme and mode. Unknown ids fall back to After Hours
 * (the canonical wine dusk) so a stored-but-removed preset never renders a
 * broken sky.
 */
export function skyStopsForTheme(themeId: string, mode: SkyMode): SkyRamp {
  const ramp = THEME_SKY_RAMPS[themeId];
  if (ramp) {
    return mode === 'dark' ? ramp.dark : ramp.light;
  }
  return mode === 'dark'
    ? { top: DARK_SKY_TOP, mid: DARK_SKY_MID }
    : { top: LIGHT_SKY_TOP, mid: LIGHT_SKY_MID };
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
