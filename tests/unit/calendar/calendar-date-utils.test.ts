import { describe, expect, it } from 'vitest';

import {
  anniversaryInMonth,
  daysInMonth,
  daysUntilDate,
  findCountdownEvent,
  formatAgendaDayLabel,
  formatAnniversaryLabel,
  formatCountdownLabel,
  formatEventTimeLabel,
  getAnniversaryForDate,
  getAnniversaryMarkers,
  groupAgendaEvents,
  isUpcomingEvent,
  parseRelationshipStart,
} from '@/features/calendar/calendar-date-utils';
import type { CalendarEvent } from '@/features/calendar/types';

// Fixed "now": Mon Aug 3, 2026 at noon local time.
const NOW = new Date(2026, 7, 3, 12, 0, 0);

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'evt_1',
    title: 'Test event',
    startsAt: new Date(2026, 7, 4, 18, 0).toISOString(),
    endsAt: new Date(2026, 7, 4, 19, 0).toISOString(),
    actor: 'you',
    actorName: 'You',
    label: { preset: 'Work' },
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('daysUntilDate', () => {
  it('returns 0 for today regardless of time-of-day', () => {
    expect(daysUntilDate(new Date(2026, 7, 3, 23, 59), NOW)).toBe(0);
  });

  it('returns 1 for tomorrow', () => {
    expect(daysUntilDate(new Date(2026, 7, 4, 9, 0), NOW)).toBe(1);
  });

  it('counts calendar days ahead', () => {
    expect(daysUntilDate(new Date(2026, 7, 10, 8, 0), NOW)).toBe(7);
  });

  it('clamps past dates to 0', () => {
    expect(daysUntilDate(new Date(2026, 7, 1), NOW)).toBe(0);
  });
});

describe('isUpcomingEvent', () => {
  it('is true while the event has not ended', () => {
    const ongoing = makeEvent({
      startsAt: new Date(2026, 7, 2, 9, 0).toISOString(),
      endsAt: new Date(2026, 7, 4, 9, 0).toISOString(),
    });
    expect(isUpcomingEvent(ongoing, NOW)).toBe(true);
  });

  it('is false once the event has ended', () => {
    const past = makeEvent({
      startsAt: new Date(2026, 7, 1, 9, 0).toISOString(),
      endsAt: new Date(2026, 7, 1, 10, 0).toISOString(),
    });
    expect(isUpcomingEvent(past, NOW)).toBe(false);
  });
});

describe('findCountdownEvent', () => {
  it('prefers the nearest together event over other upcoming events', () => {
    const workTomorrow = makeEvent({
      id: 'evt_work',
      startsAt: new Date(2026, 7, 4, 9, 0).toISOString(),
      endsAt: new Date(2026, 7, 4, 17, 0).toISOString(),
    });
    const togetherLater = makeEvent({
      id: 'evt_together',
      title: 'Visit',
      startsAt: new Date(2026, 7, 6, 18, 0).toISOString(),
      endsAt: new Date(2026, 7, 6, 22, 0).toISOString(),
      label: { preset: 'Other' },
      together: true,
    });

    const info = findCountdownEvent([workTomorrow, togetherLater], NOW);
    expect(info?.event.id).toBe('evt_together');
    expect(info?.daysUntil).toBe(3);
  });

  it('falls back to the nearest Date-labeled event when nothing is together', () => {
    const workTomorrow = makeEvent({
      id: 'evt_work',
      startsAt: new Date(2026, 7, 4, 9, 0).toISOString(),
      endsAt: new Date(2026, 7, 4, 17, 0).toISOString(),
    });
    const dateLater = makeEvent({
      id: 'evt_date',
      startsAt: new Date(2026, 7, 8, 19, 0).toISOString(),
      endsAt: new Date(2026, 7, 8, 22, 0).toISOString(),
      label: { preset: 'Date' },
    });

    const info = findCountdownEvent([workTomorrow, dateLater], NOW);
    expect(info?.event.id).toBe('evt_date');
    expect(info?.daysUntil).toBe(5);
  });

  it('skips events that are already over', () => {
    const pastTogether = makeEvent({
      id: 'evt_past',
      startsAt: new Date(2026, 7, 1, 9, 0).toISOString(),
      endsAt: new Date(2026, 7, 1, 10, 0).toISOString(),
      together: true,
    });
    const futureDate = makeEvent({
      id: 'evt_future',
      startsAt: new Date(2026, 7, 5, 19, 0).toISOString(),
      endsAt: new Date(2026, 7, 5, 22, 0).toISOString(),
      label: { preset: 'Date' },
    });

    const info = findCountdownEvent([pastTogether, futureDate], NOW);
    expect(info?.event.id).toBe('evt_future');
  });

  it('counts an event starting today with daysUntil 0', () => {
    const today = makeEvent({
      startsAt: new Date(2026, 7, 3, 19, 0).toISOString(),
      endsAt: new Date(2026, 7, 3, 22, 0).toISOString(),
      together: true,
    });
    const info = findCountdownEvent([today], NOW);
    expect(info?.daysUntil).toBe(0);
  });

  it('returns null when no together or Date event is upcoming', () => {
    const work = makeEvent();
    expect(findCountdownEvent([work], NOW)).toBeNull();
    expect(findCountdownEvent([], NOW)).toBeNull();
  });
});

describe('formatCountdownLabel', () => {
  it('returns null when there is nothing to count down to', () => {
    expect(formatCountdownLabel(null)).toBeNull();
  });

  it('uses warm today/tomorrow/N-days copy', () => {
    const event = makeEvent();
    expect(formatCountdownLabel({ event, daysUntil: 0 })).toBe(
      'You see each other today.'
    );
    expect(formatCountdownLabel({ event, daysUntil: 1 })).toBe(
      'You see each other tomorrow.'
    );
    expect(formatCountdownLabel({ event, daysUntil: 9 })).toBe(
      'You see each other in 9 days.'
    );
  });
});

describe('parseRelationshipStart', () => {
  it('parses date-only values as local time so the day never shifts', () => {
    const parsed = parseRelationshipStart('2026-01-31');
    expect(parsed).not.toBeNull();
    expect(parsed!.getFullYear()).toBe(2026);
    expect(parsed!.getMonth()).toBe(0);
    expect(parsed!.getDate()).toBe(31);
  });

  it('parses full ISO datetimes', () => {
    expect(parseRelationshipStart('2026-01-31T15:30:00Z')).not.toBeNull();
  });

  it('returns null for empty or invalid values', () => {
    expect(parseRelationshipStart('')).toBeNull();
    expect(parseRelationshipStart('not-a-date')).toBeNull();
  });
});

describe('daysInMonth', () => {
  it('handles short months and leap years', () => {
    expect(daysInMonth(2026, 1)).toBe(28); // Feb 2026
    expect(daysInMonth(2028, 1)).toBe(29); // Feb 2028 (leap)
    expect(daysInMonth(2026, 8)).toBe(30); // Sep
    expect(daysInMonth(2026, 0)).toBe(31); // Jan
  });
});

describe('anniversaryInMonth', () => {
  const start = new Date(2026, 5, 20); // Jun 20, 2026

  it('returns null for the start month and earlier months', () => {
    expect(anniversaryInMonth(start, 2026, 5)).toBeNull();
    expect(anniversaryInMonth(start, 2026, 4)).toBeNull();
    expect(anniversaryInMonth(start, 2025, 11)).toBeNull();
  });

  it('marks the same day-of-month each month', () => {
    const marker = anniversaryInMonth(start, 2026, 8); // Sep 2026
    expect(marker).not.toBeNull();
    expect(marker!.months).toBe(3);
    expect(marker!.kind).toBe('monthly');
    expect(marker!.date.getDate()).toBe(20);
    expect(marker!.date.getMonth()).toBe(8);
  });

  it('clamps to the last day of shorter months (Jan 31 → Feb 28)', () => {
    const jan31 = new Date(2026, 0, 31);
    const feb = anniversaryInMonth(jan31, 2026, 1);
    expect(feb!.date.getDate()).toBe(28);
    expect(feb!.months).toBe(1);

    // Leap years clamp to Feb 29 instead.
    const febLeap = anniversaryInMonth(jan31, 2028, 1);
    expect(febLeap!.date.getDate()).toBe(29);
  });

  it('clamps 31-day starts against 30-day months', () => {
    const aug31 = new Date(2026, 7, 31);
    const sep = anniversaryInMonth(aug31, 2026, 8);
    expect(sep!.date.getDate()).toBe(30);
  });

  it('emphasizes whole-year anniversaries as yearly', () => {
    const leapDayStart = new Date(2024, 1, 29); // Feb 29, 2024
    const twoYears = anniversaryInMonth(leapDayStart, 2026, 1); // Feb 2026
    expect(twoYears!.months).toBe(24);
    expect(twoYears!.kind).toBe('yearly');
    expect(twoYears!.date.getDate()).toBe(28); // clamped

    const oneYear = anniversaryInMonth(start, 2027, 5); // Jun 2027
    expect(oneYear!.months).toBe(12);
    expect(oneYear!.kind).toBe('yearly');
  });
});

describe('getAnniversaryMarkers', () => {
  it('returns an empty list without a valid start date', () => {
    expect(getAnniversaryMarkers(null, NOW)).toEqual([]);
    expect(getAnniversaryMarkers(undefined, NOW)).toEqual([]);
    expect(getAnniversaryMarkers('not-a-date', NOW)).toEqual([]);
  });

  it('returns the marker for the visible month', () => {
    const markers = getAnniversaryMarkers('2026-06-20', new Date(2026, 8, 1));
    expect(markers).toHaveLength(1);
    expect(markers[0].date.getDate()).toBe(20);
    expect(markers[0].kind).toBe('monthly');
  });

  it('returns an empty list in the start month itself', () => {
    expect(getAnniversaryMarkers('2026-08-15', new Date(2026, 7, 1))).toEqual([]);
  });
});

describe('getAnniversaryForDate', () => {
  it('matches the anniversary day exactly', () => {
    const marker = getAnniversaryForDate('2026-06-20', new Date(2026, 8, 20));
    expect(marker).not.toBeNull();
    expect(marker!.months).toBe(3);
  });

  it('matches clamped month-end anniversaries', () => {
    const marker = getAnniversaryForDate('2026-01-31', new Date(2026, 1, 28));
    expect(marker).not.toBeNull();
    expect(marker!.months).toBe(1);
  });

  it('returns null on non-anniversary days', () => {
    expect(getAnniversaryForDate('2026-06-20', new Date(2026, 8, 21))).toBeNull();
    expect(getAnniversaryForDate(null, new Date(2026, 8, 20))).toBeNull();
  });
});

describe('formatAnniversaryLabel', () => {
  it('returns null without a marker', () => {
    expect(formatAnniversaryLabel(null)).toBeNull();
  });

  it('formats monthly copy', () => {
    const date = new Date(2026, 8, 20);
    expect(formatAnniversaryLabel({ date, kind: 'monthly', months: 1 })).toBe(
      'One month together today.'
    );
    expect(formatAnniversaryLabel({ date, kind: 'monthly', months: 7 })).toBe(
      '7 months together today.'
    );
  });

  it('formats yearly copy', () => {
    const date = new Date(2026, 8, 20);
    expect(formatAnniversaryLabel({ date, kind: 'yearly', months: 12 })).toBe(
      'One year together today.'
    );
    expect(formatAnniversaryLabel({ date, kind: 'yearly', months: 36 })).toBe(
      '3 years together today.'
    );
  });
});

describe('formatAgendaDayLabel', () => {
  it('labels today and tomorrow', () => {
    expect(formatAgendaDayLabel(new Date(2026, 7, 3, 20, 0), NOW)).toBe('Today');
    expect(formatAgendaDayLabel(new Date(2026, 7, 4, 8, 0), NOW)).toBe('Tomorrow');
  });

  it('falls back to weekday, month, day', () => {
    // Aug 10, 2026 is a Monday.
    expect(formatAgendaDayLabel(new Date(2026, 7, 10, 8, 0), NOW)).toBe(
      'Mon, Aug 10'
    );
  });
});

describe('groupAgendaEvents', () => {
  it('groups upcoming events by day, sorted', () => {
    const today = makeEvent({
      id: 'evt_today',
      startsAt: new Date(2026, 7, 3, 18, 0).toISOString(),
      endsAt: new Date(2026, 7, 3, 19, 0).toISOString(),
    });
    const earlyTomorrow = makeEvent({
      id: 'evt_tomorrow_early',
      startsAt: new Date(2026, 7, 4, 9, 0).toISOString(),
      endsAt: new Date(2026, 7, 4, 10, 0).toISOString(),
    });
    const lateTomorrow = makeEvent({
      id: 'evt_tomorrow_late',
      startsAt: new Date(2026, 7, 4, 15, 0).toISOString(),
      endsAt: new Date(2026, 7, 4, 16, 0).toISOString(),
    });

    const days = groupAgendaEvents(
      [lateTomorrow, today, earlyTomorrow],
      NOW
    );

    expect(days).toHaveLength(2);
    expect(days[0].key).toBe('2026-08-03');
    expect(days[0].label).toBe('Today');
    expect(days[0].events.map((event) => event.id)).toEqual(['evt_today']);
    expect(days[1].key).toBe('2026-08-04');
    expect(days[1].label).toBe('Tomorrow');
    expect(days[1].events.map((event) => event.id)).toEqual([
      'evt_tomorrow_early',
      'evt_tomorrow_late',
    ]);
  });

  it('keeps ongoing events that started before now', () => {
    const ongoing = makeEvent({
      id: 'evt_ongoing',
      startsAt: new Date(2026, 7, 2, 9, 0).toISOString(),
      endsAt: new Date(2026, 7, 4, 9, 0).toISOString(),
    });

    const days = groupAgendaEvents([ongoing], NOW);
    expect(days).toHaveLength(1);
    expect(days[0].key).toBe('2026-08-02');
    expect(days[0].label).toBe('Sun, Aug 2');
  });

  it('drops events that already ended', () => {
    const past = makeEvent({
      startsAt: new Date(2026, 7, 1, 9, 0).toISOString(),
      endsAt: new Date(2026, 7, 1, 10, 0).toISOString(),
    });
    expect(groupAgendaEvents([past], NOW)).toEqual([]);
  });

  it('only looks ahead within the horizon', () => {
    const farAway = makeEvent({
      startsAt: new Date(2026, 8, 12, 9, 0).toISOString(), // ~40 days out
      endsAt: new Date(2026, 8, 12, 10, 0).toISOString(),
    });

    expect(groupAgendaEvents([farAway], NOW)).toEqual([]);
    expect(groupAgendaEvents([farAway], NOW, 45)).toHaveLength(1);
  });
});

describe('formatEventTimeLabel', () => {
  it('shows All day for all-day events', () => {
    const allDay = makeEvent({ allDay: true });
    expect(formatEventTimeLabel(allDay)).toBe('All day');
  });

  it('shows the localized start time otherwise', () => {
    const timed = makeEvent({
      startsAt: new Date(2026, 7, 4, 19, 0).toISOString(),
    });
    expect(formatEventTimeLabel(timed)).toBe('7:00 PM');
  });
});
