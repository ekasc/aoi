import { describe, expect, it } from 'vitest';

import {
  DAY_MIN_EVENT_HEIGHT,
  initialScrollHour,
  layoutDayEvents,
  minutesFromMidnight,
} from '@/features/calendar/day-layout';
import type { CalendarEvent } from '@/features/calendar/types';

function event(partial: Partial<CalendarEvent> & { id: string }): CalendarEvent {
  return {
    actor: 'you',
    actorName: 'Maya',
    createdAt: '2026-09-01T00:00:00.000Z',
    isOwn: true,
    label: { preset: 'Other' },
    startsAt: '2026-09-16T09:00:00.000Z',
    endsAt: '2026-09-16T10:00:00.000Z',
    title: partial.id,
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...partial,
  };
}

/** Builds an ISO local-time stamp, so hour math holds in any test timezone. */
function at(hour: number, minute = 0): string {
  return new Date(2026, 8, 16, hour, minute).toISOString();
}

describe('day layout', () => {
  it('reads minutes from midnight', () => {
    expect(minutesFromMidnight(at(9, 30))).toBe(570);
    expect(minutesFromMidnight('not a date')).toBeNull();
  });

  it('excludes all-day events from the timed layout', () => {
    const laidOut = layoutDayEvents([
      event({ allDay: true, id: 'payday' }),
      event({ endsAt: at(10), id: 'standup', startsAt: at(9) }),
    ]);
    expect(laidOut.map((item) => item.event.id)).toEqual(['standup']);
  });

  it('gives overlapping events their own columns', () => {
    const laidOut = layoutDayEvents([
      event({ endsAt: at(11, 30), id: 'a', startsAt: at(10) }),
      event({ endsAt: at(12), id: 'b', startsAt: at(11) }),
    ]);
    expect(laidOut.map((item) => [item.event.id, item.column])).toEqual([
      ['a', 0],
      ['b', 1],
    ]);
    expect(laidOut.every((item) => item.columnCount === 2)).toBe(true);
  });

  it('lets a later overlap reuse a freed column', () => {
    const laidOut = layoutDayEvents([
      event({ endsAt: at(11), id: 'a', startsAt: at(10) }),
      event({ endsAt: at(12), id: 'b', startsAt: at(10, 30) }),
      event({ endsAt: at(13), id: 'c', startsAt: at(11) }),
    ]);
    expect(laidOut.map((item) => [item.event.id, item.column])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 0],
    ]);
  });

  it('keeps back to back events in one column', () => {
    const laidOut = layoutDayEvents([
      event({ endsAt: at(10), id: 'a', startsAt: at(9) }),
      event({ endsAt: at(11), id: 'b', startsAt: at(10) }),
    ]);
    expect(laidOut.map((item) => item.column)).toEqual([0, 0]);
    expect(laidOut.every((item) => item.columnCount === 1)).toBe(true);
  });

  it('starts a new cluster after a gap, so counts do not leak across the day', () => {
    const laidOut = layoutDayEvents([
      event({ endsAt: at(10), id: 'morning', startsAt: at(9) }),
      event({ endsAt: at(13), id: 'a', startsAt: at(11) }),
      event({ endsAt: at(13, 30), id: 'b', startsAt: at(12) }),
    ]);
    const morning = laidOut.find((item) => item.event.id === 'morning');
    expect(morning?.columnCount).toBe(1);
    expect(
      laidOut.filter((item) => item.event.id !== 'morning').every((i) => i.columnCount === 2),
    ).toBe(true);
  });

  it('gives a zero length or reversed event a drawable body', () => {
    const laidOut = layoutDayEvents([
      event({ endsAt: at(9, 30), id: 'blip', startsAt: at(9, 30) }),
      event({ endsAt: at(9), id: 'reversed', startsAt: at(10) }),
    ]);
    expect(laidOut.every((item) => item.endMinutes - item.startMinutes >= 30)).toBe(true);
    expect(DAY_MIN_EVENT_HEIGHT).toBeGreaterThan(0);
  });

  it('opens the timeline an hour before the first plan', () => {
    expect(initialScrollHour([event({ endsAt: at(11), id: 'a', startsAt: at(10) })])).toBe(9);
    expect(initialScrollHour([event({ allDay: true, id: 'payday' })])).toBe(7);
  });
});
