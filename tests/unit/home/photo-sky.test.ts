import { describe, expect, it } from 'vitest';

import { buildPhotoSkyField, photoSkyStar } from '@/features/home/photo-sky';
import type { SkyItem } from '@/features/home/day-sky';

const photos = (count: number): SkyItem[] => Array.from({ length: count }, (_, index) => ({
  id: `photo-${index}`, occurredAt: '2026-01-01', authorRole: 'you',
}));

describe('Us photo sky field', () => {
  it('represents every photo exactly once, including beyond forty', () => {
    for (const count of [0, 1, 3, 80, 500]) {
      const field = buildPhotoSkyField(photos(count));
      expect(field).toHaveLength(count);
      expect(new Set(field.map((star) => star.id)).size).toBe(count);
    }
  });
  it('keeps each photo fixed through additions, removal, reorder, and history filtering', () => {
    const source = photos(80);
    const star = photoSkyStar('photo-25');
    for (const subset of [source, source.slice(20), [...source].reverse(), [...source, ...photos(1).map((item) => ({ ...item, id: 'new' }))]]) {
      expect(buildPhotoSkyField(subset).find((item) => item.id === star.id)).toEqual(star);
    }
  });
  it('has varied depths, starlight temperatures, and sizes rather than uniform dots', () => {
    const field = buildPhotoSkyField(photos(500));
    expect(new Set(field.map((star) => star.depth))).toEqual(new Set(['far', 'mid', 'near']));
    expect(new Set(field.map((star) => star.radius)).size).toBeGreaterThan(450);
    expect(field.filter((star) => star.sparkle).length).toBeLessThan(60);
    expect(field.some((star) => star.warmth < 0.2)).toBe(true);
    expect(field.some((star) => star.warmth > 0.8)).toBe(true);
  });
  it('keeps cores in the visible field and bounds expensive halos to the nearer layers', () => {
    for (const star of buildPhotoSkyField(photos(500))) {
      expect(star.x).toBeGreaterThanOrEqual(0.06);
      expect(star.x).toBeLessThanOrEqual(0.94);
      expect(star.y).toBeGreaterThanOrEqual(0.13);
      expect(star.y).toBeLessThan(0.78);
      expect(star.radius).toBeGreaterThan(0);
      expect(star.opacity).toBeGreaterThanOrEqual(0.55);
      expect(star.opacity).toBeLessThanOrEqual(1);
      if (star.depth === 'far') expect(star.haloRadius).toBe(0);
    }
  });
});
