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
  sm: 10,
  md: 14,
  lg: 20,
  pill: 999,
} as const;

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
