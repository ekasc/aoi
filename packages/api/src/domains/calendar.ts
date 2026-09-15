import { Effect } from 'effect';

import {
  CALENDAR_PRESET_LABELS,
  WEEKLY_RECURRENCE_INSTANCE_COUNT,
  type CalendarEvent,
  type CalendarEventRecurrence,
  type CalendarLabel,
  type CreateCalendarEventRequest,
  type UpdateCalendarEventRequest,
} from '@aoi/shared';

import { nowMs, type ClockService } from '../effects/clock';
import { newId, type IdService } from '../effects/id';
import { Db, batch, type DbService } from '../effects/d1';
import { Logger, type LoggerService } from '../effects/logger';
import { enqueueJob, type JobQueueService } from '../services/job-queue';
import { getActiveSpaceId } from './spaces';
import {
  BadRequestError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  badRequest,
  forbidden,
  notFound,
} from './errors';

/**
 * Calendar domain — shared calendar events scoped to a space.
 *
 * Invariants:
 * - every id-addressed read/write re-checks active membership of the event's
 *   space (another space's event is indistinguishable from no event → 404);
 * - create/update/delete of an event are creator-only (403 otherwise);
 * - weekly recurrence is expanded server-side into a bounded horizon of
 *   CONCRETE instances sharing a `recurrence_group_id` — no series
 *   operations; editing/deleting one instance never touches the rest;
 * - updates validate the MERGED range (partial updates can never produce an
 *   event that ends at/before it starts);
 * - partner notifications are enqueued (kind only, weekday at most), never
 *   sent inline.
 */

export interface CalendarEventRow {
  id: string;
  space_id: string;
  created_by_user_id: string;
  actor: string;
  actor_name: string;
  title: string;
  starts_at: number;
  ends_at: number;
  label_preset: string;
  label_custom_text: string | null;
  reminder_minutes_before: string | null;
  all_day: number;
  together: number;
  recurrence: string;
  recurrence_group_id: string | null;
  created_at: number;
  updated_at: number;
}

const EVENT_SELECT = `
  select id, space_id, created_by_user_id, actor, actor_name, title,
         starts_at, ends_at, label_preset, label_custom_text,
         reminder_minutes_before, all_day, together, recurrence,
         recurrence_group_id, created_at, updated_at
  from calendar_events
`;

/** Viewer-relative serializer — the ONLY shape a calendar event leaves the domain. */
export function calendarEventToApi(row: CalendarEventRow, viewerUserId: string): CalendarEvent {
  const label: CalendarLabel =
    row.label_preset === 'Other' && row.label_custom_text
      ? { preset: 'Other', customText: row.label_custom_text }
      : { preset: row.label_preset as CalendarLabel['preset'] };

  const reminderMinutesBefore =
    row.reminder_minutes_before !== null
      ? (JSON.parse(row.reminder_minutes_before) as number[])
      : undefined;

  return {
    id: row.id,
    title: row.title,
    startsAt: new Date(row.starts_at).toISOString(),
    endsAt: new Date(row.ends_at).toISOString(),
    actor: row.actor as CalendarEvent['actor'],
    actorName: row.actor_name,
    label,
    reminderMinutesBefore:
      reminderMinutesBefore && reminderMinutesBefore.length > 0
        ? reminderMinutesBefore
        : undefined,
    allDay: row.all_day === 1,
    together: row.together === 1,
    recurrence: (row.recurrence === 'weekly' ? 'weekly' : 'none') as CalendarEventRecurrence,
    isOwn: row.created_by_user_id === viewerUserId,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/** Active membership check — shared by every id-addressed event operation. */
function assertActiveMember(
  spaceId: string,
  userId: string
): Effect.Effect<void, ForbiddenError | InternalError, DbService> {
  return Effect.flatMap(Db, (s) =>
    Effect.tryPromise({
      try: async () => {
        const row = await s.d1
          .prepare(
            "select 1 from space_members where space_id = ? and user_id = ? and state = 'active' limit 1"
          )
          .bind(spaceId, userId)
          .first();
        if (!row) {
          throw forbidden('You are not an active member of this space');
        }
      },
      catch: (err) => (err instanceof ForbiddenError ? err : new InternalError({})),
    })
  );
}

/** Load an event + verify membership; 404 otherwise (no existence leaks). */
function loadEventForMember(
  eventId: string,
  userId: string
): Effect.Effect<CalendarEventRow, NotFoundError | ForbiddenError | InternalError, DbService> {
  return Effect.flatMap(Db, (s) =>
    Effect.tryPromise({
      try: async () => {
        const row = await s.d1
          .prepare(`${EVENT_SELECT} where id = ? and deleted_at is null limit 1`)
          .bind(eventId)
          .first<CalendarEventRow>();
        if (!row) return null;
        const member = await s.d1
          .prepare(
            "select 1 from space_members where space_id = ? and user_id = ? and state = 'active' limit 1"
          )
          .bind(row.space_id, userId)
          .first();
        return member ? row : null;
      },
      catch: () => new InternalError({}),
    })
  ).pipe(
    Effect.flatMap((row) =>
      row === null
        ? Effect.fail(notFound('Event not found'))
        : Effect.succeed(row)
    )
  );
}

/** Creator gate (update/delete only). */
function assertCreator(
  row: CalendarEventRow,
  userId: string
): Effect.Effect<void, ForbiddenError, never> {
  return row.created_by_user_id === userId
    ? Effect.void
    : Effect.fail(forbidden('You can only edit your own events'));
}

/** Parse a JSON-encoded reminder array (raw D1 returns text). */
function parseReminders(value: string | null): number[] | null {
  if (value === null || value === '') return null;
  try {
    return JSON.parse(value) as number[];
  } catch {
    return null;
  }
}

// ── List events in a half-open window [from, to) ─────────────────────────

export const listEventsProgram = (
  userId: string,
  query: { from: string; to: string }
): Effect.Effect<CalendarEvent[], BadRequestError | InternalError, DbService> =>
  Effect.gen(function* () {
    const fromMs = Date.parse(query.from);
    const toMs = Date.parse(query.to);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
      return yield* Effect.fail(badRequest('Invalid date range'));
    }

    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return [];
    }

    const db = yield* Db;
    const rows = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `${EVENT_SELECT}
             where space_id = ? and deleted_at is null
               and ends_at >= ? and starts_at < ?
             order by starts_at asc`
          )
          .bind(spaceId, fromMs, toMs)
          .all<CalendarEventRow>(),
      catch: () => new InternalError({}),
    });

    return (rows.results ?? []).map((row) => calendarEventToApi(row, userId));
  });

// ── Get single event ─────────────────────────────────────────────────────

export const getEventProgram = (
  userId: string,
  eventId: string
): Effect.Effect<CalendarEvent, NotFoundError | ForbiddenError | InternalError, DbService> =>
  Effect.gen(function* () {
    const row = yield* loadEventForMember(eventId, userId);
    return calendarEventToApi(row, userId);
  });

// ── Create event (weekly expands into concrete instances) ────────────────

export const createEventProgram = (
  userId: string,
  input: CreateCalendarEventRequest
): Effect.Effect<CalendarEvent, BadRequestError | ForbiddenError | InternalError, DbService | JobQueueService | ClockService | IdService | LoggerService> =>
  Effect.gen(function* () {
    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return yield* Effect.fail(badRequest('You must have an active space to create events'));
    }
    yield* assertActiveMember(spaceId, userId);

    const startMs = Date.parse(input.startsAt);
    const endMs = Date.parse(input.endsAt);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      return yield* Effect.fail(badRequest('endsAt must be after startsAt'));
    }

    const at = yield* nowMs;
    const db = yield* Db;
    const labelPreset =
      input.label.preset === 'Other' && input.label.customText
        ? 'Other'
        : input.label.preset;
    const labelCustomText =
      input.label.preset === 'Other' ? (input.label.customText ?? null) : null;
    const reminderJson =
      input.reminderMinutesBefore && input.reminderMinutesBefore.length > 0
        ? JSON.stringify(input.reminderMinutesBefore)
        : null;
    const allDay = input.allDay ?? false;
    const together = input.together ?? false;
    const recurrence: CalendarEventRecurrence = input.recurrence === 'weekly' ? 'weekly' : 'none';

    const id = yield* newId;
    const values = [
      id,
      spaceId,
      userId,
      input.actor,
      input.actorName,
      input.title,
      startMs,
      endMs,
      labelPreset,
      labelCustomText,
      reminderJson,
      allDay ? 1 : 0,
      together ? 1 : 0,
      recurrence,
      null,
      at,
      at,
    ];

    if (recurrence === 'weekly') {
      // Expand into a bounded horizon of concrete instances sharing one
      // group id. Each instance is ordinary: no series operations.
      const recurrenceGroupId = yield* newId;
      const firstInstanceId = yield* newId;
      const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
      const statements: Array<ReturnType<typeof db.d1.prepare>> = [];
      for (let week = 0; week < WEEKLY_RECURRENCE_INSTANCE_COUNT; week++) {
        const instanceId = week === 0 ? firstInstanceId : yield* newId;
        const instanceStart = startMs + week * WEEK_MS;
        const instanceEnd = endMs + week * WEEK_MS;
        statements.push(
          db.d1
            .prepare(
              `insert into calendar_events
                 (id, space_id, created_by_user_id, actor, actor_name, title,
                  starts_at, ends_at, label_preset, label_custom_text,
                  reminder_minutes_before, all_day, together, recurrence,
                  recurrence_group_id, created_at, updated_at)
               values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(
              instanceId,
              spaceId,
              userId,
              input.actor,
              input.actorName,
              input.title,
              instanceStart,
              instanceEnd,
              labelPreset,
              labelCustomText,
              reminderJson,
              allDay ? 1 : 0,
              together ? 1 : 0,
              'weekly',
              recurrenceGroupId,
              at,
              at
            )
        );
      }
      yield* batch(statements);

      // Return the first instance (matches the legacy behavior).
      const first = yield* Effect.tryPromise({
        try: () =>
          db.d1
            .prepare(`${EVENT_SELECT} where id = ? and deleted_at is null limit 1`)
            .bind(firstInstanceId)
            .first<CalendarEventRow>(),
        catch: () => new InternalError({}),
      });
      if (!first) {
        return yield* Effect.fail(new InternalError({}));
      }
      yield* enqueueJob({ type: 'push.deliver', kind: 'event_added', spaceId, fromUserId: userId, dayOfWeek: weekdayForMs(startMs) });
      return calendarEventToApi(first, userId);
    }

    const insert = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `insert into calendar_events
               (id, space_id, created_by_user_id, actor, actor_name, title,
                starts_at, ends_at, label_preset, label_custom_text,
                reminder_minutes_before, all_day, together, recurrence,
                recurrence_group_id, created_at, updated_at)
             values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(...values)
          .run(),
      catch: () => new InternalError({}),
    });
    if ((insert.meta?.changes ?? 0) === 0) {
      return yield* Effect.fail(new InternalError({}));
    }

    const row = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(`${EVENT_SELECT} where id = ? and deleted_at is null limit 1`)
          .bind(id)
          .first<CalendarEventRow>(),
      catch: () => new InternalError({}),
    });
    if (!row) {
      return yield* Effect.fail(new InternalError({}));
    }

    yield* enqueueJob({ type: 'push.deliver', kind: 'event_added', spaceId, fromUserId: userId, dayOfWeek: weekdayForMs(startMs) });
    return calendarEventToApi(row, userId);
  });

/** Weekday name for an epoch ms, in the caller's local offset (UTC fallback). */
function weekdayForMs(ms: number): string | undefined {
  const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return undefined;
  return WEEKDAY_NAMES[d.getUTCDay()];
}

// ── Update event (creator-only, merged-range validation) ─────────────────

export const updateEventProgram = (
  userId: string,
  eventId: string,
  input: UpdateCalendarEventRequest
): Effect.Effect<CalendarEvent, BadRequestError | ForbiddenError | NotFoundError | InternalError, DbService | JobQueueService | ClockService | LoggerService> =>
  Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* loadEventForMember(eventId, userId);
    yield* assertCreator(row, userId);

    // Validate the MERGED range: partial updates must never produce an event
    // that ends at (or before) it starts.
    const nextStartsAt = input.startsAt !== undefined ? Date.parse(input.startsAt) : row.starts_at;
    const nextEndsAt = input.endsAt !== undefined ? Date.parse(input.endsAt) : row.ends_at;
    if (!Number.isFinite(nextStartsAt) || !Number.isFinite(nextEndsAt) || nextEndsAt <= nextStartsAt) {
      return yield* Effect.fail(badRequest('endsAt must be after startsAt'));
    }

    const sets: string[] = ['updated_at = ?'];
    const params: unknown[] = [yield* nowMs];
    if (input.title !== undefined) { sets.push('title = ?'); params.push(input.title); }
    if (input.startsAt !== undefined) { sets.push('starts_at = ?'); params.push(nextStartsAt); }
    if (input.endsAt !== undefined) { sets.push('ends_at = ?'); params.push(nextEndsAt); }
    if (input.label !== undefined) {
      sets.push('label_preset = ?');
      sets.push('label_custom_text = ?');
      params.push(input.label.preset === 'Other' ? 'Other' : input.label.preset);
      params.push(input.label.preset === 'Other' ? (input.label.customText ?? null) : null);
    }
    if (input.reminderMinutesBefore !== undefined) {
      sets.push('reminder_minutes_before = ?');
      params.push(
        input.reminderMinutesBefore.length > 0
          ? JSON.stringify(input.reminderMinutesBefore)
          : null
      );
    }
    if (input.allDay !== undefined) { sets.push('all_day = ?'); params.push(input.allDay ? 1 : 0); }
    if (input.together !== undefined) { sets.push('together = ?'); params.push(input.together ? 1 : 0); }
    if (input.recurrence !== undefined) {
      sets.push('recurrence = ?');
      params.push(input.recurrence === 'weekly' ? 'weekly' : 'none');
    }

    yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(`update calendar_events set ${sets.join(', ')} where id = ? and deleted_at is null`)
          .bind(...params, eventId)
          .run(),
      catch: () => new InternalError({}),
    });

    const updated = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(`${EVENT_SELECT} where id = ? and deleted_at is null limit 1`)
          .bind(eventId)
          .first<CalendarEventRow>(),
      catch: () => new InternalError({}),
    });
    if (!updated) {
      return yield* Effect.fail(notFound('Event not found'));
    }

    yield* enqueueJob({
      type: 'push.deliver',
      kind: 'event_updated',
      spaceId: row.space_id,
      fromUserId: userId,
      dayOfWeek: input.startsAt !== undefined ? weekdayForMs(nextStartsAt) : undefined,
    });
    return calendarEventToApi(updated, userId);
  });

// ── Delete event (soft delete, creator-only) ─────────────────────────────

export const deleteEventProgram = (
  userId: string,
  eventId: string
): Effect.Effect<{ ok: true }, ForbiddenError | NotFoundError | InternalError, DbService | JobQueueService | ClockService | LoggerService> =>
  Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* loadEventForMember(eventId, userId);
    yield* assertCreator(row, userId);

    const at = yield* nowMs;
    const result = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare('update calendar_events set deleted_at = ?, updated_at = ? where id = ? and deleted_at is null')
          .bind(at, at, eventId)
          .run(),
      catch: () => new InternalError({}),
    });
    if ((result.meta?.changes ?? 0) === 0) {
      return yield* Effect.fail(notFound('Event not found'));
    }

    yield* enqueueJob({ type: 'push.deliver', kind: 'event_deleted', spaceId: row.space_id, fromUserId: userId });
    return { ok: true as const };
  });

/** Preset labels, exported for route validation parity. */
export { CALENDAR_PRESET_LABELS };
