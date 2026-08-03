import { describe, expect, it } from 'vitest';

import {
  buildEventReminderTriggers,
  formatReminderBody,
  formatReminderDayPhrase,
  REMINDER_IDENTIFIER_PREFIX,
  reminderIdentifier,
  type RemindableEvent,
} from '@/features/calendar/event-reminders';

// Fixed "now": Mon Aug 3, 2026 at noon local time.
const NOW = new Date(2026, 7, 3, 12, 0, 0);

function makeRemindable(overrides: Partial<RemindableEvent> = {}): RemindableEvent {
  return {
    id: 'evt_1',
    title: 'Dinner together',
    startsAt: new Date(2026, 7, 3, 19, 0).toISOString(),
    ...overrides,
  };
}

describe('reminderIdentifier', () => {
  it('derives a deterministic id from event id + offset', () => {
    expect(reminderIdentifier('evt_1', 30)).toBe('aoi.cal.reminder.evt_1.30');
    expect(reminderIdentifier('evt_1', 0)).toBe('aoi.cal.reminder.evt_1.0');
  });

  it('exposes the shared prefix constant', () => {
    expect(REMINDER_IDENTIFIER_PREFIX).toBe('aoi.cal.reminder');
    expect(reminderIdentifier('evt_1', 10).startsWith(`${REMINDER_IDENTIFIER_PREFIX}.`)).toBe(true);
  });
});

describe('formatReminderDayPhrase', () => {
  it('says Today before evening and Tonight from 5pm on', () => {
    expect(formatReminderDayPhrase(new Date(2026, 7, 3, 16, 59), NOW)).toBe('Today');
    expect(formatReminderDayPhrase(new Date(2026, 7, 3, 17, 0), NOW)).toBe('Tonight');
    expect(formatReminderDayPhrase(new Date(2026, 7, 3, 20, 30), NOW)).toBe('Tonight');
  });

  it('says Tomorrow for the next calendar day', () => {
    expect(formatReminderDayPhrase(new Date(2026, 7, 4, 9, 0), NOW)).toBe('Tomorrow');
  });

  it('falls back to a short month-day phrase', () => {
    expect(formatReminderDayPhrase(new Date(2026, 7, 5, 9, 0), NOW)).toBe('Aug 5');
  });
});

describe('formatReminderBody', () => {
  it('includes the time for timed events', () => {
    const event = makeRemindable({
      startsAt: new Date(2026, 7, 3, 19, 0).toISOString(),
    });
    expect(formatReminderBody(event, NOW)).toBe('Tonight at 7:00 PM');
  });

  it('adds the together suffix when marked together', () => {
    const event = makeRemindable({
      startsAt: new Date(2026, 7, 4, 9, 30).toISOString(),
      together: true,
    });
    expect(formatReminderBody(event, NOW)).toBe('Tomorrow at 9:30 AM — together');
  });

  it('uses all-day phrasing without a time', () => {
    const plain = makeRemindable({
      startsAt: new Date(2026, 7, 4, 0, 0).toISOString(),
      allDay: true,
    });
    expect(formatReminderBody(plain, NOW)).toBe('Tomorrow, all day');

    const together = makeRemindable({
      startsAt: new Date(2026, 7, 3, 0, 0).toISOString(),
      allDay: true,
      together: true,
    });
    expect(formatReminderBody(together, NOW)).toBe('Today, all day — together');
  });
});

describe('buildEventReminderTriggers', () => {
  it('returns nothing without offsets', () => {
    expect(buildEventReminderTriggers(makeRemindable(), NOW)).toEqual([]);
    expect(buildEventReminderTriggers(makeRemindable({ reminderMinutesBefore: [] }), NOW)).toEqual([]);
  });

  it('returns nothing for an invalid start date', () => {
    const event = makeRemindable({
      startsAt: 'not-a-date',
      reminderMinutesBefore: [10],
    });
    expect(buildEventReminderTriggers(event, NOW)).toEqual([]);
  });

  it('builds one trigger per future offset with exact fire dates', () => {
    const startsAt = new Date(2026, 7, 3, 19, 0); // 7 hours ahead
    const event = makeRemindable({
      startsAt: startsAt.toISOString(),
      reminderMinutesBefore: [30, 0],
    });

    const triggers = buildEventReminderTriggers(event, NOW);
    expect(triggers).toHaveLength(2);

    // Sorted by fire date: the 30-minutes-before reminder fires first.
    expect(triggers[0].identifier).toBe('aoi.cal.reminder.evt_1.30');
    expect(triggers[0].fireDate.getTime()).toBe(startsAt.getTime() - 30 * 60_000);
    expect(triggers[1].identifier).toBe('aoi.cal.reminder.evt_1.0');
    expect(triggers[1].fireDate.getTime()).toBe(startsAt.getTime());

    for (const trigger of triggers) {
      expect(trigger.eventId).toBe('evt_1');
      expect(trigger.title).toBe('Dinner together');
      expect(trigger.body).toBe('Tonight at 7:00 PM');
    }
  });

  it('never schedules reminders into the past', () => {
    const startsAt = new Date(2026, 7, 3, 19, 0);
    const event = makeRemindable({
      startsAt: startsAt.toISOString(),
      // 1440 minutes before would already have fired yesterday.
      reminderMinutesBefore: [1440, 10],
    });

    const triggers = buildEventReminderTriggers(event, NOW);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].offsetMinutes).toBe(10);
  });

  it('skips a reminder that would fire exactly now', () => {
    const startsAt = new Date(NOW.getTime() + 10 * 60_000);
    const event = makeRemindable({
      startsAt: startsAt.toISOString(),
      reminderMinutesBefore: [10],
    });
    expect(buildEventReminderTriggers(event, NOW)).toEqual([]);
  });

  it('ignores negative and non-finite offsets', () => {
    const event = makeRemindable({
      startsAt: new Date(2026, 7, 3, 19, 0).toISOString(),
      reminderMinutesBefore: [-5, Number.NaN, 10],
    });

    const triggers = buildEventReminderTriggers(event, NOW);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].offsetMinutes).toBe(10);
  });

  it('dedupes repeated offsets', () => {
    const event = makeRemindable({
      startsAt: new Date(2026, 7, 3, 19, 0).toISOString(),
      reminderMinutesBefore: [10, 10],
    });
    expect(buildEventReminderTriggers(event, NOW)).toHaveLength(1);
  });
});
