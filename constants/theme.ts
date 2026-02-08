export const Colors = {
  light: {
    background: '#F5EFE4',
    surface: '#FFFBF4',
    surface2: '#ECE1CF',
    text: '#1E1A16',
    muted: '#6B6258',
    border: '#D4C6B1',
    accent: '#2E6A62',
    partnerAccent: '#6E5A87',
    onAccent: '#F8F5EE',
    danger: '#B64A46',
    onDanger: '#FFF7F6',
    success: '#38684D',
    warning: '#8B6A2F',
    shadow: 'rgba(30, 21, 12, 0.14)',
    thread: '#B8A894',
  },
  dark: {
    background: '#13110E',
    surface: '#1B1713',
    surface2: '#262018',
    text: '#EEE8DF',
    muted: '#B2A89C',
    border: '#3A3128',
    accent: '#71CFC1',
    partnerAccent: '#BBA7D7',
    onAccent: '#10211F',
    danger: '#DF7C79',
    onDanger: '#241311',
    success: '#7BD1A6',
    warning: '#D8BB79',
    shadow: 'rgba(0, 0, 0, 0.45)',
    thread: '#6A5A49',
  },
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

export type { AoiTypography } from '@/constants/typography';
