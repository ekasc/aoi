import type { CalendarEvent } from '@/features/calendar/types';

export function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

export function addDays(date: Date, amount: number) {
  const value = new Date(date);
  value.setDate(value.getDate() + amount);
  return value;
}

export function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

export function endOfDayExclusive(date: Date) {
  return addDays(startOfDay(date), 1);
}

export function toDayKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isSameDay(left: Date, right: Date) {
  return toDayKey(left) === toDayKey(right);
}

export function isSameMonth(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth()
  );
}

export function formatMonthTitle(date: Date) {
  return date.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

export function formatWeekdayShort(date: Date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
  });
}

export function formatDateTitle(date: Date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

export function formatTimeRange(startIso: string, endIso: string) {
  const start = new Date(startIso);
  const end = new Date(endIso);

  return `${start.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })} - ${end.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

export function monthBounds(date: Date) {
  const monthStart = startOfMonth(date);
  const nextMonthStart = addMonths(monthStart, 1);
  return { monthStart, nextMonthStart };
}

export function buildMonthGrid(date: Date) {
  const monthStart = startOfMonth(date);
  const leadingDays = monthStart.getDay();
  const gridStart = addDays(monthStart, -leadingDays);
  const monthEnd = addDays(addMonths(monthStart, 1), -1);
  const trailingDays = 6 - monthEnd.getDay();
  const totalDays = leadingDays + monthEnd.getDate() + trailingDays;

  return Array.from({ length: totalDays }, (_, index) => addDays(gridStart, index));
}

export function isEventOnDate(event: CalendarEvent, date: Date) {
  return toDayKey(new Date(event.startsAt)) === toDayKey(date);
}

export type WeekBounds = { weekStart: Date; weekEnd: Date };

export function getWeekBounds(now: Date): WeekBounds {
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay()); // back to Sunday
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = addDays(weekStart, 7);
  return { weekStart, weekEnd };
}

export function isInWeek(date: Date, now: Date): boolean {
  const { weekStart, weekEnd } = getWeekBounds(now);
  return date >= weekStart && date < weekEnd;
}

// ── Countdown lane ─────────────────────────────────────────────────────────
//
// "Next time you see each other in N days." The calendar actor model only
// has `you`/`partner` (no `both`), so togetherness is an explicit marker:
// events with `together === true`. If none are upcoming we fall back to the
// nearest future event labeled `Date`.

/** Days from `now`'s calendar day until `target`'s calendar day (≥ 0). */
export function daysUntilDate(target: Date, now: Date): number {
  const startOfTarget = startOfDay(target).getTime();
  const startOfNow = startOfDay(now).getTime();
  const diffMs = startOfTarget - startOfNow;
  return Math.max(0, Math.round(diffMs / 86_400_000));
}

/** Is the event still ahead of us (not fully in the past)? */
export function isUpcomingEvent(event: CalendarEvent, now: Date): boolean {
  const endsAt = new Date(event.endsAt);
  if (Number.isNaN(endsAt.getTime())) {
    return false;
  }
  return endsAt.getTime() > now.getTime();
}

export type CountdownInfo = {
  event: CalendarEvent;
  daysUntil: number;
};

/**
 * Find the next event worth counting down to. Prefers events marked
 * `together`; falls back to the nearest upcoming `Date`-labeled event.
 * Returns null when nothing qualifies.
 */
export function findCountdownEvent(
  events: CalendarEvent[],
  now: Date = new Date()
): CountdownInfo | null {
  const upcoming = events
    .filter((event) => isUpcomingEvent(event, now))
    .sort(
      (left, right) =>
        new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime()
    );

  const together = upcoming.find((event) => event.together === true);
  const candidate =
    together ?? upcoming.find((event) => event.label.preset === 'Date');

  if (!candidate) {
    return null;
  }

  return {
    event: candidate,
    daysUntil: daysUntilDate(new Date(candidate.startsAt), now),
  };
}

/** Warm, brief countdown copy. Returns null when there is nothing to show. */
export function formatCountdownLabel(info: CountdownInfo | null): string | null {
  if (!info) {
    return null;
  }

  const { daysUntil } = info;
  if (daysUntil === 0) {
    return 'You see each other today.';
  }
  if (daysUntil === 1) {
    return 'You see each other tomorrow.';
  }
  return `You see each other in ${daysUntil} days.`;
}

// ── Anniversaries ──────────────────────────────────────────────────────────
//
// Monthly "monthiversary" markers on the same day-of-month as the
// relationship start date, clamped to the month's last day when the start
// day doesn't exist (e.g. Jan 31 → Feb 28/29). Whole-year anniversaries are
// the monthiversary that lands on a multiple of 12 months and are emphasized.

export type AnniversaryKind = 'monthly' | 'yearly';

export type AnniversaryMarker = {
  date: Date;
  kind: AnniversaryKind;
  /** Whole months since the relationship started (≥ 1). */
  months: number;
};

/**
 * Parse the space's relationship start date. Accepts a full ISO datetime or a
 * date-only `YYYY-MM-DD` (treated as local time so the day never shifts).
 */
export function parseRelationshipStart(value: string): Date | null {
  if (!value) {
    return null;
  }

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const parsed = new Date(
      Number(dateOnly[1]),
      Number(dateOnly[2]) - 1,
      Number(dateOnly[3])
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Number of days in a given month (monthIndex is 0-based). */
export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * Compute the anniversary marker (if any) that falls in a given month.
 * Returns null for the start month itself and for months before it.
 */
export function anniversaryInMonth(
  start: Date,
  year: number,
  monthIndex: number
): AnniversaryMarker | null {
  const months =
    (year - start.getFullYear()) * 12 + (monthIndex - start.getMonth());

  if (months < 1) {
    return null;
  }

  // Clamp the start day-of-month to the month's length (Jan 31 → Feb 28/29).
  const day = Math.min(start.getDate(), daysInMonth(year, monthIndex));
  const date = new Date(year, monthIndex, day);

  return {
    date,
    kind: months % 12 === 0 ? 'yearly' : 'monthly',
    months,
  };
}

/** All anniversary marker days within the month containing `monthDate`. */
export function getAnniversaryMarkers(
  relationshipStartIso: string | null | undefined,
  monthDate: Date
): AnniversaryMarker[] {
  const start = relationshipStartIso
    ? parseRelationshipStart(relationshipStartIso)
    : null;

  if (!start) {
    return [];
  }

  const marker = anniversaryInMonth(
    start,
    monthDate.getFullYear(),
    monthDate.getMonth()
  );

  return marker ? [marker] : [];
}

/** Anniversary info for a specific date, or null when it is not one. */
export function getAnniversaryForDate(
  relationshipStartIso: string | null | undefined,
  date: Date
): AnniversaryMarker | null {
  const markers = getAnniversaryMarkers(relationshipStartIso, date);
  return (
    markers.find((marker) => isSameDay(marker.date, date)) ?? null
  );
}

/** Quiet one-liner for today's anniversary, or null when today is not one. */
export function formatAnniversaryLabel(
  marker: AnniversaryMarker | null
): string | null {
  if (!marker) {
    return null;
  }

  if (marker.kind === 'yearly') {
    const years = marker.months / 12;
    return years === 1 ? 'One year together today.' : `${years} years together today.`;
  }

  return marker.months === 1
    ? 'One month together today.'
    : `${marker.months} months together today.`;
}

// ── Agenda grouping ────────────────────────────────────────────────────────

export type AgendaDay = {
  /** Stable day key, e.g. `2026-08-03`. */
  key: string;
  /** Human label: Today / Tomorrow / `Mon, Aug 3`. */
  label: string;
  events: CalendarEvent[];
};

/** Label for a calendar day relative to now. */
export function formatAgendaDayLabel(date: Date, now: Date): string {
  if (isSameDay(date, now)) {
    return 'Today';
  }
  if (isSameDay(date, addDays(now, 1))) {
    return 'Tomorrow';
  }
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Group upcoming events by calendar day for the agenda lane. Only events that
 * overlap the window starting now and spanning `horizonDays` are included.
 */
export function groupAgendaEvents(
  events: CalendarEvent[],
  now: Date = new Date(),
  horizonDays = 30
): AgendaDay[] {
  const windowEnd = addDays(startOfDay(now), horizonDays);

  const upcoming = events.filter((event) => {
    const startsAt = new Date(event.startsAt);
    const endsAt = new Date(event.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      return false;
    }
    // Event overlaps [now, windowEnd): it ends after now and starts before
    // the horizon closes.
    return endsAt.getTime() > now.getTime() && startsAt.getTime() < windowEnd.getTime();
  });

  const byDay = new Map<string, CalendarEvent[]>();
  for (const event of upcoming) {
    const key = toDayKey(new Date(event.startsAt));
    const bucket = byDay.get(key);
    if (bucket) {
      bucket.push(event);
    } else {
      byDay.set(key, [event]);
    }
  }

  const days: AgendaDay[] = [];
  for (const [key, dayEvents] of byDay) {
    dayEvents.sort(
      (left, right) =>
        new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime()
    );
    days.push({
      key,
      label: formatAgendaDayLabel(new Date(dayEvents[0].startsAt), now),
      events: dayEvents,
    });
  }

  return days.sort((left, right) => (left.key < right.key ? -1 : 1));
}

/**
 * Time label for a single event row: "All day" for all-day events, otherwise a
 * localized start time.
 */
export function formatEventTimeLabel(event: CalendarEvent): string {
  if (event.allDay) {
    return 'All day';
  }
  return new Date(event.startsAt).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}
