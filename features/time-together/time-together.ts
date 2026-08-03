import { parseRelationshipStart } from '@/features/calendar/calendar-date-utils';

/**
 * Time together — a quiet remembrance, not an engagement metric.
 *
 * These derivations feed ONE calm line on the profile tab (days together +
 * moments kept). No graphs, no rankings, no notifications, no streak framing:
 * the numbers exist to be glanced at warmly, never optimized.
 *
 * Semantics: the start date itself is "day 1" (a couple's first day together
 * is a day together). Days are counted by calendar date in the viewer's local
 * timezone, so midnight — not the exact hour — rolls the counter over.
 */

/**
 * Whole days since the relationship start, inclusive of the start day
 * ("same day" = day 1). Calendar-day arithmetic in UTC keeps the count exact
 * across leap years and DST transitions. Returns null when the start date is
 * missing/invalid or lies in the future — the UI hides the line quietly.
 */
export function getDaysTogether(
  relationshipStartDate: string | null | undefined,
  now: Date
): number | null {
  const start = relationshipStartDate
    ? parseRelationshipStart(relationshipStartDate)
    : null;

  if (!start) {
    return null;
  }

  const startDayUtc = Date.UTC(
    start.getFullYear(),
    start.getMonth(),
    start.getDate()
  );
  const nowDayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const daysBetween = Math.round((nowDayUtc - startDayUtc) / 86400000);

  if (daysBetween < 0) {
    return null;
  }

  return daysBetween + 1;
}

/** "142 moments kept" — the warm aggregate that sits under the day count. */
export function formatMomentsKept(momentCount: number): string {
  const formatted = momentCount.toLocaleString('en-US');
  return momentCount === 1 ? '1 moment kept' : `${formatted} moments kept`;
}

/** "2,847 days together" — the day count line (start day counts as day 1). */
export function formatDaysTogether(days: number): string {
  const formatted = days.toLocaleString('en-US');
  return days === 1 ? '1 day together' : `${formatted} days together`;
}
