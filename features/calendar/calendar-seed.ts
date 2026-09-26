import AsyncStorage from '@react-native-async-storage/async-storage';

import { buildWeeklyRecurrenceInstances } from '@/features/calendar/recurrence';
import type { CreateCalendarEventInput } from '@/features/calendar/types';

/**
 * Bump this whenever the fixtures above change. Devices remember the version
 * they planted, so a bump re-plants the seed on existing installs instead of
 * only on empty tables. Version 1 is the original unversioned seed.
 */
export const CALENDAR_SEED_VERSION = 2;

/**
 * The stub calendar's fixtures: a month with something on most days, so the
 * grid, the agenda, and search are alive before anything has been planned.
 *
 * Days are offsets from `now`, so the seed always lands on the month the
 * reader is looking at, and it covers every shape the screens draw — yours,
 * theirs, and shared; timed and all day; one-off and weekly.
 */
export function createCalendarSeed(now = new Date()): CreateCalendarEventInput[] {
  const day = (offset: number) => {
    const date = new Date(now);
    date.setDate(date.getDate() + offset);
    return date;
  };

  /** A time on a day, `offset` days from today. */
  const at = (offset: number, hours: number, minutes = 0) => {
    const date = day(offset);
    date.setHours(hours, minutes, 0, 0);
    return date.toISOString();
  };

  /** All-day events run midnight to midnight, the way the composer writes them. */
  const allDay = (offset: number) => {
    const start = day(offset);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { allDay: true, startsAt: start.toISOString(), endsAt: end.toISOString() };
  };

  return [
    {
      title: 'Farmers market',
      startsAt: at(-4, 9),
      endsAt: at(-4, 11),
      actor: 'you',
      actorName: 'You',
      label: { preset: 'Family' },
      location: 'Trout Lake',
    },
    {
      title: 'Pasta night',
      startsAt: at(-2, 19),
      endsAt: at(-2, 21),
      actor: 'partner',
      actorName: 'Alex',
      label: { preset: 'Date' },
      together: true,
    },
    {
      title: 'Morning deep work',
      startsAt: at(0, 9),
      endsAt: at(0, 10, 30),
      actor: 'you',
      actorName: 'You',
      label: { preset: 'Work' },
      location: 'Home office',
      // Weekly, so the grid has a spine across the whole month rather than
      // four isolated weeks.
      recurrence: 'weekly',
    },
    {
      title: 'Lunch with the team',
      startsAt: at(0, 12, 30),
      endsAt: at(0, 13, 30),
      actor: 'you',
      actorName: 'You',
      label: { preset: 'Work' },
      location: 'Noodle Bar',
    },
    {
      title: 'Dinner reservation',
      startsAt: at(0, 18, 30),
      endsAt: at(0, 20),
      actor: 'partner',
      actorName: 'Alex',
      label: { preset: 'Date' },
      location: 'Bao Bei, Chinatown',
      together: true,
    },
    {
      title: 'Gym',
      startsAt: at(1, 7),
      endsAt: at(1, 8),
      actor: 'partner',
      actorName: 'Alex',
      label: { preset: 'Gym' },
      location: 'Community centre',
      recurrence: 'weekly',
    },
    {
      title: 'Movie night',
      startsAt: at(1, 20),
      endsAt: at(1, 22, 30),
      actor: 'you',
      actorName: 'You',
      label: { preset: 'Date' },
      together: true,
    },
    {
      ...allDay(2),
      title: 'Trip to the coast',
      actor: 'partner',
      actorName: 'Alex',
      label: { preset: 'Travel' },
      location: 'Ucluelet',
      together: true,
    },
    {
      title: 'Sprint review',
      startsAt: at(3, 11),
      endsAt: at(3, 12),
      actor: 'you',
      actorName: 'You',
      label: { preset: 'Work' },
    },
    {
      title: 'Dentist',
      startsAt: at(4, 14),
      endsAt: at(4, 15),
      actor: 'partner',
      actorName: 'Alex',
      label: { preset: 'Other' },
      location: 'Kingsway Dental',
    },
    {
      title: 'Late shift',
      startsAt: at(4, 20),
      endsAt: at(4, 23),
      actor: 'partner',
      actorName: 'Alex',
      label: { preset: 'Work' },
    },
    {
      title: 'Book club',
      startsAt: at(6, 18, 30),
      endsAt: at(6, 20),
      actor: 'you',
      actorName: 'You',
      label: { preset: 'Other' },
      location: 'Massy Books',
    },
    {
      title: 'Climbing session',
      startsAt: at(7, 7),
      endsAt: at(7, 9),
      actor: 'partner',
      actorName: 'Alex',
      label: { preset: 'Gym' },
      together: true,
    },
    {
      ...allDay(9),
      title: 'Visit family',
      actor: 'you',
      actorName: 'You',
      label: { preset: 'Family' },
      location: 'Victoria',
      together: true,
    },
    {
      title: 'Haircut',
      startsAt: at(11, 10),
      endsAt: at(11, 11),
      actor: 'you',
      actorName: 'You',
      label: { preset: 'Other' },
    },
    {
      title: 'Concert',
      startsAt: at(13, 20),
      endsAt: at(13, 23),
      actor: 'partner',
      actorName: 'Alex',
      label: { preset: 'Date' },
      location: 'The Commodore',
      together: true,
    },
    {
      title: 'Flight to Montreal',
      startsAt: at(16, 8, 30),
      endsAt: at(16, 13),
      actor: 'you',
      actorName: 'You',
      label: { preset: 'Travel' },
      location: 'YVR',
    },
    {
      ...allDay(19),
      title: "Dad's birthday",
      actor: 'partner',
      actorName: 'Alex',
      label: { preset: 'Family' },
    },
    {
      title: 'Dinner with the neighbours',
      startsAt: at(22, 18),
      endsAt: at(22, 21),
      actor: 'partner',
      actorName: 'Alex',
      label: { preset: 'Other' },
      location: 'Via Tevere',
      together: true,
    },
    {
      title: 'Long run',
      startsAt: at(25, 8),
      endsAt: at(25, 10),
      actor: 'you',
      actorName: 'You',
      label: { preset: 'Gym' },
      location: 'Seawall',
    },
  ];
}

/** Which seed generation a device planted, and the rows it planted. */
export type CalendarSeedMarker = {
  version: number;
  rowIds: string[];
};

const SEED_MARKER_KEY = 'aoi.calendar.seed.v1';

function isCalendarSeedMarker(value: unknown): value is CalendarSeedMarker {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<CalendarSeedMarker>;
  return (
    typeof candidate.version === 'number' &&
    Array.isArray(candidate.rowIds) &&
    candidate.rowIds.every((id) => typeof id === 'string')
  );
}

export async function getCalendarSeedMarker(): Promise<CalendarSeedMarker | null> {
  try {
    const raw = await AsyncStorage.getItem(SEED_MARKER_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    return isCalendarSeedMarker(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function setCalendarSeedMarker(marker: CalendarSeedMarker): Promise<void> {
  await AsyncStorage.setItem(SEED_MARKER_KEY, JSON.stringify(marker));
}

/**
 * Weekly fixtures expanded into concrete instances up front, so every planted
 * row has a known id. Inserting `recurrence: 'weekly'` through the repository
 * would expand server-side and leave the sibling instances untracked.
 */
export function expandSeedInstances(
  seeds: CreateCalendarEventInput[]
): CreateCalendarEventInput[] {
  return seeds.flatMap((seed) =>
    seed.recurrence === 'weekly'
      ? buildWeeklyRecurrenceInstances(seed).map((instance) => ({
          ...instance,
          recurrence: 'none' as const,
        }))
      : [seed]
  );
}

export type CalendarSeedDeps = {
  loadMarker: () => Promise<CalendarSeedMarker | null>;
  saveMarker: (marker: CalendarSeedMarker) => Promise<void>;
  removeById: (id: string) => Promise<void>;
  plant: (input: CreateCalendarEventInput) => Promise<string>;
  now?: Date;
};

/**
 * Plants the current seed when the device is behind, exactly once per
 * version. Rows planted by the previous generation are removed first (a
 * no-op for ones the reader already deleted); rows the reader created are
 * never touched, and deletions the reader made stay deleted until the next
 * seed bump. A partial plant still records what landed, so the next launch
 * clears the orphans and retries instead of duplicating them.
 */
export async function applyCalendarSeed(deps: CalendarSeedDeps): Promise<void> {
  const marker = await deps.loadMarker();
  if ((marker?.version ?? 0) >= CALENDAR_SEED_VERSION) {
    return;
  }
  const planted: string[] = [];
  try {
    await Promise.all(
      (marker?.rowIds ?? []).map((id) => deps.removeById(id).catch(() => undefined))
    );
    for (const seed of expandSeedInstances(createCalendarSeed(deps.now))) {
      planted.push(await deps.plant(seed));
    }
  } finally {
    await deps.saveMarker({ version: CALENDAR_SEED_VERSION, rowIds: planted }).catch(() => undefined);
  }
}
