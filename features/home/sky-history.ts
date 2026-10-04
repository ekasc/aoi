import { parseRelationshipStart } from '@/features/calendar/calendar-date-utils';
import type { CalendarEvent } from '@/features/calendar/types';
import type { Letter } from '@/features/letters/types';
import { getDaysTogether } from '@/features/time-together/time-together';

export type SkyHistoryMonth = {
  index: number;
  startsAt: Date;
  asOf: Date;
  label: string;
  isToday: boolean;
};

export function wholeMonthsBetween(from: Date, to: Date): number {
  const months = (to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth();
  return to.getDate() < from.getDate() ? months - 1 : months;
}

/** Include the whole start day and each completed month, but never future time. */
export function skyHistoryMonths(startDate: string | null | undefined, now: Date): SkyHistoryMonth[] {
  const start = startDate ? parseRelationshipStart(startDate) : null;
  if (!start || start.getTime() > now.getTime()) return [];

  const count = (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth() + 1;
  const startDayEnd = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 59, 999);
  const months: SkyHistoryMonth[] = startDayEnd.getTime() < now.getTime() ? [{
    index: 0, startsAt: start, asOf: startDayEnd,
    label: start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    isToday: false,
  }] : [];

  for (let index = 0; index < count; index += 1) {
    const startsAt = new Date(start.getFullYear(), start.getMonth() + index, 1);
    const isToday = index === count - 1;
    const asOf = isToday ? now : new Date(startsAt.getFullYear(), startsAt.getMonth() + 1, 0, 23, 59, 59, 999);
    if (months.at(-1)?.asOf.getTime() !== asOf.getTime()) {
      months.push({
        index: months.length, startsAt, asOf, isToday,
        label: isToday ? 'Today' : startsAt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      });
    }
  }
  return months;
}

export function clampSkyHistoryIndex(index: number, monthCount: number): number {
  if (monthCount <= 0) return 0;
  if (!Number.isFinite(index)) return monthCount - 1;
  return Math.min(monthCount - 1, Math.max(0, Math.round(index)));
}

export function formatRelationshipAge(startDate: string | null | undefined, asOf: Date): string {
  const start = startDate ? parseRelationshipStart(startDate) : null;
  if (!start || asOf.getTime() < start.getTime()) return '';
  const months = wholeMonthsBetween(start, asOf);
  if (months < 1) {
    const days = getDaysTogether(startDate, asOf);
    if (days === null) return '';
    return days === 1 ? '1 day together' : `${days.toLocaleString('en-US')} days together`;
  }
  const years = Math.floor(months / 12);
  const remainder = months % 12;
  if (remainder === 0) return years === 1 ? '1 year together' : `${years.toLocaleString('en-US')} years together`;
  if (years === 0) return remainder === 1 ? '1 month together' : `${remainder} months together`;
  const yearsLabel = years === 1 ? '1 year' : `${years.toLocaleString('en-US')} years`;
  const monthsLabel = remainder === 1 ? '1 month' : `${remainder} months`;
  return `${yearsLabel}, ${monthsLabel} together`;
}

function isBefore(asOf: Date, iso: string | null | undefined): boolean {
  if (!iso) return false;
  const ms = new Date(iso).getTime();
  return !Number.isNaN(ms) && asOf.getTime() < ms;
}

/** Readiness still needs the existing seal-date check after this creation-date filter. */
export function lettersAsOf(letters: Letter[], asOf: Date): Letter[] {
  return letters.filter((letter) => !isBefore(asOf, letter.createdAt));
}

export function eventsAsOf(events: CalendarEvent[], asOf: Date): CalendarEvent[] {
  return events.filter((event) => !isBefore(asOf, event.createdAt));
}

export const SKY_HISTORY_PLUS = {
  title: 'Revisit your sky',
  body: 'Return to an earlier month and see the photos in your sky then.',
} as const;
