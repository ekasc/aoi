import { describe, expect, it } from 'vitest';

import {
  buildEventReminderTriggers,
  formatReminderBody,
  formatReminderDayPhrase,
  isReminderForEvent,
  REMINDER_IDENTIFIER_PREFIX,
  reminderIdentifier,
  reminderIdentifiersForEvent,
  type RemindableEvent,
  type ScheduledReminderLike,
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
    expect(formatReminderBody(event, NOW)).toBe('Tomorrow at 9:30 AM, together');
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
    expect(formatReminderBody(together, NOW)).toBe('Today, all day, together');
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

describe('isReminderForEvent', () => {
  it('matches notifications whose data carries the event id', () => {
    const notification: ScheduledReminderLike = {
      identifier: 'native-id-1',
      content: { data: { eventId: 'evt_1', offsetMinutes: 30 } },
    };
    expect(isReminderForEvent(notification, 'evt_1')).toBe(true);
    expect(isReminderForEvent(notification, 'evt_2')).toBe(false);
  });

  it('matches notifications whose data identifier encodes the event id', () => {
    const notification: ScheduledReminderLike = {
      identifier: 'native-id-2',
      content: { data: { identifier: reminderIdentifier('evt_1', 0) } },
    };
    expect(isReminderForEvent(notification, 'evt_1')).toBe(true);
    expect(isReminderForEvent(notification, 'evt_10')).toBe(false);
  });

  it('never matches reminders from other subsystems or events', () => {
    const otherSubsystem: ScheduledReminderLike = {
      identifier: 'native-id-3',
      content: { data: { identifier: 'aoi.resurface.evt_1.60' } },
    };
    const otherEvent: ScheduledReminderLike = {
      identifier: 'native-id-4',
      content: { data: { eventId: 'evt_9', identifier: reminderIdentifier('evt_9', 10) } },
    };
    expect(isReminderForEvent(otherSubsystem, 'evt_1')).toBe(false);
    expect(isReminderForEvent(otherEvent, 'evt_1')).toBe(false);
  });

  it('treats missing content or data as not a match', () => {
    expect(isReminderForEvent({ identifier: 'native-id-5' }, 'evt_1')).toBe(false);
    expect(
      isReminderForEvent({ identifier: 'native-id-6', content: {} }, 'evt_1')
    ).toBe(false);
    expect(
      isReminderForEvent({ identifier: 'native-id-7', content: { data: null } }, 'evt_1')
    ).toBe(false);
    // A non-string identifier in the payload must not crash the matcher.
    expect(
      isReminderForEvent(
        { identifier: 'native-id-8', content: { data: { identifier: 42 } } },
        'evt_1'
      )
    ).toBe(false);
  });
});

describe('reminderIdentifiersForEvent', () => {
  it('returns only the native identifiers belonging to the event', () => {
    const scheduled: ScheduledReminderLike[] = [
      { identifier: 'n1', content: { data: { eventId: 'evt_1' } } },
      { identifier: 'n2', content: { data: { eventId: 'evt_2' } } },
      { identifier: 'n3', content: { data: { identifier: reminderIdentifier('evt_1', 30) } } },
      { identifier: 'n4', content: { data: { identifier: 'aoi.resurface.evt_1.60' } } },
      { identifier: 'n5' },
    ];
    expect(reminderIdentifiersForEvent(scheduled, 'evt_1')).toEqual(['n1', 'n3']);
    expect(reminderIdentifiersForEvent(scheduled, 'evt_missing')).toEqual([]);
  });
});
