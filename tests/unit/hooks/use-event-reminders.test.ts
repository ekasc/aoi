import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { reminderIdentifier } from '@/features/calendar/event-reminders';
import { useEventReminders } from '@/features/calendar/use-event-reminders';

type FakeNotification = {
  identifier: string;
  content?: { data?: Record<string, unknown> };
};

const notificationsMock = vi.hoisted(() => ({
  granted: true,
  scheduled: [] as FakeNotification[],
  cancelled: [] as string[],
  failingCancels: new Set<string>(),
  scheduleRequests: [] as Array<{
    content: { title: string; body: string; sound: boolean; data: Record<string, unknown> };
    trigger: { type: string; date: Date };
  }>,
}));

vi.mock('expo-notifications', () => ({
  requestPermissionsAsync: async () => ({ granted: notificationsMock.granted }),
  getAllScheduledNotificationsAsync: async () => notificationsMock.scheduled,
  cancelScheduledNotificationAsync: async (identifier: string) => {
    notificationsMock.cancelled.push(identifier);
    if (notificationsMock.failingCancels.has(identifier)) {
      throw new Error('cancel failed');
    }
  },
  scheduleNotificationAsync: async (request: unknown) => {
    notificationsMock.scheduleRequests.push(
      request as (typeof notificationsMock.scheduleRequests)[number]
    );
    return `notif_${notificationsMock.scheduleRequests.length}`;
  },
  setNotificationHandler: () => {},
  SchedulableTriggerInputTypes: { DATE: 'date', TIME_INTERVAL: 'timeInterval' },
}));

function futureEvent(offsets: number[] = [30]) {
  return {
    id: 'evt_1',
    title: 'Dinner together',
    startsAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    reminderMinutesBefore: offsets,
  };
}

describe('useEventReminders', () => {
  beforeEach(() => {
    notificationsMock.granted = true;
    notificationsMock.scheduled = [];
    notificationsMock.cancelled = [];
    notificationsMock.failingCancels = new Set();
    notificationsMock.scheduleRequests = [];
  });

  it('cancels only reminders belonging to the event', async () => {
    notificationsMock.scheduled = [
      { identifier: 'n1', content: { data: { eventId: 'evt_1', offsetMinutes: 30 } } },
      { identifier: 'n2', content: { data: { eventId: 'evt_2', offsetMinutes: 30 } } },
      { identifier: 'n3', content: { data: { identifier: reminderIdentifier('evt_1', 0) } } },
      { identifier: 'n4', content: { data: { identifier: 'aoi.resurface.evt_1.60' } } },
    ];

    const { result } = renderHook(() => useEventReminders());
    await act(async () => {
      await result.current.cancelEventReminders('evt_1');
    });

    expect(notificationsMock.cancelled).toEqual(['n1', 'n3']);
  });

  it('keeps cancelling remaining reminders when one cancel fails', async () => {
    notificationsMock.scheduled = [
      { identifier: 'n1', content: { data: { eventId: 'evt_1' } } },
      { identifier: 'n2', content: { data: { eventId: 'evt_1' } } },
      { identifier: 'n3', content: { data: { eventId: 'evt_1' } } },
    ];
    notificationsMock.failingCancels.add('n2');

    const { result } = renderHook(() => useEventReminders());
    await act(async () => {
      await result.current.cancelEventReminders('evt_1');
    });

    expect(notificationsMock.cancelled).toEqual(['n1', 'n2', 'n3']);
  });

  it('clears stale triggers even when notification permission is denied', async () => {
    notificationsMock.granted = false;
    notificationsMock.scheduled = [
      { identifier: 'stale', content: { data: { eventId: 'evt_1', offsetMinutes: 30 } } },
    ];

    const { result } = renderHook(() => useEventReminders());
    await act(async () => {
      await result.current.rescheduleEventReminders(futureEvent());
    });

    // The stale trigger is cancelled without needing permission…
    expect(notificationsMock.cancelled).toEqual(['stale']);
    // …and nothing new is scheduled while permission is denied.
    expect(notificationsMock.scheduleRequests).toEqual([]);
  });

  it('replaces stale triggers with fresh silent ones when permission is granted', async () => {
    notificationsMock.granted = true;
    notificationsMock.scheduled = [
      { identifier: 'stale', content: { data: { eventId: 'evt_1', offsetMinutes: 1440 } } },
    ];

    const { result } = renderHook(() => useEventReminders());
    await act(async () => {
      await result.current.rescheduleEventReminders(futureEvent([30]));
    });

    expect(notificationsMock.cancelled).toEqual(['stale']);
    expect(notificationsMock.scheduleRequests).toHaveLength(1);
    const request = notificationsMock.scheduleRequests[0];
    expect(request.content.sound).toBe(false);
    expect(request.content.data.eventId).toBe('evt_1');
    expect(request.content.data.identifier).toBe(reminderIdentifier('evt_1', 30));
    expect(request.trigger.type).toBe('date');
    expect(request.trigger.date.getTime()).toBeGreaterThan(Date.now());
  });
});
