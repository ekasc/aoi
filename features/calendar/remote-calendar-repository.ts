import { apiFetch } from '@/features/api-client';
import type {
  CalendarEvent,
  CreateCalendarEventInput,
  UpdateCalendarEventInput,
} from '@/features/calendar/types';

/** Convert API response to the frontend's CalendarEvent shape */
function toCalendarEvent(apiEvent: CalendarEvent): CalendarEvent {
  return apiEvent;
}

export async function initCalendarDb(): Promise<void> {
  // No local DB init needed when using remote API
}

export async function countCalendarEvents(): Promise<number> {
  // Not meaningful for remote — return 0 to skip seed
  return 1;
}

export async function listEventsInMonth(
  monthStartIso: string,
  monthEndIso: string
): Promise<CalendarEvent[]> {
  const from = monthStartIso;
  const to = monthEndIso;
  const events = await apiFetch<CalendarEvent[]>(
    `/v1/spaces/current/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  );
  return events.map(toCalendarEvent);
}

export async function listEventsForDay(
  dayStartIso: string,
  dayEndIso: string
): Promise<CalendarEvent[]> {
  // Use the same date-range endpoint with a single-day window
  const from = dayStartIso;
  const to = dayEndIso;
  const events = await apiFetch<CalendarEvent[]>(
    `/v1/spaces/current/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  );
  return events.map(toCalendarEvent);
}

/**
 * Events that overlap a time window — used by the agenda lane. Mirrors the
 * local repository's range query against the same API endpoint.
 */
export async function listEventsInRange(
  fromIso: string,
  toIso: string
): Promise<CalendarEvent[]> {
  const events = await apiFetch<CalendarEvent[]>(
    `/v1/spaces/current/calendar/events?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`
  );
  return events.map(toCalendarEvent);
}

export async function getEventById(eventId: string): Promise<CalendarEvent | null> {
  try {
    const event = await apiFetch<CalendarEvent>(`/v1/calendar/events/${eventId}`);
    return toCalendarEvent(event);
  } catch {
    return null;
  }
}

export async function insertEvent(input: CreateCalendarEventInput): Promise<string> {
  const event = await apiFetch<CalendarEvent>('/v1/spaces/current/calendar/events', {
    method: 'POST',
    body: JSON.stringify({
      title: input.title,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      actor: input.actor,
      actorName: input.actorName,
      label: input.label,
      reminderMinutesBefore: input.reminderMinutesBefore,
      allDay: input.allDay,
      together: input.together,
      // 'weekly' expands into concrete instances server-side.
      recurrence: input.recurrence,
    }),
  });
  return event.id;
}

export async function updateEvent(input: UpdateCalendarEventInput): Promise<void> {
  await apiFetch(`/v1/calendar/events/${input.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      title: input.title,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      label: input.label,
      // Send reminderMinutesBefore even when empty so edits can clear reminders.
      reminderMinutesBefore: input.reminderMinutesBefore ?? [],
      allDay: input.allDay,
      together: input.together,
      // Applies to this single instance only — never regenerates a series.
      recurrence: input.recurrence,
    }),
  });
}

export async function deleteEvent(eventId: string): Promise<void> {
  await apiFetch(`/v1/calendar/events/${eventId}`, {
    method: 'DELETE',
  });
}
