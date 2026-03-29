import * as SQLite from 'expo-sqlite';

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
  };
}

function createId() {
  return `cal_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
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
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_calendar_events_starts_at
    ON calendar_events(starts_at);

    CREATE INDEX IF NOT EXISTS idx_calendar_events_actor
    ON calendar_events(actor);
  `);

  // Migration: add reminder_minutes column to existing installs
  const columns = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(calendar_events)`
  );
  const hasReminderColumn = columns.some((col) => col.name === 'reminder_minutes');
  if (!hasReminderColumn) {
    await db.execAsync(
      `ALTER TABLE calendar_events ADD COLUMN reminder_minutes TEXT`
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
  const now = new Date().toISOString();
  const id = createId();
  const reminderJson = input.reminderMinutesBefore?.length
    ? JSON.stringify(input.reminderMinutesBefore)
    : null;

  await db.runAsync(
    `INSERT INTO calendar_events (
      id, title, starts_at, ends_at, actor, actor_name,
      label_preset, label_custom_text, reminder_minutes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.title.trim(),
    input.startsAt,
    input.endsAt,
    input.actor,
    input.actorName.trim(),
    input.label.preset,
    input.label.customText?.trim() || null,
    reminderJson,
    now,
    now
  );

  return id;
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
         reminder_minutes = ?, updated_at = ?
     WHERE id = ?`,
    input.title.trim(),
    input.startsAt,
    input.endsAt,
    input.label.preset,
    input.label.customText?.trim() || null,
    reminderJson,
    now,
    input.id
  );
}

export async function deleteEvent(eventId: string) {
  const db = await getDatabase();
  await db.runAsync(`DELETE FROM calendar_events WHERE id = ?`, eventId);
}
