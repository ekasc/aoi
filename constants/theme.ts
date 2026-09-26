import {
  BeachThemes,
  DEFAULT_BEACH_THEME_ID,
  type BeachThemeColors,
} from '@/constants/theme-presets';

export const Colors = {
  light: BeachThemes[DEFAULT_BEACH_THEME_ID].light,
  dark: BeachThemes[DEFAULT_BEACH_THEME_ID].dark,
} as const;

export const Spacing = {
  0: 0,
  4: 4,
  8: 8,
  12: 12,
  16: 16,
  24: 24,
  32: 32,
  40: 40,
  56: 56,
} as const;

export const Radii = {
  none: 0,
  sm: 6,
  md: 10,
  card: 12,
  sheet: 14,
  lg: 16,
  pill: 999,
} as const;

/**
 * 30% frosted surfaces: cards stay translucent so the wine backdrop reads
 * through, instead of stacking opaque slabs. Hex in, 8-digit hex out.
 */
export function withAlpha(hex: string, alpha: number): string {
  const clamped = Math.min(1, Math.max(0, alpha));
  const body = hex.replace('#', '');
  const full = body.length === 3 ? body.split('').map((c: string) => c + c).join('') : body;
  const a = Math.round(clamped * 255).toString(16).padStart(2, '0');
  return `#${full}${a}`;
}

/**
 * Motion vocabulary. Durations are timing curves; springs live in
 * `Springs` below. Every animated value in the app takes one of these —
 * a hand-typed duration is how the same transition ends up feeling
 * different on two screens.
 *
 * These run short on purpose. This is a calm app the reader returns to,
 * not a launch sequence: 150-250ms covers acknowledgement and state
 * change, and anything past ~400ms is the screen making the user wait.
 */
export const Motion = {
  /** Instant acknowledgement: press-in, toggle, selection. */
  fast: 160,
  /** The workhorse: reveals, cross-fades, sheets, state changes. */
  base: 240,
  /** A move worth noticing: a layout shift or a panel changing size. */
  slow: 360,
  /** A dismissal. Shorter than its entrance, so leaving reads as the
   *  screen getting on with it rather than as a second thing happening. */
  exit: 180,
  /** Step between siblings entering together. Small, because a group of
   *  four at 70ms apart is a queue, not a reveal. */
  stagger: 40,
} as const;

/**
 * One spring, because there was only ever one job: a value leaving the
 * reader's finger and coming to rest. Four screens had invented their own
 * (220/26, 240/30, 240/32, and an underdamped 230/19) and they disagreed
 * about whether a release bounces.
 *
 * Critically damped for `stiffness` 240 and `mass` 1, so a card settling back
 * to centre stops at centre instead of sailing past it and coming back. The
 * clamp is belt and braces, and it is what makes the guarantee hold even when
 * a caller throws a release velocity into the config: the photo viewer does,
 * and a velocity is exactly what would otherwise reintroduce the bounce.
 *
 * Reanimated's `withSpring` config shape, so this passes straight through.
 */
export const Springs = {
  rest: { damping: 31, stiffness: 240, mass: 1, overshootClamping: true },
} as const;

/**
 * Two elevations, as `boxShadow` strings so every caller formats one the same
 * way. The gap between them is what made the page feel uneven: cards sat at
 * a shadow so faint it was not there, and the floating add button at a
 * hardcoded 0.25 black, so the button read as floating while the cards read
 * as flat, rather than the two as two heights on one page.
 *
 * `boxShadow` rather than the older `shadow*` props because those are
 * deprecated on current React Native, and because one string formats the same
 * on both platforms instead of branching on iOS-versus-the-rest.
 *
 * `color` is the per-theme `shadow` token, and it is treated as a *hue*: its
 * own alpha is discarded and replaced by the level's. That fixes something.
 * The token ships with an alpha already baked in (0.1 to 0.45 across the
 * presets) and the old `shadow*` props multiplied that by `shadowOpacity`
 * again, so a card asking for 0.08 was actually rendering at 0.96%. Let the
 * level own the strength and the two finally differ.
 */
export const Elevation = {
  card: { opacity: 0.1, radius: 8, offset: 4 },
  floating: { opacity: 0.22, radius: 12, offset: 4 },
} as const;

/**
 * Format a level as a `boxShadow` value in the given hue.
 *
 * The `shadow` tokens are `rgba(...)` strings, not hex, so this parses the
 * functional form as well as hex. Guessing wrong here fails silently: a
 * `withAlpha`-style helper that only understands hex passes an `rgba()` token
 * straight through, both levels collapse onto the token's own alpha, and
 * nothing looks wrong on screen.
 */
export function shadow(
  level: { opacity: number; radius: number; offset: number },
  color: string,
): string {
  const alpha = Math.min(1, Math.max(0, level.opacity));
  const rgb = parseColorChannels(color);
  // Unparseable colour: hand it back and let the platform decide, rather
  // than emitting a broken value.
  const paint = rgb
    ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`
    : color;
  return `0 ${level.offset}px ${level.radius}px ${paint}`;
}

/** Channels of a `#rgb`, `#rrggbb`, `#rrggbbaa` or `rgb()/rgba()` colour. */
function parseColorChannels(
  color: string,
): { r: number; g: number; b: number } | null {
  const hex = color.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
  if (hex) {
    let body = hex[1];
    if (body.length === 3) {
      body = body
        .split('')
        .map((c) => c + c)
        .join('');
    }
    return {
      r: parseInt(body.slice(0, 2), 16),
      g: parseInt(body.slice(2, 4), 16),
      b: parseInt(body.slice(4, 6), 16),
    };
  }
  const fn = color.match(
    /^rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)/,
  );
  if (fn) {
    return { r: Number(fn[1]), g: Number(fn[2]), b: Number(fn[3]) };
  }
  return null;
}

export const AccentWash = 0.1;

export type ThemeName = keyof typeof Colors;
export type AoiColors = typeof Colors;
export type AoiSpacing = typeof Spacing;
export type AoiRadii = typeof Radii;
export type { BeachThemeColors };

export type { AoiTypography } from '@/constants/typography';
