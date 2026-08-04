import type { Letter } from '@aoi/shared';

import {
  daysInMonth,
  daysUntilDate,
  parseRelationshipStart,
} from '@/features/calendar/calendar-date-utils';

/**
 * Pure time derivations for letters: readiness, the gentle "opens in" label,
 * and the seal-date presets. Re-derived client-side from `sealedUntil` so the
 * shelf can flip to "Ready to open" as time passes, without waiting for a
 * refresh — the server remains the authority on whether a letter may open.
 */

/** True once now ≥ sealedUntil. Invalid dates are never ready. */
export function isLetterReadyToOpen(
  letter: Pick<Letter, 'sealedUntil'>,
  now: Date = new Date()
): boolean {
  const due = new Date(letter.sealedUntil);

  if (Number.isNaN(due.getTime())) {
    return false;
  }

  return now.getTime() >= due.getTime();
}

/**
 * The quiet waiting label for a sealed letter: "Opens today", "Opens in 3
 * days", "Opens in about 5 months", "Opens in about 2 years". Returns
 * "Ready to open" once the due moment has passed.
 */
export function formatOpensInLabel(
  sealedUntil: string,
  now: Date = new Date()
): string {
  const due = new Date(sealedUntil);

  if (Number.isNaN(due.getTime())) {
    return 'Waiting';
  }

  if (now.getTime() >= due.getTime()) {
    return 'Ready to open';
  }

  const days = daysUntilDate(due, now);

  if (days === 0) {
    return 'Opens today';
  }
  if (days === 1) {
    return 'Opens tomorrow';
  }
  if (days <= 45) {
    return `Opens in ${days} days`;
  }

  const months = Math.max(1, Math.round(days / 30.44));
  if (months < 12) {
    return months === 1 ? 'Opens in about a month' : `Opens in about ${months} months`;
  }

  const years = Math.max(1, Math.round(months / 12));
  return years === 1 ? 'Opens in about a year' : `Opens in about ${years} years`;
}

/** The day a letter was opened, e.g. "August 3, 2026". */
export function formatOpenedDayLabel(openedAt: string): string {
  const date = new Date(openedAt);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/** The day a letter opens, e.g. "September 3, 2026". */
export function formatSealDayLabel(sealedUntil: string): string {
  return formatOpenedDayLabel(sealedUntil);
}

/**
 * Seal-date presets land at 9 in the morning local time — letters should
 * open on a calm morning, not at the exact second they were written.
 */
const SEAL_OPEN_HOUR = 9;

function atNinth(year: number, monthIndex: number, day: number): Date {
  return new Date(year, monthIndex, day, SEAL_OPEN_HOUR, 0, 0, 0);
}

/** Same calendar day N months from now (day clamped), at 9am. */
export function getSealDateInMonths(now: Date, months: number): Date {
  const year = now.getFullYear() + Math.floor((now.getMonth() + months) / 12);
  const monthIndex = (now.getMonth() + months) % 12;
  const day = Math.min(now.getDate(), daysInMonth(year, monthIndex));
  return atNinth(year, monthIndex, day);
}

/** Same calendar day N years from now (day clamped), at 9am. */
export function getSealDateInYears(now: Date, years: number): Date {
  const year = now.getFullYear() + years;
  const day = Math.min(now.getDate(), daysInMonth(year, now.getMonth()));
  return atNinth(year, now.getMonth(), day);
}

/**
 * The couple's next whole-year anniversary (from
 * `space.relationshipStartDate`), at 9am — the next "monthiversary" that is
 * a multiple of 12 months and still ahead of now. Day-of-month is clamped
 * like the calendar's anniversary markers (Jan 31 → Feb 28/29). Returns null
 * when the start date is missing or invalid.
 */
export function getNextAnniversary(
  relationshipStartIso: string | null | undefined,
  now: Date = new Date()
): Date | null {
  if (!relationshipStartIso) {
    return null;
  }

  const start = parseRelationshipStart(relationshipStartIso);

  if (!start) {
    return null;
  }

  const monthsTogether = Math.max(
    0,
    (now.getFullYear() - start.getFullYear()) * 12 +
      (now.getMonth() - start.getMonth())
  );

  // Start from the last whole-year mark reached by month count, then step
  // forward until the candidate is strictly ahead of now. The day-of-month
  // is what decides: inside the anniversary month but before the day, this
  // year's anniversary is still ahead; on or after the day, next year's is.
  let candidateMonths = Math.floor(monthsTogether / 12) * 12;

  for (let attempts = 0; attempts < 4; attempts += 1) {
    const year =
      start.getFullYear() + Math.floor((start.getMonth() + candidateMonths) / 12);
    const monthIndex = (start.getMonth() + candidateMonths) % 12;
    const day = Math.min(start.getDate(), daysInMonth(year, monthIndex));
    const candidate = atNinth(year, monthIndex, day);

    if (candidate.getTime() > now.getTime()) {
      return candidate;
    }

    candidateMonths += 12;
  }

  return null;
}
