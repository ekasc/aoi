import type { CollectionColor } from '@aoi/shared';

/**
 * The list colours, per mode. A list's colour is its mark — a small dot beside
 * its name — so the six are chosen to stay distinct and legible on every
 * theme's paper in both light and dark, rather than borrowing a semantic token
 * whose meaning (danger, success) would be wrong here.
 */
export const COLLECTION_COLOR_PALETTE: Record<
  CollectionColor,
  { light: string; dark: string }
> = {
  rose: { light: '#B4436A', dark: '#E7A3BB' },
  amber: { light: '#9A6B1E', dark: '#E8C07A' },
  sage: { light: '#3E7E68', dark: '#93D1B4' },
  sky: { light: '#2E6A8A', dark: '#8FC7E8' },
  lilac: { light: '#6B5A8E', dark: '#C1ADD7' },
  clay: { light: '#9A5238', dark: '#DBA184' },
};

/** The spoken name of each colour, for a picker's accessible label. */
export const COLLECTION_COLOR_LABELS: Record<CollectionColor, string> = {
  rose: 'Rose',
  amber: 'Amber',
  sage: 'Sage',
  sky: 'Sky',
  lilac: 'Lilac',
  clay: 'Clay',
};

/** The hex for a list's colour in the current mode, or null when unset. */
export function collectionColorValue(
  color: CollectionColor | null | undefined,
  mode: 'light' | 'dark'
): string | null {
  if (!color) {
    return null;
  }
  const entry = COLLECTION_COLOR_PALETTE[color];
  return entry ? entry[mode] : null;
}
