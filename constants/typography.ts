import { Platform } from 'react-native';

/**
 * Production font decision (P9A): system stack, zero bundled binaries.
 *
 * The three in-repo TTFs were retired — Apple New York (Apple SLA, not
 * redistributable), Trebuchet MS (Microsoft EULA, app bundling not
 * permitted), and an unidentified mono (no provenance at all) cannot ship.
 * See docs/design/asset-manifest.md (A8).
 *
 * Referencing OS font names redistributes nothing: iOS resolves its own
 * system sans, Android its sans, web its system stack.
 * If a licensed editorial face is ever procured, it lands here behind these
 * same keys.
 *
 * System sans throughout, with hierarchy carried by size and weight.
 * No bundled fonts or monospace in the product.
 */
export const FontFamilies: {
  display: string | undefined;
  body: string | undefined;
  meta: string | undefined;
} = {
  display: Platform.select({
    ios: undefined,
    android: 'sans-serif',
    default:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  }),
  // System sans everywhere: named generics where the platform has them,
  // unset (OS default) on iOS where naming the system font is fragile.
  body: Platform.select({
    ios: undefined,
    android: 'sans-serif',
    default:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  }),
  // Labels/metadata ride the same sans as body — no monospace.
  meta: Platform.select({
    ios: undefined,
    android: 'sans-serif',
    default:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  }),
};

export const Typography = {
  navigationTitle: {
    fontFamily: FontFamilies.body,
    fontSize: 17,
    fontWeight: '600',
  },
  /**
   * The one level above `display`, for the two moments that earn it: the
   * pair's names on Us, and the landing wordmark. Everything else that
   * wants to be "the big title on this page" uses `display` unadjusted —
   * the four screens that each invented their own size (28, 34, 34, 40)
   * for that same role were the reason the scale read as arbitrary.
   */
  hero: {
    fontFamily: FontFamilies.display,
    fontSize: 44,
    lineHeight: 50,
    letterSpacing: -0.6,
  },
  display: {
    fontFamily: FontFamilies.display,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.5,
  },
  title: {
    fontFamily: FontFamilies.display,
    fontSize: 22,
    // Headings use tighter leading than body text.
    lineHeight: 26,
    letterSpacing: -0.4,
  },
  // The level between title and body that was missing: entry titles (18/600)
  // over their own body copy (16), so size AND weight separate them.
  subheading: {
    fontFamily: FontFamilies.body,
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: 0.02,
  },
  body: {
    fontFamily: FontFamilies.body,
    fontSize: 16,
    lineHeight: 24,
    letterSpacing: 0.05,
  },
  /**
   * The serif every content form writes into: a moment's title, a letter's
   * words, an event's name. The display serif is what makes writing here feel
   * like writing rather than like filling in a field, and it needs more
   * leading than `title` because the reader is producing the text, not just
   * scanning it.
   */
  inputDisplay: {
    fontFamily: FontFamilies.display,
    fontSize: 22,
    lineHeight: 30,
    letterSpacing: -0.2,
  },
  /**
   * The reading surface: a letter's words, a memory's note, a moment's
   * detail body. Serif, because this is the app's own writing rather than a
   * label, and looser than `body` because the reader is here to stay.
   *
   * `readTitle` is the heading above it. Both existed as four sets of local
   * values (20/32, 20/30, 26/34 and 22/32) before they were named.
   */
  readTitle: {
    fontFamily: FontFamilies.display,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.3,
    fontWeight: '400',
  },
  readBody: {
    fontFamily: FontFamilies.display,
    fontSize: 20,
    lineHeight: 30,
    letterSpacing: -0.1,
    fontWeight: '400',
  },
  bodyEmphasis: {
    fontFamily: FontFamilies.body,
    fontSize: 16,
    lineHeight: 24,
    letterSpacing: 0.05,
  },
  supporting: {
    fontFamily: FontFamilies.body,
    fontSize: 14,
    lineHeight: 20,
    // Small text wants slightly *open* tracking for legibility.
    letterSpacing: 0.1,
  },
  caption: {
    fontFamily: FontFamilies.body,
    fontSize: 13,
    lineHeight: 19,
    letterSpacing: 0.15,
  },
  label: {
    fontFamily: FontFamilies.body,
    fontSize: 13,
    lineHeight: 19,
    letterSpacing: 0.15,
  },
  meta: {
    // Sans, not mono: metadata tracks like the other small text now.
    fontFamily: FontFamilies.meta,
    fontSize: 13,
    lineHeight: 19,
    letterSpacing: 0.15,
  },
  link: {
    fontFamily: FontFamilies.body,
    fontSize: 16,
    lineHeight: 22,
    letterSpacing: 0.05,
  },
} as const;

export type AoiTypography = typeof Typography;
