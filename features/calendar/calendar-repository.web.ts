/**
 * Web implementation of the calendar repository.
 *
 * Metro resolves this file instead of `calendar-repository.ts` on web
 * (platform extensions). It exports the exact same functions with the exact
 * same semantics — queries, ordering, ID scheme, and the weekly-expansion
 * behavior all mirror the SQLite version — but persists rows as a JSON
 * document in AsyncStorage (localStorage on web) instead of SQLite.
 *
 * Why: `expo-sqlite` on web runs inside a Web Worker (`web/worker.ts`) that
 * Expo's dev-server serializer cannot chunk (`Worker chunk not found`),
 * which fails every web page at bundle time. expo-sqlite web support is
 * still alpha upstream, so the web app sidesteps it entirely. Native is
 * untouched and keeps using SQLite.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { buildWeeklyRecurrenceInstances } from '@/features/calendar/recurrence';
import type {
  CalendarEvent,
  CalendarPresetLabel,
  CreateCalendarEventInput,
  UpdateCalendarEventInput,
} from '@/features/calendar/types';

// Same row shape as the SQLite version so the mapping below stays identical.
type CalendarEventRow = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  actor: 'you' | 'partner';
  actor_name: string;
  label_preset: CalendarPresetLabel;
  label_custom_text: string | null;
  reminder_minutes: string | null;
  all_day: number | null;
  together: number | null;
  recurrence: string | null;
  recurrence_group_id: string | null;
  created_at: string;
  updated_at: string;
};

type StoredPayload = {
  rows: CalendarEventRow[];
};

const STORAGE_KEY = 'aoi.calendar.events.v1';

let cache: CalendarEventRow[] | null = null;
let cachePromise: Promise<CalendarEventRow[]> | null = null;
// Serializes read-modify-write cycles so concurrent callers (e.g. the
// `Promise.all` seed in the calendar context) cannot clobber each other.
let writeChain: Promise<void> = Promise.resolve();

function isCalendarEventRow(value: unknown): value is CalendarEventRow {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<CalendarEventRow>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.starts_at === 'string' &&
    typeof candidate.ends_at === 'string' &&
    (candidate.actor === 'you' || candidate.actor === 'partner') &&
    typeof candidate.actor_name === 'string' &&
    typeof candidate.created_at === 'string' &&
    typeof candidate.updated_at === 'string'
  );
}

async function loadPersistedRows(): Promise<CalendarEventRow[]> {
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(STORAGE_KEY);
  } catch {
    return [];
  }

  if (!raw) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as Partial<StoredPayload>).rows)
    ) {
      return (parsed as StoredPayload).rows.filter(isCalendarEventRow);
    }
  } catch {
    // Corrupt payload: fall through to the empty store.
  }

  return [];
}

async function getRows(): Promise<CalendarEventRow[]> {
  if (cache) {
    return cache;
  }

  if (!cachePromise) {
    cachePromise = loadPersistedRows().then((rows) => {
      cache = rows;
      return rows;
    });
  }

  return cachePromise;
}

function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = writeChain.then(task, task);
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function mutateRows<T>(
  task: (rows: CalendarEventRow[]) => T,
): Promise<T> {
  return enqueueWrite(async () => {
    const rows = await getRows();
    const result = task(rows);
    cache = rows;
    const payload: StoredPayload = { rows };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return result;
  });
}

function toCalendarEvent(row: CalendarEventRow): CalendarEvent {
  return {
    id: row.id,
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    actor: row.actor,
    actorName: row.actor_name,
    label: {
      preset: row.label_preset,
      customText: row.label_custom_text ?? undefined,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reminderMinutesBefore: row.reminder_minutes
      ? (JSON.parse(row.reminder_minutes) as number[])
      : undefined,
    allDay: row.all_day === 1,
    together: row.together === 1,
    recurrence: row.recurrence === 'weekly' ? 'weekly' : 'none',
    // Stub mode has no user accounts: the actor is the only ownership
    // signal, keeping the pre-existing "you-created events are editable"
    // behavior.
    isOwn: row.actor === 'you',
  };
}

function createId() {
  return `cal_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

function createGroupId() {
  return `rec_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

function insertSingleEvent(
  rows: CalendarEventRow[],
  input: CreateCalendarEventInput,
  recurrenceGroupId: string | null,
) {
  const now = new Date().toISOString();
  const id = createId();
  const reminderJson = input.reminderMinutesBefore?.length
    ? JSON.stringify(input.reminderMinutesBefore)
    : null;

  rows.push({
    id,
    title: input.title.trim(),
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    actor: input.actor,
    actor_name: input.actorName.trim(),
    label_preset: input.label.preset,
    label_custom_text: input.label.customText?.trim() || null,
    reminder_minutes: reminderJson,
    all_day: input.allDay ? 1 : 0,
    together: input.together ? 1 : 0,
    recurrence: input.recurrence === 'weekly' ? 'weekly' : 'none',
    recurrence_group_id: recurrenceGroupId,
    created_at: now,
    updated_at: now,
  });

  return id;
}

function compareStartsAt(left: CalendarEventRow, right: CalendarEventRow) {
  if (left.starts_at === right.starts_at) {
    return 0;
  }

  return left.starts_at < right.starts_at ? -1 : 1;
}

export async function initCalendarDb() {
  await mutateRows(() => undefined);
}

export async function countCalendarEvents() {
  const rows = await getRows();
  return rows.length;
}

export async function listEventsInMonth(
  monthStartIso: string,
  monthEndIso: string,
) {
  const rows = await getRows();
  return rows
    .filter(
      (row) => row.starts_at >= monthStartIso && row.starts_at < monthEndIso,
    )
    .sort(compareStartsAt)
    .map(toCalendarEvent);
}

export async function listEventsForDay(
  dayStartIso: string,
  dayEndIso: string,
) {
  const rows = await getRows();
  return rows
    .filter((row) => row.starts_at >= dayStartIso && row.starts_at < dayEndIso)
    .sort(compareStartsAt)
    .map(toCalendarEvent);
}

/**
 * Events that overlap a half-open time window [from, to) — used by the
 * agenda lane. Matches the API's range query semantics.
 */
export async function listEventsInRange(fromIso: string, toIso: string) {
  const rows = await getRows();
  return rows
    .filter((row) => row.starts_at < toIso && row.ends_at >= fromIso)
    .sort(compareStartsAt)
    .map(toCalendarEvent);
}

export async function getEventById(eventId: string) {
  const rows = await getRows();
  const row = rows.find((candidate) => candidate.id === eventId);
  return row ? toCalendarEvent(row) : null;
}

export async function insertEvent(input: CreateCalendarEventInput) {
  return mutateRows((rows) => {
    // SIMPLE WEEKLY ONLY — mirrors the API: expand into a bounded horizon of
    // CONCRETE weekly instances sharing one group id. Each instance is an
    // ordinary event; there are no series operations.
    if (input.recurrence === 'weekly') {
      const recurrenceGroupId = createGroupId();
      const instances = buildWeeklyRecurrenceInstances(input);
      let firstId = '';
      for (const instance of instances) {
        const id = insertSingleEvent(rows, instance, recurrenceGroupId);
        if (!firstId) {
          firstId = id;
        }
      }
      return firstId;
    }

    return insertSingleEvent(rows, input, null);
  });
}

export async function updateEvent(input: UpdateCalendarEventInput) {
  await mutateRows((rows) => {
    const row = rows.find((candidate) => candidate.id === input.id);
    // No match is a silent no-op, same as SQLite updating zero rows.
    if (!row) {
      return;
    }

    const now = new Date().toISOString();
    const reminderJson = input.reminderMinutesBefore?.length
      ? JSON.stringify(input.reminderMinutesBefore)
      : null;

    row.title = input.title.trim();
    row.starts_at = input.startsAt;
    row.ends_at = input.endsAt;
    row.label_preset = input.label.preset;
    row.label_custom_text = input.label.customText?.trim() || null;
    row.reminder_minutes = reminderJson;
    row.all_day = input.allDay ? 1 : 0;
    row.together = input.together ? 1 : 0;
    // Applies to THIS instance only — never touches any series siblings.
    row.recurrence = input.recurrence === 'weekly' ? 'weekly' : 'none';
    row.updated_at = now;
  });
}

export async function deleteEvent(eventId: string) {
  await mutateRows((rows) => {
    const index = rows.findIndex((candidate) => candidate.id === eventId);
    if (index >= 0) {
      rows.splice(index, 1);
    }
  });
}
