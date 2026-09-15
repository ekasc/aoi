import type { Moment } from '@/features/moments/types';

export type ChapterKind = 'monthly' | 'anniversary';

/** Absolute local-time bounds a chapter covers: [fromMs, toMs). */
export type ChapterRange = {
  fromMs: number;
  toMs: number;
};

/**
 * A chapter is a derived view over memories — never a second content store.
 * Identity is stable and content-derived (never array index or render
 * order):
 * - monthly: `month:2026-09`
 * - anniversary: `anniversary:{yearNumber}:{windowEndYear}` (e.g. the third
 *   anniversary window ending in 2026 → `anniversary:3:2026`)
 *
 * `range` is the authoritative membership definition, computed with the
 * device's own local calendar (DST-correct, no server timezone inference):
 * detail screens load it directly, so a chapter never depends on which
 * Story page is loaded. `memoryIds` stays empty on the bucket path.
 */
export type Chapter = {
  id: string;
  kind: ChapterKind;
  /** e.g. "September 2026" or "Three years together". */
  title: string;
  /** e.g. "12 memories" — minimal metadata, no badges. */
  subtitle: string;
  /** Chronological member ids (oldest first); [] on the bucket path. */
  memoryIds: string[];
  /** Absolute local bounds this chapter covers. */
  range: ChapterRange;
  /** First eligible photo in chapter order, if any (cover-only crop). */
  coverPhotoUri: string | null;
  /** Local month key for monthly chapters (YYYY-MM). */
  monthKey: string | null;
  /** 1-based anniversary year for anniversary chapters. */
  anniversaryYear: number | null;
};

const ELIGIBLE_TYPES: ReadonlySet<string> = new Set(['note', 'media', 'trace']);

function isEligible(moment: Moment): boolean {
  if (!ELIGIBLE_TYPES.has(moment.type)) {
    return false;
  }
  const time = new Date(moment.occurredAt).getTime();
  return Number.isFinite(time);
}

function monthTitle(year: number, monthIndex: number): string {
  return new Date(year, monthIndex, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

const ANNIVERSARY_TITLES: Record<number, string> = {
  1: 'One year together',
  2: 'Two years together',
  3: 'Three years together',
};

function anniversaryTitle(yearNumber: number): string {
  return ANNIVERSARY_TITLES[yearNumber] ?? `${yearNumber} years together`;
}

/** Absolute local bounds of a YYYY-MM month. Exported for bucket probing. */
export function monthRange(monthKey: string): ChapterRange {
  const [year, month] = monthKey.split('-').map(Number);
  return {
    fromMs: new Date(year, month - 1, 1).getTime(),
    toMs: new Date(year, month, 1).getTime(),
  };
}

function parseRelationshipDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  // Stored as YYYY-MM-DD; interpret as a local calendar date (never UTC
  // midnight, which would shift the anniversary in negative-offset zones).
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    const fallback = new Date(value);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

function anniversaryWindowRange(yearNumber: number, start: Date): ChapterRange {
  return {
    fromMs: new Date(
      start.getFullYear() + yearNumber - 1,
      start.getMonth(),
      start.getDate()
    ).getTime(),
    toMs: new Date(
      start.getFullYear() + yearNumber,
      start.getMonth(),
      start.getDate()
    ).getTime(),
  };
}

/**
 * Describe a chapter from its stable ID alone — no discovery needed, so a
 * deep link resolves from a fresh session. Returns null for unknown shapes
 * and for anniversary IDs without a usable start date.
 */
export function describeChapter(
  chapterId: string,
  relationshipStartDate: string | null | undefined
): { title: string; range: ChapterRange; kind: ChapterKind } | null {
  const monthly = /^month:(\d{4}-\d{2})$/.exec(chapterId);
  if (monthly) {
    const [, key] = monthly;
    const [year, month] = key.split('-').map(Number);
    if (month < 1 || month > 12) {
      return null;
    }
    return { title: monthTitle(year, month - 1), range: monthRange(key), kind: 'monthly' };
  }
  const anniversary = /^anniversary:(\d+):(\d{4})$/.exec(chapterId);
  if (anniversary) {
    const yearNumber = Number(anniversary[1]);
    const endYear = Number(anniversary[2]);
    const start = parseRelationshipDate(relationshipStartDate);
    if (!start || yearNumber < 1 || start.getFullYear() + yearNumber !== endYear) {
      return null;
    }
    return {
      title: anniversaryTitle(yearNumber),
      range: anniversaryWindowRange(yearNumber, start),
      kind: 'anniversary',
    };
  }
  return null;
}

/**
 * Range membership over loaded memories (stub-mode chapter detail): same
 * eligibility as every other path, absolute [fromMs, toMs) bounds,
 * oldest-first. Mirrors the server's range query exactly.
 */
export function filterChapterRange(moments: Moment[], fromMs: number, toMs: number): Moment[] {
  return moments
    .filter((moment) => {
      if (!isEligible(moment)) {
        return false;
      }
      const at = new Date(moment.occurredAt).getTime();
      return at >= fromMs && at < toMs;
    })
    .sort((left, right) => {
      const timeDiff =
        new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime();
      if (timeDiff !== 0) {
        return timeDiff;
      }
      return left.id < right.id ? -1 : 1;
    });
}
