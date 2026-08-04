import * as SQLite from 'expo-sqlite';

import { buildWeeklyRecurrenceInstances } from '@/features/calendar/recurrence';
import type {
  CalendarEvent,
  CalendarPresetLabel,
  CreateCalendarEventInput,
  UpdateCalendarEventInput,
} from '@/features/calendar/types';

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

const DB_NAME = 'aoi.db';
let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDatabase() {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync(DB_NAME);
  }

  return databasePromise;
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

async function insertSingleEvent(
  db: SQLite.SQLiteDatabase,
  input: CreateCalendarEventInput,
  recurrenceGroupId: string | null
) {
  const now = new Date().toISOString();
  const id = createId();
  const reminderJson = input.reminderMinutesBefore?.length
    ? JSON.stringify(input.reminderMinutesBefore)
    : null;

  await db.runAsync(
    `INSERT INTO calendar_events (
      id, title, starts_at, ends_at, actor, actor_name,
      label_preset, label_custom_text, reminder_minutes,
      all_day, together, recurrence, recurrence_group_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.title.trim(),
    input.startsAt,
    input.endsAt,
    input.actor,
    input.actorName.trim(),
    input.label.preset,
    input.label.customText?.trim() || null,
    reminderJson,
    input.allDay ? 1 : 0,
    input.together ? 1 : 0,
    input.recurrence === 'weekly' ? 'weekly' : 'none',
    recurrenceGroupId,
    now,
    now
  );

  return id;
}

export async function initCalendarDb() {
  const db = await getDatabase();

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      actor TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      label_preset TEXT NOT NULL,
      label_custom_text TEXT,
      reminder_minutes TEXT,
      all_day INTEGER NOT NULL DEFAULT 0,
      together INTEGER NOT NULL DEFAULT 0,
      recurrence TEXT NOT NULL DEFAULT 'none',
      recurrence_group_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_calendar_events_starts_at
    ON calendar_events(starts_at);

    CREATE INDEX IF NOT EXISTS idx_calendar_events_actor
    ON calendar_events(actor);
  `);

  // Migration: add newer columns to existing installs
  const columns = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(calendar_events)`
  );
  const columnNames = new Set(columns.map((col) => col.name));

  if (!columnNames.has('reminder_minutes')) {
    await db.execAsync(
      `ALTER TABLE calendar_events ADD COLUMN reminder_minutes TEXT`
    );
  }
  if (!columnNames.has('all_day')) {
    await db.execAsync(
      `ALTER TABLE calendar_events ADD COLUMN all_day INTEGER NOT NULL DEFAULT 0`
    );
  }
  if (!columnNames.has('together')) {
    await db.execAsync(
      `ALTER TABLE calendar_events ADD COLUMN together INTEGER NOT NULL DEFAULT 0`
    );
  }
  if (!columnNames.has('recurrence')) {
    await db.execAsync(
      `ALTER TABLE calendar_events ADD COLUMN recurrence TEXT NOT NULL DEFAULT 'none'`
    );
  }
  if (!columnNames.has('recurrence_group_id')) {
    await db.execAsync(
      `ALTER TABLE calendar_events ADD COLUMN recurrence_group_id TEXT`
    );
  }
}

export async function countCalendarEvents() {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM calendar_events'
  );
  return Number(row?.count ?? 0);
}

export async function listEventsInMonth(monthStartIso: string, monthEndIso: string) {
  const db = await getDatabase();
  const rows = await db.getAllAsync<CalendarEventRow>(
    `SELECT * FROM calendar_events
     WHERE starts_at >= ? AND starts_at < ?
     ORDER BY starts_at ASC`,
    monthStartIso,
    monthEndIso
  );

  return rows.map(toCalendarEvent);
}

export async function listEventsForDay(dayStartIso: string, dayEndIso: string) {
  const db = await getDatabase();
  const rows = await db.getAllAsync<CalendarEventRow>(
    `SELECT * FROM calendar_events
     WHERE starts_at >= ? AND starts_at < ?
     ORDER BY starts_at ASC`,
    dayStartIso,
    dayEndIso
  );

  return rows.map(toCalendarEvent);
}

/**
 * Events that overlap a half-open time window [from, to) — used by the
 * agenda lane. Matches the API's range query semantics.
 */
export async function listEventsInRange(fromIso: string, toIso: string) {
  const db = await getDatabase();
  const rows = await db.getAllAsync<CalendarEventRow>(
    `SELECT * FROM calendar_events
     WHERE starts_at < ? AND ends_at >= ?
     ORDER BY starts_at ASC`,
    toIso,
    fromIso
  );

  return rows.map(toCalendarEvent);
}

export async function getEventById(eventId: string) {
  const db = await getDatabase();
  const row = await db.getFirstAsync<CalendarEventRow>(
    `SELECT * FROM calendar_events WHERE id = ? LIMIT 1`,
    eventId
  );

  return row ? toCalendarEvent(row) : null;
}

export async function insertEvent(input: CreateCalendarEventInput) {
  const db = await getDatabase();

  // SIMPLE WEEKLY ONLY — mirrors the API: expand into a bounded horizon of
  // CONCRETE weekly instances sharing one group id. Each instance is an
  // ordinary event; there are no series operations.
  if (input.recurrence === 'weekly') {
    const recurrenceGroupId = createGroupId();
    const instances = buildWeeklyRecurrenceInstances(input);
    let firstId = '';
    for (const instance of instances) {
      const id = await insertSingleEvent(db, instance, recurrenceGroupId);
      if (!firstId) {
        firstId = id;
      }
    }
    return firstId;
  }

  return insertSingleEvent(db, input, null);
}

export async function updateEvent(input: UpdateCalendarEventInput) {
  const db = await getDatabase();
  const now = new Date().toISOString();
  const reminderJson = input.reminderMinutesBefore?.length
    ? JSON.stringify(input.reminderMinutesBefore)
    : null;

  await db.runAsync(
    `UPDATE calendar_events
     SET title = ?, starts_at = ?, ends_at = ?,
         label_preset = ?, label_custom_text = ?,
         reminder_minutes = ?, all_day = ?, together = ?,
         recurrence = ?, updated_at = ?
     WHERE id = ?`,
    input.title.trim(),
    input.startsAt,
    input.endsAt,
    input.label.preset,
    input.label.customText?.trim() || null,
    reminderJson,
    input.allDay ? 1 : 0,
    input.together ? 1 : 0,
    // Applies to THIS instance only — never touches any series siblings.
    input.recurrence === 'weekly' ? 'weekly' : 'none',
    now,
    input.id
  );
}

export async function deleteEvent(eventId: string) {
  const db = await getDatabase();
  await db.runAsync(`DELETE FROM calendar_events WHERE id = ?`, eventId);
}
