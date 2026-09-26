import { describe, expect, it, vi } from 'vitest';

import { WEEKLY_RECURRENCE_INSTANCE_COUNT } from '@aoi/shared';

import {
  applyCalendarSeed,
  CALENDAR_SEED_VERSION,
  createCalendarSeed,
  expandSeedInstances,
  type CalendarSeedDeps,
} from '@/features/calendar/calendar-seed';
import type { CreateCalendarEventInput } from '@/features/calendar/types';

// A fixed clock, so the seeded offsets are the same on every run.
const NOW = new Date(2026, 8, 17, 14, 30, 0, 0);

const seed = createCalendarSeed(NOW);

describe('createCalendarSeed', () => {
  it('gives every row a usable span', () => {
    expect(seed.length).toBeGreaterThan(10);
    for (const event of seed) {
      const start = new Date(event.startsAt).getTime();
      const end = new Date(event.endsAt).getTime();
      expect(Number.isNaN(start), event.title).toBe(false);
      expect(end, event.title).toBeGreaterThan(start);
    }
  });

  it('marks all-day rows as all day and gives them a whole day', () => {
    const allDay = seed.filter((event) => event.allDay);
    // The grid and the agenda read this flag to put the event in its own
    // lane; an unmarked row is drawn as a 24-hour block in the hour track.
    expect(allDay.length).toBeGreaterThan(0);
    for (const event of allDay) {
      const start = new Date(event.startsAt);
      const end = new Date(event.endsAt);
      expect(start.getHours()).toBe(0);
      expect(start.getMinutes()).toBe(0);
      expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
    }
  });

  it('covers both owners and shared plans, across several weeks', () => {
    expect(seed.some((event) => event.actor === 'you')).toBe(true);
    expect(seed.some((event) => event.actor === 'partner')).toBe(true);
    expect(seed.some((event) => event.together)).toBe(true);

    const firstWeek = seed.filter((event) => {
      const days = (new Date(event.startsAt).getTime() - NOW.getTime()) / 86_400_000;
      return days >= 0 && days <= 7;
    });
    expect(firstWeek.length).toBeGreaterThan(0);
    expect(seed.some((event) => new Date(event.startsAt).getTime() > NOW.getTime() + 14 * 86_400_000)).toBe(
      true,
    );
  });

  it('answers every row with the shape the repository writes', () => {
    for (const event of seed) {
      expect(event.title.trim(), event.title).not.toBe('');
      expect(event.actorName.trim(), event.title).not.toBe('');
      expect(['you', 'partner']).toContain(event.actor);
      expect(['Work', 'Gym', 'Travel', 'Date', 'Family', 'Other']).toContain(
        event.label.preset,
      );
    }
  });
});

describe('expandSeedInstances', () => {
  it('expands weekly fixtures into tracked concrete instances', () => {
    const expanded = expandSeedInstances(createCalendarSeed(NOW));
    const weeklyCount = seed.filter((event) => event.recurrence === 'weekly').length;
    expect(weeklyCount).toBeGreaterThan(0);
    // Each weekly fixture becomes a full horizon of ordinary events, so the
    // planter knows every row id it created.
    expect(expanded).toHaveLength(
      seed.length - weeklyCount + weeklyCount * WEEKLY_RECURRENCE_INSTANCE_COUNT
    );
    expect(expanded.some((event) => event.recurrence === 'weekly')).toBe(false);

    const series = expanded.filter((event) => event.title === 'Morning deep work');
    expect(series).toHaveLength(WEEKLY_RECURRENCE_INSTANCE_COUNT);
    for (let index = 1; index < series.length; index += 1) {
      const gap =
        new Date(series[index].startsAt).getTime() -
        new Date(series[index - 1].startsAt).getTime();
      expect(gap).toBe(7 * 86_400_000);
    }
  });
});

describe('applyCalendarSeed', () => {
  function makeDeps(overrides: Partial<CalendarSeedDeps> = {}) {
    const planted: CreateCalendarEventInput[] = [];
    const removed: string[] = [];
    let saved: { version: number; rowIds: string[] } | null = null;
    let counter = 0;
    return {
      planted,
      removed,
      saved: () => saved,
      deps: {
        loadMarker: async () => null,
        saveMarker: async (marker: { version: number; rowIds: string[] }) => {
          saved = marker;
        },
        removeById: async (id: string) => {
          removed.push(id);
        },
        plant: async (input: CreateCalendarEventInput) => {
          planted.push(input);
          counter += 1;
          return `row-${counter}`;
        },
        now: NOW,
        ...overrides,
      } satisfies CalendarSeedDeps,
    };
  }

  it('does nothing when the device already planted this version', async () => {
    const harness = makeDeps({
      loadMarker: async () => ({ version: CALENDAR_SEED_VERSION, rowIds: ['row-1'] }),
    });
    await applyCalendarSeed(harness.deps);
    expect(harness.planted).toHaveLength(0);
    expect(harness.removed).toHaveLength(0);
    expect(harness.saved()).toBeNull();
  });

  it('removes the previous generation, then plants and records the new one', async () => {
    const harness = makeDeps({
      loadMarker: async () => ({ version: 1, rowIds: ['old-1', 'old-2'] }),
    });
    await applyCalendarSeed(harness.deps);
    expect(harness.removed).toEqual(['old-1', 'old-2']);
    // Every planted row is a concrete event with a recorded id.
    expect(harness.planted.length).toBeGreaterThan(10);
    expect(harness.planted.some((event) => event.recurrence === 'weekly')).toBe(false);
    const saved = harness.saved();
    expect(saved?.version).toBe(CALENDAR_SEED_VERSION);
    expect(saved?.rowIds).toHaveLength(harness.planted.length);
  });

  it('treats already-deleted rows as gone, not as failures', async () => {
    const removeById = vi.fn(async () => {
      throw new Error('no such row');
    });
    const harness = makeDeps({
      loadMarker: async () => ({ version: 1, rowIds: ['gone-1'] }),
      removeById,
    });
    await applyCalendarSeed(harness.deps);
    expect(removeById).toHaveBeenCalledWith('gone-1');
    expect(harness.planted.length).toBeGreaterThan(0);
    expect(harness.saved()?.version).toBe(CALENDAR_SEED_VERSION);
  });

  it('records a partial plant so the next launch cleans up instead of duplicating', async () => {
    const harness = makeDeps({
      plant: async (input: CreateCalendarEventInput) => {
        if (harness.planted.length >= 3) {
          throw new Error('disk full');
        }
        harness.planted.push(input);
        return `row-${harness.planted.length}`;
      },
    });
    await expect(applyCalendarSeed(harness.deps)).rejects.toThrow('disk full');
    const saved = harness.saved();
    expect(saved?.version).toBe(CALENDAR_SEED_VERSION);
    expect(saved?.rowIds).toHaveLength(3);
  });
});
