import { describe, expect, it } from 'vitest';

import { matchEvents, searchRange, SEARCH_WINDOW_DAYS } from '@/features/calendar/search';
import type { CalendarEvent } from '@/features/calendar/types';

function event(partial: Partial<CalendarEvent> & { id: string }): CalendarEvent {
  return {
    actor: 'you',
    actorName: 'Maya',
    createdAt: '2026-09-01T00:00:00.000Z',
    label: { preset: 'Other' },
    startsAt: '2026-09-16T10:00:00.000Z',
    endsAt: '2026-09-16T11:00:00.000Z',
    title: partial.id,
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...partial,
  };
}

describe('calendar search', () => {
  it('reads a bounded window either side of today', () => {
    const now = new Date(2026, 8, 16, 12, 0, 0);
    const { from, to } = searchRange(now);
    expect(from.getFullYear()).toBe(2024);
    expect(to.getFullYear()).toBe(2028);
    // The whole of both end days is inside the window.
    expect(from.getHours()).toBe(0);
    expect(to.getHours()).toBe(23);
    expect(SEARCH_WINDOW_DAYS).toBe(730);
  });

  it('matches on the title, case and all', () => {
    const events = [event({ id: 'Career fair' }), event({ id: 'Dinner out' })];
    expect(matchEvents(events, 'career').map((e) => e.id)).toEqual(['Career fair']);
    expect(matchEvents(events, 'CAREER').map((e) => e.id)).toEqual(['Career fair']);
  });

  it('matches on the label and the person as well as the title', () => {
    const events = [
      event({ id: 'Session', label: { preset: 'Gym' } }),
      event({ actorName: 'June', id: 'Dinner' }),
    ];
    expect(matchEvents(events, 'gym').map((e) => e.id)).toEqual(['Session']);
    expect(matchEvents(events, 'june').map((e) => e.id)).toEqual(['Dinner']);
  });

  it('takes the words in any order, so a query reads like a thought', () => {
    const events = [event({ id: 'Gym session', startsAt: '2026-09-18T18:00:00.000Z' })];
    expect(matchEvents(events, 'gym').length).toBe(1);
    expect(matchEvents(events, 'session gym').length).toBe(1);
    expect(matchEvents(events, 'gym friday').length).toBe(0);
  });

  it('returns nothing for an empty or whitespace query', () => {
    const events = [event({ id: 'Career fair' })];
    expect(matchEvents(events, '')).toEqual([]);
    expect(matchEvents(events, '   ')).toEqual([]);
  });

  it('orders results by when they happen', () => {
    const events = [
      event({ id: 'Later', startsAt: '2026-09-20T10:00:00.000Z' }),
      event({ id: 'Earlier', startsAt: '2026-09-17T10:00:00.000Z' }),
    ];
    expect(matchEvents(events, 'e').map((e) => e.id)).toEqual(['Earlier', 'Later']);
  });
});
