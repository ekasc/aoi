import { describe, it, expect } from 'vitest';
import { WEEKLY_RECURRENCE_INSTANCE_COUNT } from '@aoi/shared';

import { buildWeeklyRecurrenceInstances } from '@/features/calendar/recurrence';
import type { CreateCalendarEventInput } from '@/features/calendar/types';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function makeInput(overrides: Partial<CreateCalendarEventInput> = {}): CreateCalendarEventInput {
  return {
    title: 'Sunday market',
    startsAt: new Date('2026-08-09T10:00:00.000Z').toISOString(),
    endsAt: new Date('2026-08-09T11:30:00.000Z').toISOString(),
    actor: 'you',
    actorName: 'You',
    label: { preset: 'Date' },
    recurrence: 'weekly',
    ...overrides,
  };
}

describe('buildWeeklyRecurrenceInstances', () => {
  it('expands into a bounded horizon of concrete weekly instances', () => {
    const instances = buildWeeklyRecurrenceInstances(makeInput());

    expect(instances).toHaveLength(WEEKLY_RECURRENCE_INSTANCE_COUNT);
    expect(WEEKLY_RECURRENCE_INSTANCE_COUNT).toBe(13);
  });

  it('keeps the original as the first instance and steps exactly one week', () => {
    const input = makeInput();
    const instances = buildWeeklyRecurrenceInstances(input);

    expect(instances[0].startsAt).toBe(input.startsAt);
    expect(instances[0].endsAt).toBe(input.endsAt);

    const firstStart = new Date(instances[0].startsAt).getTime();
    instances.forEach((instance, week) => {
      expect(new Date(instance.startsAt).getTime()).toBe(firstStart + week * WEEK_MS);
    });
  });

  it('preserves the duration week over week', () => {
    const instances = buildWeeklyRecurrenceInstances(makeInput());
    const durationMs = 90 * 60 * 1000;

    for (const instance of instances) {
      expect(new Date(instance.endsAt).getTime() - new Date(instance.startsAt).getTime())
        .toBe(durationMs);
    }
  });

  it('carries the weekly marker and every shared field into each instance', () => {
    const input = makeInput({
      allDay: false,
      together: true,
      reminderMinutesBefore: [30],
    });
    const instances = buildWeeklyRecurrenceInstances(input);

    for (const instance of instances) {
      expect(instance.recurrence).toBe('weekly');
      expect(instance.title).toBe(input.title);
      expect(instance.actor).toBe('you');
      expect(instance.label).toEqual({ preset: 'Date' });
      expect(instance.together).toBe(true);
      expect(instance.reminderMinutesBefore).toEqual([30]);
    }
  });

  it('honors an explicit horizon length', () => {
    const instances = buildWeeklyRecurrenceInstances(makeInput(), 3);
    expect(instances).toHaveLength(3);
  });
});
