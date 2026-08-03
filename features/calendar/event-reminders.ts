import type { CalendarEvent } from '@/features/calendar/types';

/**
 * Pure reminder-building logic for calendar events.
 *
 * Kept separate from the notification hook so it can be unit-tested without
 * touching expo-notifications. The hook (`use-event-reminders.ts`) is a thin,
 * swallow-all wrapper around these builders.
 */

/** The event fields reminders actually care about. */
export type RemindableEvent = Pick<CalendarEvent, 'id' | 'title' | 'startsAt'> &
  Partial<
    Pick<CalendarEvent, 'allDay' | 'together' | 'reminderMinutesBefore'>
  >;

export type EventReminderTrigger = {
  /** Deterministic id derived from event id + offset, used for exact cancels. */
  identifier: string;
  eventId: string;
  offsetMinutes: number;
  fireDate: Date;
  title: string;
  body: string;
};

export const REMINDER_IDENTIFIER_PREFIX = 'aoi.cal.reminder';

/**
 * Deterministic notification identifier for a given (event, offset) pair so
 * rescheduling/cancellation is exact.
 */
export function reminderIdentifier(eventId: string, offsetMinutes: number): string {
  return `${REMINDER_IDENTIFIER_PREFIX}.${eventId}.${offsetMinutes}`;
}

/** Minimal shape of a scheduled notification needed for matching. */
export type ScheduledReminderLike = {
  identifier: string;
  content?: { data?: Record<string, unknown> | null } | null;
};

/**
 * True when a scheduled notification belongs to an event — either its data
 * payload carries the event id, or its deterministic identifier encodes it.
 */
export function isReminderForEvent(
  notification: ScheduledReminderLike,
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

/** Identifiers of the scheduled notifications that belong to an event. */
export function reminderIdentifiersForEvent(
  notifications: readonly ScheduledReminderLike[],
  eventId: string
): string[] {
  return notifications
    .filter((notification) => isReminderForEvent(notification, eventId))
    .map((notification) => notification.identifier);
}

function capitalize(value: string): string {
  if (!value) {
    return value;
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function isSameDayLocal(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function isNextDayLocal(target: Date, now: Date): boolean {
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  return isSameDayLocal(target, tomorrow);
}

/** Short, warm day phrase relative to now: "Tonight", "Tomorrow", "Aug 3". */
export function formatReminderDayPhrase(startsAt: Date, now: Date): string {
  if (isSameDayLocal(startsAt, now)) {
    return startsAt.getHours() >= 17 ? 'Tonight' : 'Today';
  }
  if (isNextDayLocal(startsAt, now)) {
    return 'Tomorrow';
  }
  return startsAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatReminderTime(startsAt: Date): string {
  return startsAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/**
 * Warm, brief reminder body — anticipation, not clinginess.
 * e.g. "Tonight at 7:00 PM — together", "Tomorrow, all day".
 */
export function formatReminderBody(event: RemindableEvent, now: Date): string {
  const startsAt = new Date(event.startsAt);
  const dayPhrase = formatReminderDayPhrase(startsAt, now);

  if (event.allDay) {
    const together = event.together ? ' — together' : '';
    return `${dayPhrase}, all day${together}`;
  }

  const timePhrase = `at ${formatReminderTime(startsAt)}`;
  const together = event.together ? ' — together' : '';
  return `${dayPhrase} ${timePhrase}${together}`;
}

/**
 * Build the set of future reminder triggers for an event. One trigger per
 * (event, offset); offsets that would already have fired are skipped so we
 * never schedule into the past.
 */
export function buildEventReminderTriggers(
  event: RemindableEvent,
  now: Date = new Date()
): EventReminderTrigger[] {
  const offsets = event.reminderMinutesBefore ?? [];
  const startsAt = new Date(event.startsAt);

  if (offsets.length === 0 || Number.isNaN(startsAt.getTime())) {
    return [];
  }

  const body = formatReminderBody(event, now);
  const seen = new Set<string>();
  const triggers: EventReminderTrigger[] = [];

  for (const offset of offsets) {
    if (!Number.isFinite(offset) || offset < 0) {
      continue;
    }

    const fireDate = new Date(startsAt.getTime() - offset * 60_000);
    // Only schedule reminders that are still in the future.
    if (fireDate.getTime() <= now.getTime()) {
      continue;
    }

    const identifier = reminderIdentifier(event.id, offset);
    if (seen.has(identifier)) {
      continue;
    }
    seen.add(identifier);

    triggers.push({
      identifier,
      eventId: event.id,
      offsetMinutes: offset,
      fireDate,
      title: event.title,
      body,
    });
  }

  return triggers.sort(
    (left, right) => left.fireDate.getTime() - right.fireDate.getTime()
  );
}
