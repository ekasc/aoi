import { WEEKLY_RECURRENCE_INSTANCE_COUNT } from '@aoi/shared';

import type { CreateCalendarEventInput } from '@/features/calendar/types';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * SIMPLE WEEKLY ONLY — mirrors the API exactly: a weekly event expands into
 * a bounded horizon of CONCRETE weekly instances (the original included).
 * Instances are ordinary events — editing or deleting one never touches the
 * rest (no series operations).
 */
export function buildWeeklyRecurrenceInstances(
  input: CreateCalendarEventInput,
  count: number = WEEKLY_RECURRENCE_INSTANCE_COUNT
): CreateCalendarEventInput[] {
  const startMs = new Date(input.startsAt).getTime();
  const endMs = new Date(input.endsAt).getTime();

  return Array.from({ length: count }, (_, week) => ({
    ...input,
    // Each instance stands alone: the marker stays, but nothing links them
    // behaviorally.
    recurrence: 'weekly' as const,
    startsAt: new Date(startMs + week * WEEK_MS).toISOString(),
    endsAt: new Date(endMs + week * WEEK_MS).toISOString(),
  }));
}
