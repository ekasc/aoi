import {
  addDays,
  parseRelationshipStart,
  toDayKey,
} from '@/features/calendar/calendar-date-utils';
import type { Moment } from '@/features/moments/types';

/**
 * Day sky — one star per day together, not per memory.
 *
 * Day 1 is the relationship-start local day. `daysTogether` is the
 * calendar-day diff + 1 (min 1 when start is today), computed by the caller
 * via `getDaysTogether` (DST-safe local calendar days). `null`/unknown
 * means the caller has no start date and must fall back to memory-count.
 */
export type DaySkyAuthorRole = 'you' | 'partner';

export type DaySkyDay = {
  /** 0-based: 0 is the start-date local day. Oldest first, stable as days grow. */
  dayIndex: number;
  /** Local `YYYY-MM-DD` for this day. */
  dayKey: string;
  hasMemory: boolean;
  /**
   * Merged author for the day: any partner memory wins so shared days take
   * the partner starlight tone (see `toneForDay` in day-sky-spatial).
   */
  authorRole: DaySkyAuthorRole | null;
};

export function formatDaySkyCaption(daysTogether: number): string {
  return daysTogether === 1
    ? '1 day lighting your sky'
    : `${daysTogether} days lighting your sky`;
}

/**
 * Build one entry per day together, oldest first.
 * Unbounded: every day together is represented (no silent truncation).
 * Returns null when unknown (missing/invalid start or non-positive count)
 * so the caller keeps the memory-count fallback exactly.
 */
export function buildDaySky(
  daysTogether: number | null | undefined,
  moments: Moment[] | null | undefined,
  startDate: string | null | undefined,
): DaySkyDay[] | null {
  if (
    typeof daysTogether !== 'number' ||
    !Number.isFinite(daysTogether) ||
    Math.floor(daysTogether) < 1
  ) {
    return null;
  }
  if (!startDate) {
    return null;
  }
  const start = parseRelationshipStart(startDate);
  if (!start) {
    return null;
  }
  const total = Math.floor(daysTogether);
  const source = Array.isArray(moments) ? moments : [];

  const byDay = new Map<string, DaySkyAuthorRole>();
  for (const moment of source) {
    if (!moment || typeof moment.occurredAt !== 'string') {
      continue;
    }
    const at = new Date(moment.occurredAt);
    if (Number.isNaN(at.getTime())) {
      continue;
    }
    const key = toDayKey(at);
    if (moment.authorRole === 'partner') {
      byDay.set(key, 'partner');
    } else if (!byDay.has(key)) {
      byDay.set(key, 'you');
    }
  }

  const days: DaySkyDay[] = [];
  for (let dayIndex = 0; dayIndex < total; dayIndex += 1) {
    const dayKey = toDayKey(addDays(start, dayIndex));
    const authorRole = byDay.get(dayKey) ?? null;
    days.push({ dayIndex, dayKey, hasMemory: authorRole !== null, authorRole });
  }
  return days;
}
