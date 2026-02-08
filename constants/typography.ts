export const FontFamilies = {
  display: 'AoiDisplayNewYork',
  body: 'AoiBodyTrebuchet',
  meta: 'AoiMetaMono',
} as const;

export const Typography = {
  display: {
    fontFamily: FontFamilies.display,
    fontSize: 44,
    lineHeight: 50,
    letterSpacing: -0.7,
  },
  title: {
    fontFamily: FontFamilies.display,
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -0.3,
  },
  body: {
    fontFamily: FontFamilies.body,
    fontSize: 16,
    lineHeight: 24,
    letterSpacing: 0.05,
  },
  caption: {
    fontFamily: FontFamilies.body,
    fontSize: 13,
    lineHeight: 19,
    letterSpacing: 0.1,
  },
  meta: {
    fontFamily: FontFamilies.meta,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.7,
  },
  link: {
    fontFamily: FontFamilies.body,
    fontSize: 16,
    lineHeight: 22,
    letterSpacing: 0.1,
  },
} as const;

export type AoiTypography = typeof Typography;
