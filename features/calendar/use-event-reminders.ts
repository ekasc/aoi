import * as Notifications from 'expo-notifications';
import { SchedulableTriggerInputTypes } from 'expo-notifications';
import { useCallback, useMemo } from 'react';

import {
  buildEventReminderTriggers,
  REMINDER_IDENTIFIER_PREFIX,
  type RemindableEvent,
} from '@/features/calendar/event-reminders';

export type EventRemindersApi = {
  /** Cancel any scheduled reminders for the event, then schedule fresh ones. */
  rescheduleEventReminders: (event: RemindableEvent) => Promise<void>;
  /** Cancel all scheduled reminders for an event id (delete path). */
  cancelEventReminders: (eventId: string) => Promise<void>;
};

function isReminderForEvent(
  notification: Notifications.NotificationRequest,
  eventId: string
): boolean {
  const data = notification.content?.data ?? {};
  if (data.eventId === eventId) {
    return true;
  }
  const identifier = data.identifier;
  return (
    typeof identifier === 'string' &&
    identifier.startsWith(`${REMINDER_IDENTIFIER_PREFIX}.${eventId}.`)
  );
}

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
      const matches = scheduled.filter((notification) =>
        isReminderForEvent(notification, eventId)
      );
      await Promise.all(
        matches.map((notification) =>
          Notifications.cancelScheduledNotificationAsync(notification.identifier)
        )
      );
    } catch {
      // Deliberately silent: reminders must never become errors.
    }
  }, []);

  const rescheduleEventReminders = useCallback(
    async (event: RemindableEvent) => {
      try {
        const permission = await Notifications.requestPermissionsAsync();
        if (!permission.granted) {
          return;
        }

        // Exact rescheduling: clear every previous reminder for this event
        // (including offsets that were removed), then schedule the future ones.
        await cancelEventReminders(event.id);

        const triggers = buildEventReminderTriggers(event);
        await Promise.all(
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
