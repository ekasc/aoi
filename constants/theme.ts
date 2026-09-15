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

export const Motion = {
  fast: 160,
  base: 240,
  slow: 360,
} as const;

export type ThemeName = keyof typeof Colors;
export type AoiColors = typeof Colors;
export type AoiSpacing = typeof Spacing;
export type AoiRadii = typeof Radii;
export type { BeachThemeColors };

export type { AoiTypography } from '@/constants/typography';
