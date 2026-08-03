import * as Notifications from 'expo-notifications';
import { SchedulableTriggerInputTypes } from 'expo-notifications';
import { useCallback, useMemo } from 'react';

import {
  buildEventReminderTriggers,
  reminderIdentifiersForEvent,
  type RemindableEvent,
} from '@/features/calendar/event-reminders';

export type EventRemindersApi = {
  /** Cancel any scheduled reminders for the event, then schedule fresh ones. */
  rescheduleEventReminders: (event: RemindableEvent) => Promise<void>;
  /** Cancel all scheduled reminders for an event id (delete path). */
  cancelEventReminders: (eventId: string) => Promise<void>;
};

/**
 * Quiet local reminders for calendar events. Mirrors the resurface
 * notification patterns: permissions are requested once and a denial means
 * we silently skip; every failure is swallowed (tender-error policy); and
 * notifications never make a sound.
 */
export function useEventReminders(): EventRemindersApi {
  const cancelEventReminders = useCallback(async (eventId: string) => {
    try {
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      const identifiers = reminderIdentifiersForEvent(scheduled, eventId);
      // allSettled: one failed cancel must never leave the others scheduled.
      await Promise.allSettled(
        identifiers.map((identifier) =>
          Notifications.cancelScheduledNotificationAsync(identifier)
        )
      );
    } catch {
      // Deliberately silent: reminders must never become errors.
    }
  }, []);

  const rescheduleEventReminders = useCallback(
    async (event: RemindableEvent) => {
      try {
        // Cancelling needs no permission, so clear stale triggers first —
        // otherwise a revoked permission would leak old reminders on edits
        // and deletes.
        await cancelEventReminders(event.id);

        const permission = await Notifications.requestPermissionsAsync();
        if (!permission.granted) {
          return;
        }

        const triggers = buildEventReminderTriggers(event);
        await Promise.allSettled(
          triggers.map((trigger) =>
            Notifications.scheduleNotificationAsync({
              content: {
                title: trigger.title,
                body: trigger.body,
                sound: false,
                data: {
                  eventId: trigger.eventId,
                  offsetMinutes: trigger.offsetMinutes,
                  identifier: trigger.identifier,
                },
              },
              trigger: {
                type: SchedulableTriggerInputTypes.DATE,
                date: trigger.fireDate,
              },
            })
          )
        );
      } catch {
        // Deliberately silent: reminders must never become errors.
      }
    },
    [cancelEventReminders]
  );

  return useMemo(
    () => ({ rescheduleEventReminders, cancelEventReminders }),
    [cancelEventReminders, rescheduleEventReminders]
  );
}
