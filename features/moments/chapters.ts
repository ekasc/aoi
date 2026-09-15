import type { BucketSummary } from '@aoi/shared';

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

function pad2(value: number): string {
  return String(value).padStart(2, '0');
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

function countSubtitle(count: number): string {
  return count === 1 ? '1 memory' : `${count} memories`;
}

function firstPhotoUri(members: Moment[]): string | null {
  for (const member of members) {
    if (member.type === 'media' && member.mediaPreview) {
      return member.mediaPreview;
    }
  }
  return null;
}

function toSortedEligible(moments: Moment[]): Moment[] {
  return moments
    .filter(isEligible)
    .sort((left, right) => {
      const timeDiff =
        new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime();
      if (timeDiff !== 0) {
        return timeDiff;
      }
      return left.id < right.id ? -1 : 1;
    });
}

/**
 * Grouping semantics are explicitly device-local, matching every other Aoi
 * date surface. All bounds below are absolute epoch ms computed with the
 * device calendar — DST transitions included — so discovery buckets and
 * detail ranges always agree, no matter the historical offset regime.
 */
function localMonthKey(occurredAt: string): string {
  const date = new Date(occurredAt);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

function currentLocalMonthKey(now: Date): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
}

/** Absolute local bounds of a YYYY-MM month. Exported for bucket probing. */
export function monthRange(monthKey: string): ChapterRange {
  const [year, month] = monthKey.split('-').map(Number);
  return {
    fromMs: new Date(year, month - 1, 1).getTime(),
    toMs: new Date(year, month, 1).getTime(),
  };
}

/** Previous completed local month key (the month before `now`'s month). */
export function previousMonthKey(now: Date, back: number): string {
  const date = new Date(now.getFullYear(), now.getMonth() - back, 1);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
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
 * Anniversary windows are simple annual local-date periods: window N covers
 * [start + (N-1) years, start + N years). Only completed windows produce
 * chapters — the in-progress year is not a chapter yet, and a null start
 * date produces no anniversary chapter at all (never fabricated).
 */
function anniversaryWindowFor(
  occurredAt: string,
  start: Date
): { yearNumber: number; endYear: number } | null {
  const date = new Date(occurredAt);
  let yearNumber = date.getFullYear() - start.getFullYear() + 1;
  // A memory earlier in the calendar year than the anniversary month/day
  // still belongs to the previous window.
  if (
    date.getMonth() < start.getMonth() ||
    (date.getMonth() === start.getMonth() && date.getDate() < start.getDate())
  ) {
    yearNumber -= 1;
  }
  if (yearNumber < 1) {
    return null;
  }
  return { yearNumber, endYear: start.getFullYear() + yearNumber };
}

function isWindowComplete(
  yearNumber: number,
  start: Date,
  now: Date
): boolean {
  const windowEnd = new Date(
    start.getFullYear() + yearNumber,
    start.getMonth(),
    start.getDate()
  );
  // Compare calendar days (ignore time-of-day): the window completes on its
  // anniversary date.
  const endDay = new Date(windowEnd.getFullYear(), windowEnd.getMonth(), windowEnd.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return endDay.getTime() <= today.getTime();
}

function sortChapters(chapters: Chapter[]): Chapter[] {
  // Stable presentation order: monthly newest-first, then anniversary
  // newest-window-first.
  chapters.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'monthly' ? -1 : 1;
    }
    if (left.kind === 'monthly' && right.kind === 'monthly') {
      return (right.monthKey as string) < (left.monthKey as string) ? -1 : 1;
    }
    return (right.anniversaryYear as number) - (left.anniversaryYear as number);
  });
  return chapters;
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
 * Derive monthly + anniversary chapters from already-loaded memories.
 * Pure and deterministic: the same dataset (and start date) always yields
 * the same chapters in the same order.
 */
export function buildChapters(
  moments: Moment[],
  relationshipStartDate: string | null | undefined,
  now: Date = new Date()
): Chapter[] {
  const eligible = toSortedEligible(moments);
  const chapters: Chapter[] = [];
  const currentMonth = currentLocalMonthKey(now);

  // Monthly: one chapter per local calendar month with memories. Completed
  // months only — the current incomplete month is not a chapter (smaller
  // coherent behavior; no in-progress representation to maintain).
  const byMonth = new Map<string, Moment[]>();
  for (const moment of eligible) {
    const key = localMonthKey(moment.occurredAt);
    if (key >= currentMonth) {
      continue;
    }
    const group = byMonth.get(key);
    if (group) {
      group.push(moment);
    } else {
      byMonth.set(key, [moment]);
    }
  }
  for (const [key, members] of byMonth) {
    const [year, month] = key.split('-').map(Number);
    chapters.push({
      id: `month:${key}`,
      kind: 'monthly',
      title: monthTitle(year, month - 1),
      subtitle: countSubtitle(members.length),
      memoryIds: members.map((member) => member.id),
      range: monthRange(key),
      coverPhotoUri: firstPhotoUri(members),
      monthKey: key,
      anniversaryYear: null,
    });
  }

  // Anniversary: one chapter per completed annual window with memories.
  const start = parseRelationshipDate(relationshipStartDate);
  if (start) {
    const byWindow = new Map<number, Moment[]>();
    for (const moment of eligible) {
      const window = anniversaryWindowFor(moment.occurredAt, start);
      if (!window || !isWindowComplete(window.yearNumber, start, now)) {
        continue;
      }
      const group = byWindow.get(window.yearNumber);
      if (group) {
        group.push(moment);
      } else {
        byWindow.set(window.yearNumber, [moment]);
      }
    }
    for (const [yearNumber, members] of byWindow) {
      chapters.push({
        id: `anniversary:${yearNumber}:${start.getFullYear() + yearNumber}`,
        kind: 'anniversary',
        title: anniversaryTitle(yearNumber),
        subtitle: countSubtitle(members.length),
        memoryIds: members.map((member) => member.id),
        range: anniversaryWindowRange(yearNumber, start),
        coverPhotoUri: firstPhotoUri(members),
        monthKey: null,
        anniversaryYear: yearNumber,
      });
    }
  }

  return sortChapters(chapters);
}

/**
 * Local stub-mode equivalent of the bucket-summary endpoint: count eligible
 * memories and find the earliest photo inside each requested absolute
 * bound. Same eligibility, same earliest-photo rule — one local dataset,
 * no second fake source. Buckets echo back in request order with counts.
 */
export function summarizeBuckets(
  moments: Moment[],
  buckets: { fromMs: number; toMs: number }[]
): { buckets: { fromMs: number; toMs: number; count: number; cover: string | null }[]; hasOlder: boolean } {
  const eligible = moments.filter(isEligible);
  const oldestFrom = buckets.length > 0 ? Math.min(...buckets.map((bucket) => bucket.fromMs)) : 0;
  return {
    buckets: buckets.map((bucket) => {
      let count = 0;
      let cover: { at: number; id: string; uri: string } | null = null;
      for (const moment of eligible) {
        const at = new Date(moment.occurredAt).getTime();
        if (at < bucket.fromMs || at >= bucket.toMs) {
          continue;
        }
        count += 1;
        if (moment.type === 'media' && moment.mediaPreview) {
          if (!cover || at < cover.at || (at === cover.at && moment.id < cover.id)) {
            cover = { at, id: moment.id, uri: moment.mediaPreview };
          }
        }
      }
      return { fromMs: bucket.fromMs, toMs: bucket.toMs, count, cover: cover?.uri ?? null };
    }),
    hasOlder: eligible.some(
      (moment) => new Date(moment.occurredAt).getTime() < oldestFrom
    ),
  };
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

/**
 * Derive chapters from bucket summaries (server endpoint or the local
 * equivalent) instead of loaded moments. Same rules as the in-memory path —
 * completed months/windows only, deterministic order, earliest-photo
 * covers — but membership resolves later through `range`, so discovery
 * never depends on Story pagination. `memoryIds` stays empty here.
 *
 * Anniversary windows are emitted only when every month they span is
 * covered by the fetched buckets; partially loaded windows wait for older
 * pages rather than reporting wrong counts.
 */
export function buildChaptersFromBuckets(
  buckets: { fromMs: number; toMs: number; count: number; cover: string | null }[],
  relationshipStartDate: string | null | undefined,
  now: Date = new Date()
): Chapter[] {
  const currentMonth = currentLocalMonthKey(now);
  const chapters: Chapter[] = [];
  const coveredMonths = new Set<string>();

  const monthOf = (ms: number): string => {
    const date = new Date(ms);
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
  };

  for (const bucket of buckets) {
    const monthKey = monthOf(bucket.fromMs);
    // Buckets are client-computed month bounds; skip anything outside a
    // single completed local month (defensive — callers send months).
    if (monthOf(bucket.toMs - 1) !== monthKey || monthKey >= currentMonth) {
      continue;
    }
    coveredMonths.add(monthKey);
    if (bucket.count === 0) {
      continue;
    }
    const [year, month] = monthKey.split('-').map(Number);
    chapters.push({
      id: `month:${monthKey}`,
      kind: 'monthly',
      title: monthTitle(year, month - 1),
      subtitle: countSubtitle(bucket.count),
      memoryIds: [],
      range: { fromMs: bucket.fromMs, toMs: bucket.toMs },
      coverPhotoUri: bucket.cover,
      monthKey,
      anniversaryYear: null,
    });
  }

  const start = parseRelationshipDate(relationshipStartDate);
  if (start) {
    // Candidate completed windows, oldest first.
    let yearNumber = 1;
    for (;;) {
      const range = anniversaryWindowRange(yearNumber, start);
      if (!isWindowComplete(yearNumber, start, now)) {
        break;
      }
      // Enumerate the local months this window spans; all must be covered.
      const months: string[] = [];
      const cursor = new Date(range.fromMs);
      cursor.setDate(1);
      while (cursor.getTime() < range.toMs) {
        months.push(`${cursor.getFullYear()}-${pad2(cursor.getMonth() + 1)}`);
        cursor.setMonth(cursor.getMonth() + 1);
      }
      if (months.every((month) => coveredMonths.has(month))) {
        const rows = buckets.filter((bucket) => {
          const key = monthOf(bucket.fromMs);
          return months.includes(key);
        });
        const count = rows.reduce((sum, row) => sum + row.count, 0);
        if (count > 0) {
          const cover = rows.find((row) => row.cover !== null)?.cover ?? null;
          chapters.push({
            id: `anniversary:${yearNumber}:${start.getFullYear() + yearNumber}`,
            kind: 'anniversary',
            title: anniversaryTitle(yearNumber),
            subtitle: countSubtitle(count),
            memoryIds: [],
            range,
            coverPhotoUri: cover,
            monthKey: null,
            anniversaryYear: yearNumber,
          });
        }
      }
      yearNumber += 1;
      if (yearNumber > 100) {
        break;
      }
    }
  }

  return sortChapters(chapters);
}
