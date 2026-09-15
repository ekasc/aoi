import { describe, expect, it } from 'vitest';

import {
  DAY_SKY_BASE_BOUNDS,
  DAY_SKY_BASE_ZOOM,
  DAY_SKY_DAYS_PER_YEAR_BAND,
  DAY_SKY_WORLD_CENTER,
  DAY_SKY_ZOOM_AFTER_FIRST_ANNIVERSARY,
  DAY_SKY_ZOOM_PER_LATER_ANNIVERSARY,
  bucketStarsByDepth,
  buildDaySkyField,
  buildSkyField,
  cameraForRelationship,
  countYearAnniversaries,
  opacityForDay,
  positionForDay,
  projectWorldToScreen,
  screenPositionForDay,
  sizeForDay,
  toneForDay,
  worldExtentZoomForDay,
  yearBandForDay,
  zoomForAnniversaries,
} from '@/features/home/day-sky-spatial';
import { buildDaySky } from '@/features/home/day-sky';

function makeMoment(id: string, occurredAt: string, authorRole: 'you' | 'partner' = 'partner') {
  return {
    id,
    type: 'note' as const,
    title: `Title ${id}`,
    body: 'body',
    occurredAt,
    createdAt: occurredAt,
    authorId: authorRole === 'partner' ? 'user_partner' : 'user_you',
    authorRole,
    authorName: authorRole === 'partner' ? 'Alex' : 'You',
  };
}

function localNoonIso(year: number, monthIndex: number, day: number): string {
  return new Date(year, monthIndex, day, 12, 0, 0, 0).toISOString();
}

describe('day-sky spatial positions', () => {
  it('keeps year one compact inside the base bounds', () => {
    expect(DAY_SKY_DAYS_PER_YEAR_BAND).toBe(365);
    for (const dayIndex of [0, 1, 2, 30, 119, 364]) {
      expect(yearBandForDay(dayIndex)).toBe(0);
      expect(positionForDay(dayIndex)).toEqual(positionForDay(dayIndex));
      const { x, y } = positionForDay(dayIndex);
      expect(x).toBeGreaterThanOrEqual(DAY_SKY_BASE_BOUNDS.minX);
      expect(x).toBeLessThanOrEqual(DAY_SKY_BASE_BOUNDS.maxX);
      expect(y).toBeGreaterThanOrEqual(DAY_SKY_BASE_BOUNDS.minY);
      expect(y).toBeLessThanOrEqual(DAY_SKY_BASE_BOUNDS.maxY);
    }
  });

  it('extends world bounds for later bands while band 0 stays put', () => {
    expect(yearBandForDay(364)).toBe(0);
    expect(yearBandForDay(365)).toBe(1);
    expect(yearBandForDay(729)).toBe(1);
    expect(yearBandForDay(730)).toBe(2);
    expect(yearBandForDay(-3)).toBe(0);
    // Later bands scatter in a wider rect about the same center, so the
    // field gains outskirts: some second-year stars fall outside the base.
    const secondYear = Array.from({ length: 365 }, (_, i) => positionForDay(365 + i));
    const outside = secondYear.filter(
      (p) =>
        p.x < DAY_SKY_BASE_BOUNDS.minX ||
        p.x > DAY_SKY_BASE_BOUNDS.maxX ||
        p.y < DAY_SKY_BASE_BOUNDS.minY ||
        p.y > DAY_SKY_BASE_BOUNDS.maxY,
    );
    expect(outside.length).toBeGreaterThan(0);
    // ...but every band stays inside its own zoom-tier extent.
    for (const dayIndex of [0, 200, 365, 500, 730, 2000]) {
      const extent = worldExtentZoomForDay(dayIndex);
      const { x, y } = positionForDay(dayIndex);
      const halfW = (DAY_SKY_BASE_BOUNDS.maxX - DAY_SKY_BASE_BOUNDS.minX) / 2;
      const halfH = (DAY_SKY_BASE_BOUNDS.maxY - DAY_SKY_BASE_BOUNDS.minY) / 2;
      expect(positionForDay(dayIndex)).toEqual(positionForDay(dayIndex));
      expect(Math.abs(x - DAY_SKY_WORLD_CENTER.x)).toBeLessThanOrEqual(halfW * extent + 1e-9);
      expect(Math.abs(y - DAY_SKY_WORLD_CENTER.y)).toBeLessThanOrEqual(halfH * extent + 1e-9);
    }
    expect(worldExtentZoomForDay(0)).toBe(1);
    expect(worldExtentZoomForDay(400)).toBe(DAY_SKY_ZOOM_AFTER_FIRST_ANNIVERSARY);
  });

  it('projects world to screen about the center (camera pull-back)', () => {
    // Zoom 1 is the identity: year one fills the frame.
    const world = positionForDay(30);
    const framed = projectWorldToScreen(world, 1);
    expect(framed.x).toBeCloseTo(world.x, 12);
    expect(framed.y).toBeCloseTo(world.y, 12);
    // The center is the fixed point at every zoom.
    expect(projectWorldToScreen(DAY_SKY_WORLD_CENTER, 2)).toEqual(DAY_SKY_WORLD_CENTER);
    // Pulling back shrinks the compact field toward the center,
    // exposing room for the outskirts.
    const corner = projectWorldToScreen(
      { x: DAY_SKY_BASE_BOUNDS.minX, y: DAY_SKY_BASE_BOUNDS.minY },
      DAY_SKY_ZOOM_AFTER_FIRST_ANNIVERSARY,
    );
    expect(corner.x).toBeGreaterThan(DAY_SKY_BASE_BOUNDS.minX);
    expect(corner.y).toBeGreaterThan(DAY_SKY_BASE_BOUNDS.minY);
    // At its own band zoom every star lands inside the base frame, so the
    // current camera always reveals the whole field to date.
    for (const dayIndex of [0, 100, 364, 365, 500, 729, 730, 1500]) {
      const screen = screenPositionForDay(dayIndex, worldExtentZoomForDay(dayIndex));
      expect(screen.x).toBeGreaterThanOrEqual(DAY_SKY_BASE_BOUNDS.minX - 1e-9);
      expect(screen.x).toBeLessThanOrEqual(DAY_SKY_BASE_BOUNDS.maxX + 1e-9);
      expect(screen.y).toBeGreaterThanOrEqual(DAY_SKY_BASE_BOUNDS.minY - 1e-9);
      expect(screen.y).toBeLessThanOrEqual(DAY_SKY_BASE_BOUNDS.maxY + 1e-9);
    }
    // Invalid zooms fall back to the compact frame instead of NaN.
    const fallback = projectWorldToScreen(world, Number.NaN);
    expect(fallback.x).toBeCloseTo(world.x, 12);
    expect(fallback.y).toBeCloseTo(world.y, 12);
  });

  it('places later bands in outer annuli without overlapping the center', () => {
    const halfW = (DAY_SKY_BASE_BOUNDS.maxX - DAY_SKY_BASE_BOUNDS.minX) / 2;
    const halfH = (DAY_SKY_BASE_BOUNDS.maxY - DAY_SKY_BASE_BOUNDS.minY) / 2;
    const normR = (dayIndex: number) => {
      const { x, y } = positionForDay(dayIndex);
      return Math.hypot(
        (x - DAY_SKY_WORLD_CENTER.x) / halfW,
        (y - DAY_SKY_WORLD_CENTER.y) / halfH,
      );
    };
    // Band 0 fills the unit ellipse.
    for (const dayIndex of [0, 30, 119, 200, 364]) {
      expect(yearBandForDay(dayIndex)).toBe(0);
      expect(normR(dayIndex)).toBeLessThanOrEqual(1 + 1e-9);
    }
    // Later bands sit in their ring: inner <= r <= outer, outside the
    // center ellipse, so successive years never re-cover year one.
    for (const dayIndex of [365, 500, 729, 730, 1000, 1500]) {
      const band = yearBandForDay(dayIndex);
      expect(band).toBeGreaterThan(0);
      const inner = zoomForAnniversaries(band - 1);
      const outer = zoomForAnniversaries(band);
      expect(normR(dayIndex)).toBeGreaterThanOrEqual(inner - 1e-9);
      expect(normR(dayIndex)).toBeLessThanOrEqual(outer + 1e-9);
    }
    const secondYear = Array.from({ length: 365 }, (_, i) => 365 + i);
    expect(secondYear.some((d) => normR(d) > 1)).toBe(true);
  });

  it('scatters sequential days instead of drifting', () => {
    const xs = [0, 1, 2, 3, 4].map((d) => positionForDay(d).x);
    const deltas = xs.slice(1).map((x, i) => Math.abs(x - xs[i]));
    expect(Math.max(...deltas)).toBeGreaterThan(0.05);
  });

  it('keeps size and brightness stable and in range', () => {
    for (const dayIndex of [0, 1, 2, 30, 119, 400]) {
      expect(sizeForDay(dayIndex)).toEqual(sizeForDay(dayIndex));
      expect([2, 3, 4]).toContain(sizeForDay(dayIndex));
      expect(opacityForDay(dayIndex)).toEqual(opacityForDay(dayIndex));
      expect(opacityForDay(dayIndex)).toBeGreaterThanOrEqual(0.15);
      expect(opacityForDay(dayIndex)).toBeLessThanOrEqual(0.5);
    }
  });

  it('maps memory coloring to tones (partner wins shared days upstream)', () => {
    expect(toneForDay({ dayIndex: 0, dayKey: '2026-02-08', hasMemory: false, authorRole: null })).toBe('dim');
    expect(toneForDay({ dayIndex: 1, dayKey: '2026-02-09', hasMemory: true, authorRole: 'you' })).toBe('you');
    expect(toneForDay({ dayIndex: 2, dayKey: '2026-02-10', hasMemory: true, authorRole: 'partner' })).toBe('partner');
  });
});

describe('day-sky anniversaries (calendar-based, never 365 approx)', () => {
  it('counts 0 in year one and 1 on the first anniversary day', () => {
    expect(countYearAnniversaries('2026-02-08', new Date(2027, 1, 7))).toBe(0);
    expect(countYearAnniversaries('2026-02-08', new Date(2027, 1, 8))).toBe(1);
  });

  it('counts multiple whole years', () => {
    expect(countYearAnniversaries('2024-01-15', new Date(2026, 5, 1))).toBe(2);
    expect(countYearAnniversaries('2024-01-15', new Date(2027, 0, 15))).toBe(3);
  });

  it('clamps Feb 29 starts to Feb 28 outside leap years', () => {
    expect(countYearAnniversaries('2024-02-29', new Date(2025, 1, 27))).toBe(0);
    expect(countYearAnniversaries('2024-02-29', new Date(2025, 1, 28))).toBe(1);
    expect(countYearAnniversaries('2024-02-29', new Date(2028, 1, 29))).toBe(4);
  });

  it('does not use fixed 365-day years', () => {
    // Mar 1 2023 -> Feb 29 2024 is 365 elapsed days, but the Mar 1
    // anniversary has not arrived: a floor(days/365) approximation would
    // wrongly report 1.
    expect(countYearAnniversaries('2023-03-01', new Date(2024, 1, 29))).toBe(0);
    expect(countYearAnniversaries('2023-03-01', new Date(2024, 2, 1))).toBe(1);
  });

  it('returns 0 for missing/invalid/future starts', () => {
    expect(countYearAnniversaries(null, new Date(2027, 1, 8))).toBe(0);
    expect(countYearAnniversaries(undefined, new Date(2027, 1, 8))).toBe(0);
    expect(countYearAnniversaries('not-a-date', new Date(2027, 1, 8))).toBe(0);
    expect(countYearAnniversaries('2026-02-08', new Date(2026, 1, 7))).toBe(0);
  });
});

describe('day-sky camera zoom tiers', () => {
  it('stays compact in year one and steps out per anniversary', () => {
    expect(DAY_SKY_BASE_ZOOM).toBe(1);
    expect(zoomForAnniversaries(0)).toBe(1);
    expect(zoomForAnniversaries(1)).toBe(DAY_SKY_ZOOM_AFTER_FIRST_ANNIVERSARY);
    expect(zoomForAnniversaries(1)).toBeGreaterThan(1);
    expect(zoomForAnniversaries(2)).toBe(
      DAY_SKY_ZOOM_AFTER_FIRST_ANNIVERSARY + DAY_SKY_ZOOM_PER_LATER_ANNIVERSARY,
    );
  });

  it('expands monotonically and unboundedly', () => {
    let prev = zoomForAnniversaries(0);
    for (let n = 1; n <= 10; n += 1) {
      const next = zoomForAnniversaries(n);
      expect(next).toBeGreaterThan(prev);
      prev = next;
    }
  });

  it('derives the camera from the calendar anniversary count', () => {
    expect(cameraForRelationship('2026-02-08', new Date(2026, 5, 1))).toEqual({
      anniversaries: 0,
      zoom: 1,
    });
    expect(cameraForRelationship('2026-02-08', new Date(2027, 1, 8))).toEqual({
      anniversaries: 1,
      zoom: DAY_SKY_ZOOM_AFTER_FIRST_ANNIVERSARY,
    });
  });
});

describe('day-sky spatial field', () => {
  it('represents every day with stable world positions as age grows', () => {
    const small = buildDaySky(200, [], '2024-01-01');
    const grown = buildDaySky(400, [], '2024-01-01');
    const smallField = buildSkyField(small ?? [], { startDate: '2024-01-01', now: new Date(2024, 5, 1) });
    const grownField = buildSkyField(grown ?? [], { startDate: '2024-01-01', now: new Date(2025, 5, 1) });
    expect(smallField.stars).toHaveLength(200);
    expect(grownField.stars).toHaveLength(400);
    // No reshuffle: the first 200 world positions are identical at both ages.
    expect(grownField.stars.slice(0, 200).map((s) => [s.x, s.y, s.size, s.opacity, s.tone])).toEqual(
      smallField.stars.map((s) => [s.x, s.y, s.size, s.opacity, s.tone]),
    );
    expect(grownField.totalDays).toBe(400);
  });

  it('partitions into exactly three depth buckets', () => {
    const days = buildDaySky(400, [], '2024-01-01');
    const field = buildSkyField(days ?? [], { startDate: '2024-01-01' });
    const buckets = bucketStarsByDepth(field.stars);
    expect(buckets.far.length + buckets.mid.length + buckets.near.length).toBe(400);
    expect(buckets.far.length).toBeGreaterThan(0);
    expect(buckets.mid.length).toBeGreaterThan(0);
    expect(buckets.near.length).toBeGreaterThan(0);
    expect(buckets.far.every((s) => s.size === 2)).toBe(true);
    expect(buckets.mid.every((s) => s.size === 3)).toBe(true);
    expect(buckets.near.every((s) => s.size === 4)).toBe(true);
  });

  it('preserves memory day coloring metadata', () => {
    const moments = [
      makeMoment('p1', localNoonIso(2026, 1, 8), 'partner'),
      makeMoment('y1', localNoonIso(2026, 1, 9), 'you'),
    ];
    const field = buildDaySkyField(3, moments, '2026-02-08', new Date(2026, 1, 10));
    expect(field?.stars.map((s) => s.tone)).toEqual(['partner', 'you', 'dim']);
    expect(field?.stars.map((s) => s.hasMemory)).toEqual([true, true, false]);
  });

  it('keeps the null contract for unknown counts/starts', () => {
    expect(buildDaySkyField(null, [], '2026-02-08')).toBeNull();
    expect(buildDaySkyField(5, [], null)).toBeNull();
    expect(buildDaySkyField(5, [], 'not-a-date')).toBeNull();
  });
});
