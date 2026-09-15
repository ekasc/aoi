import {
  daysInMonth,
  parseRelationshipStart,
} from '@/features/calendar/calendar-date-utils';
import type { Moment } from '@/features/moments/types';

import { buildDaySky } from './day-sky';
import type { DaySkyDay } from './day-sky';

/**
 * Day-sky spatial model — deterministic expanding star field.
 *
 * One star per day together (unbounded). Each day's world position, size,
 * and resting brightness are pure functions of `dayIndex` alone, so growing
 * older never reshuffles earlier stars: the field only gains new points.
 *
 * Expansion is a camera zoom, not a relayout. Year one (band 0) is the
 * compact field (`zoom 1`) inside `DAY_SKY_BASE_BOUNDS` as a filled ellipse
 * about `DAY_SKY_WORLD_CENTER`. Each later 365-day band occupies the
 * successive outer ellipse annulus between its inner zoom tier
 * (`zoomForAnniversaries(band - 1)`) and its outer tier
 * (`zoomForAnniversaries(band)`), area-uniform in the ring, so later years
 * deterministically gain outskirts without overlapping the center. Every
 * older world position stays identical as new bands append (band 0 moved
 * once from the legacy rect to the broader ellipse to fix the center
 * swarm; future growth is stable). The renderer maps world -> screen with
 * `projectWorldToScreen` (uniform scale about `DAY_SKY_WORLD_CENTER` by
 * the calendar camera zoom), so year one fills the frame and each
 * calendar anniversary pulls back slightly to expose the added ring.
 *
 * Batching: stars carry everything a batched renderer needs in plain data
 * (position, size bucket, opacity, tone). Group by depth with
 * `bucketStarsByDepth` and issue one draw call per bucket (far/mid/near)
 * instead of one animated view per star. Tone maps to starlight colors in
 * the renderer: `dim` -> soft warm white, `you` -> rose, `partner` -> gold.
 */

/** Field extent at year one, relative units. Later years zoom out from here. */
export const DAY_SKY_BASE_ZOOM = 1;
/** First anniversary steps out slightly from the compact first-year field. */
export const DAY_SKY_ZOOM_AFTER_FIRST_ANNIVERSARY = 1.25;
/** Each anniversary after the first expands the field further by this step. */
export const DAY_SKY_ZOOM_PER_LATER_ANNIVERSARY = 0.25;
/** Days per expansion band. Band 0 is year one (compact); band k>0 gains outskirts. */
export const DAY_SKY_DAYS_PER_YEAR_BAND = 365;
/** Compact year-one world rect (fractions of the sky frame). Taller than
 * the legacy 0.34-0.92 strip: minY 0.16 broadens first-year tiny points
 * vertically above the center cluster to match the taller reference sky,
 * while keeping the top ~16% clear for the notch/status + toolbar title
 * (the strip overhang covers the y8 stripe; stars start below it). */
export const DAY_SKY_BASE_BOUNDS = {
  minX: 0.04,
  maxX: 0.96,
  minY: 0.16,
  maxY: 0.9,
} as const;
/** World center for band expansion and camera projection (base midpoint). */
export const DAY_SKY_WORLD_CENTER = { x: 0.5, y: 0.53 } as const;

export type DaySkyTone = 'dim' | 'you' | 'partner';

export type DaySkyStarSize = 2 | 3 | 4;

export type DaySkySpatialStar = {
  dayIndex: number;
  dayKey: string;
  /**
   * World coords (fractions of the sky frame at zoom 1). Band 0 lives in
   * `DAY_SKY_BASE_BOUNDS`; later bands extend beyond it about
   * `DAY_SKY_WORLD_CENTER`. The renderer projects via
   * `projectWorldToScreen` with the calendar camera zoom.
   */
  x: number;
  y: number;
  /** Depth bucket: 2 far, 3 mid, 4 near. */
  size: DaySkyStarSize;
  /** Resting brightness, 0.35 (dim) to 0.75 (bright) in 0.1 steps. */
  opacity: number;
  tone: DaySkyTone;
  hasMemory: boolean;
};

export type DaySkyCamera = {
  /** Whole-year anniversaries passed (calendar-based). */
  anniversaries: number;
  /** Field extent relative to year one. Uniform scale about field center. */
  zoom: number;
};

export type DaySkySpatialField = {
  stars: DaySkySpatialStar[];
  camera: DaySkyCamera;
  totalDays: number;
  anniversaries: number;
};

export type DaySkyDepthBuckets = {
  far: DaySkySpatialStar[];
  mid: DaySkySpatialStar[];
  near: DaySkySpatialStar[];
};

function hashSeed(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

const UINT_MAX = 4294967296;

function scramble(hash: number): number {
  let h = hash >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Expansion band for a day: 0 is year one (compact), k>0 gains outskirts. */
export function yearBandForDay(dayIndex: number): number {
  if (!Number.isFinite(dayIndex)) {
    return 0;
  }
  return Math.max(0, Math.floor(dayIndex / DAY_SKY_DAYS_PER_YEAR_BAND));
}

/** World-extent zoom for a day's band. Band 0 is exactly 1 (compact). */
export function worldExtentZoomForDay(dayIndex: number): number {
  return zoomForAnniversaries(yearBandForDay(dayIndex));
}

/**
 * Map a world position to screen fractions for a camera zoom: uniform
 * scale about `DAY_SKY_WORLD_CENTER`. At zoom 1 the compact year-one
 * field fills the frame; larger zooms shrink it toward the center and
 * reveal the outskirts added by later bands.
 */
export function projectWorldToScreen(
  world: { x: number; y: number },
  zoom: number,
): { x: number; y: number } {
  const z = Number.isFinite(zoom) && zoom >= 1 ? zoom : DAY_SKY_BASE_ZOOM;
  return {
    x: DAY_SKY_WORLD_CENTER.x + (world.x - DAY_SKY_WORLD_CENTER.x) / z,
    y: DAY_SKY_WORLD_CENTER.y + (world.y - DAY_SKY_WORLD_CENTER.y) / z,
  };
}

/** Screen position for a day at a camera zoom (world lookup + projection). */
export function screenPositionForDay(
  dayIndex: number,
  zoom: number,
): { x: number; y: number } {
  return projectWorldToScreen(positionForDay(dayIndex), zoom);
}

/**
 * Stable world position for a day. Deterministic area-uniform ellipse
 * sampling per band: band 0 fills the base ellipse, band k>0 fills the
 * ring between the previous zoom tier and its own tier. Depends only on
 * `dayIndex`: never on the total, so growth never moves old stars.
 */
export function positionForDay(dayIndex: number): { x: number; y: number } {
  const band = yearBandForDay(dayIndex);
  const inner = band <= 0 ? 0 : zoomForAnniversaries(band - 1);
  const outer = worldExtentZoomForDay(dayIndex);
  const theta =
    (scramble(hashSeed(`day-${dayIndex}-x`)) / UINT_MAX) * Math.PI * 2;
  const t = scramble(hashSeed(`day-${dayIndex}-y`)) / UINT_MAX;
  const s =
    band <= 0
      ? Math.sqrt(t) * outer
      : Math.sqrt(inner * inner + t * (outer * outer - inner * inner));
  const halfW = (DAY_SKY_BASE_BOUNDS.maxX - DAY_SKY_BASE_BOUNDS.minX) / 2;
  const halfH = (DAY_SKY_BASE_BOUNDS.maxY - DAY_SKY_BASE_BOUNDS.minY) / 2;
  return {
    x: DAY_SKY_WORLD_CENTER.x + Math.cos(theta) * s * halfW,
    y: DAY_SKY_WORLD_CENTER.y + Math.sin(theta) * s * halfH,
  };
}

/** Stable depth bucket for a day (2 far, 3 mid, 4 near). */
export function sizeForDay(dayIndex: number): DaySkyStarSize {
  const bucket = (hashSeed(`day-${dayIndex}`) >>> 14) % 3;
  if (bucket === 0) {
    return 2;
  }
  if (bucket === 1) {
    return 3;
  }
  return 4;
}

/** Stable resting brightness for a day, faint 0.15 to 0.50 (memory +0.1). */
export function opacityForDay(dayIndex: number): number {
  return 0.15 + ((hashSeed(`day-${dayIndex}`) >>> 20) % 8) * 0.05;
}

/** Memory coloring metadata for a day: partner wins shared days (accent). */
export function toneForDay(day: DaySkyDay): DaySkyTone {
  if (!day.hasMemory || day.authorRole === null) {
    return 'dim';
  }
  return day.authorRole;
}

/**
 * Whole-year anniversaries passed, calendar-based (never a fixed 365-day
 * approximation while the start date is known). Anniversary k falls on the
 * start month/day in year start+k, clamped to the month length (Feb 29 ->
 * Feb 28 outside leap years, matching `anniversaryInMonth`), and counts
 * once its local calendar day has arrived. Returns 0 when the start date
 * is missing/invalid or still in the future.
 */
export function countYearAnniversaries(
  startDate: string | null | undefined,
  now: Date = new Date(),
): number {
  if (!startDate) {
    return 0;
  }
  const start = parseRelationshipStart(startDate);
  if (!start) {
    return 0;
  }
  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  let count = 0;
  for (let k = 1; k <= 200; k += 1) {
    const year = start.getFullYear() + k;
    const day = Math.min(start.getDate(), daysInMonth(year, start.getMonth()));
    const anniversary = new Date(year, start.getMonth(), day).getTime();
    if (anniversary > nowDay) {
      break;
    }
    count += 1;
  }
  return count;
}

/**
 * Camera zoom for an anniversary count: 1 while in year one, a slight step
 * out at the first anniversary, then a further step per anniversary.
 * Monotonic and unbounded so the field keeps expanding with age.
 */
export function zoomForAnniversaries(anniversaries: number): number {
  if (!Number.isFinite(anniversaries)) {
    return DAY_SKY_BASE_ZOOM;
  }
  const n = Math.max(0, Math.floor(anniversaries));
  if (n <= 0) {
    return DAY_SKY_BASE_ZOOM;
  }
  return (
    DAY_SKY_ZOOM_AFTER_FIRST_ANNIVERSARY + (n - 1) * DAY_SKY_ZOOM_PER_LATER_ANNIVERSARY
  );
}

/** Camera for a relationship: calendar anniversary count + matching zoom. */
export function cameraForRelationship(
  startDate: string | null | undefined,
  now: Date = new Date(),
): DaySkyCamera {
  const anniversaries = countYearAnniversaries(startDate, now);
  return { anniversaries, zoom: zoomForAnniversaries(anniversaries) };
}

/**
 * Attach stable spatial metadata to every day. Pure and unbounded: output
 * order matches input order, and earlier entries never change as later days
 * are appended. Pass an explicit `now` for deterministic snapshots.
 */
export function buildSkyField(
  days: DaySkyDay[],
  opts?: { startDate?: string | null; now?: Date },
): DaySkySpatialField {
  const stars = days.map((day) => {
    const position = positionForDay(day.dayIndex);
    return {
      dayIndex: day.dayIndex,
      dayKey: day.dayKey,
      x: position.x,
      y: position.y,
      size: sizeForDay(day.dayIndex),
      opacity: opacityForDay(day.dayIndex),
      tone: toneForDay(day),
      hasMemory: day.hasMemory,
    };
  });
  const camera = cameraForRelationship(
    opts?.startDate ?? null,
    opts?.now ?? new Date(),
  );
  return { stars, camera, totalDays: days.length, anniversaries: camera.anniversaries };
}

/**
 * Split stars into the three depth buckets a batched renderer draws with
 * one call each (mirroring the far/mid/near parallax layers). Partition:
 * every star lands in exactly one bucket, order within a bucket is kept.
 */
export function bucketStarsByDepth(
  stars: readonly DaySkySpatialStar[],
): DaySkyDepthBuckets {
  const far: DaySkySpatialStar[] = [];
  const mid: DaySkySpatialStar[] = [];
  const near: DaySkySpatialStar[] = [];
  for (const star of stars) {
    if (star.size === 2) {
      far.push(star);
    } else if (star.size === 3) {
      mid.push(star);
    } else {
      near.push(star);
    }
  }
  return { far, mid, near };
}

/**
 * Future renderer entry point: mirrors `buildDaySky`'s null contract
 * (null when the count/start is unknown so callers keep the memory-count
 * fallback) but returns the full unbounded spatial field instead of a
 * truncated day list.
 */
export function buildDaySkyField(
  daysTogether: number | null | undefined,
  moments: Moment[] | null | undefined,
  startDate: string | null | undefined,
  now: Date = new Date(),
): DaySkySpatialField | null {
  const days = buildDaySky(daysTogether, moments, startDate);
  if (days === null) {
    return null;
  }
  return buildSkyField(days, { startDate, now });
}
