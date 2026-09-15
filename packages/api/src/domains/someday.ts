import { Effect } from 'effect';

import {
  type CreateSomedayItemRequest,
  type SomedayItem,
  type UpdateSomedayItemRequest,
} from '@aoi/shared';

import { nowMs, type ClockService } from '../effects/clock';
import { newId, type IdService } from '../effects/id';
import { Db, type DbService } from '../effects/d1';
import { getActiveSpaceId } from './spaces';
import {
  BadRequestError,
  InternalError,
  NotFoundError,
  badRequest,
  notFound,
} from './errors';

/**
 * Someday domain — the shared bucket list. Both members may check off, undo,
 * and edit any item. Only meaningful transitions write — repeated check-offs
 * or no-op patches never create churn. Non-members get a 404 so other
 * spaces' items never leak existence; the scoped UPDATE makes the write
 * atomic (no read-then-write TOCTOU).
 */

export interface SomedayItemRow {
  id: string;
  space_id: string;
  created_by_user_id: string;
  title: string;
  note: string | null;
  category: string;
  created_at: number;
  checked_at: number | null;
  checked_by_user_id: string | null;
}

/** Viewer-relative serializer — authorship is computed per request. */
export function somedayItemToApi(row: SomedayItemRow, viewerUserId: string): SomedayItem {
  const createdByRole: SomedayItem['createdByRole'] =
    row.created_by_user_id === viewerUserId ? 'you' : 'partner';
  const checkedByRole: SomedayItem['checkedByRole'] =
    row.checked_at === null || row.checked_by_user_id === null
      ? null
      : row.checked_by_user_id === viewerUserId
        ? 'you'
        : 'partner';

  return {
    id: row.id,
    title: row.title,
    note: row.note ?? undefined,
    category: row.category as SomedayItem['category'],
    createdByRole,
    createdAt: new Date(row.created_at).toISOString(),
    checkedAt: row.checked_at === null ? null : new Date(row.checked_at).toISOString(),
    checkedByRole,
  };
}

// ── List items ───────────────────────────────────────────────────────────

export const listSomedayProgram = (
  userId: string
): Effect.Effect<SomedayItem[], InternalError, DbService> =>
  Effect.gen(function* () {
    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return [];
    }

    const db = yield* Db;
    const rows = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `select id, space_id, created_by_user_id, title, note, category,
                    created_at, checked_at, checked_by_user_id
             from someday_items
             where space_id = ?`
          )
          .bind(spaceId)
          .all<SomedayItemRow>(),
      catch: () => new InternalError({}),
    });

    // Canonical order: open items first (newest first), then checked-off
    // items (most recently checked first).
    return (rows.results ?? [])
      .map((row) => somedayItemToApi(row, userId))
      .sort((left, right) => {
        const leftChecked = left.checkedAt !== null;
        const rightChecked = right.checkedAt !== null;
        if (leftChecked !== rightChecked) {
          return leftChecked ? 1 : -1;
        }
        const leftKey = left.checkedAt ?? left.createdAt;
        const rightKey = right.checkedAt ?? right.createdAt;
        if (leftKey === rightKey) return 0;
        return leftKey > rightKey ? -1 : 1;
      });
  });

// ── Create item ──────────────────────────────────────────────────────────

export const createSomedayProgram = (
  userId: string,
  input: CreateSomedayItemRequest
): Effect.Effect<SomedayItem, BadRequestError | InternalError, DbService | ClockService | IdService> =>
  Effect.gen(function* () {
    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return yield* Effect.fail(badRequest('You must have an active space to add someday items'));
    }

    const db = yield* Db;
    const id = yield* newId;
    const at = yield* nowMs;

    yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `insert into someday_items
               (id, space_id, created_by_user_id, title, note, category, created_at)
             values (?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            id,
            spaceId,
            userId,
            input.title,
            input.note && input.note.length > 0 ? input.note : null,
            input.category,
            at
          )
          .run(),
      catch: () => new InternalError({}),
    });

    return somedayItemToApi(
      {
        id,
        space_id: spaceId,
        created_by_user_id: userId,
        title: input.title,
        note: input.note && input.note.length > 0 ? input.note : null,
        category: input.category,
        created_at: at,
        checked_at: null,
        checked_by_user_id: null,
      },
      userId
    );
  });

// ── Update item (check-off, undo, edits) ─────────────────────────────────

export const updateSomedayProgram = (
  userId: string,
  itemId: string,
  input: UpdateSomedayItemRequest
): Effect.Effect<SomedayItem, BadRequestError | NotFoundError | InternalError, DbService | ClockService> =>
  Effect.gen(function* () {
    const db = yield* Db;
    const at = yield* nowMs;

    const existing = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `select id, space_id, created_by_user_id, title, note, category,
                    created_at, checked_at, checked_by_user_id
             from someday_items where id = ? limit 1`
          )
          .bind(itemId)
          .first<SomedayItemRow>(),
      catch: () => new InternalError({}),
    });
    if (!existing) {
      return yield* Effect.fail(notFound('Someday item not found'));
    }

    // Membership gate: non-members get a 404 so other spaces' items never
    // leak existence.
    const member = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            "select 1 from space_members where space_id = ? and user_id = ? and state = 'active' limit 1"
          )
          .bind(existing.space_id, userId)
          .first(),
      catch: () => new InternalError({}),
    });
    if (!member) {
      return yield* Effect.fail(notFound('Someday item not found'));
    }

    // Build the diff — only meaningful transitions write.
    const sets: string[] = [];
    const params: unknown[] = [];
    if (input.title !== undefined && input.title !== existing.title) {
      sets.push('title = ?');
      params.push(input.title);
    }
    if (input.note !== undefined) {
      const nextNote = input.note.length > 0 ? input.note : null;
      if (nextNote !== existing.note) {
        sets.push('note = ?');
        params.push(nextNote);
      }
    }
    if (input.category !== undefined && input.category !== existing.category) {
      sets.push('category = ?');
      params.push(input.category);
    }
    if (input.checked === true && existing.checked_at === null) {
      sets.push('checked_at = ?');
      sets.push('checked_by_user_id = ?');
      params.push(at, userId);
    }
    if (input.checked === false && existing.checked_at !== null) {
      sets.push('checked_at = null');
      sets.push('checked_by_user_id = null');
    }

    if (sets.length === 0) {
      return somedayItemToApi(existing, userId);
    }

    // Scoped UPDATE — atomic (no read-then-write TOCTOU).
    const result = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `update someday_items set ${sets.join(', ')}
             where id = ? and space_id = ?`
          )
          .bind(...params, itemId, existing.space_id)
          .run(),
      catch: () => new InternalError({}),
    });
    if ((result.meta?.changes ?? 0) === 0) {
      return yield* Effect.fail(notFound('Someday item not found'));
    }

    const updated = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `select id, space_id, created_by_user_id, title, note, category,
                    created_at, checked_at, checked_by_user_id
             from someday_items where id = ? limit 1`
          )
          .bind(itemId)
          .first<SomedayItemRow>(),
      catch: () => new InternalError({}),
    });
    if (!updated) {
      return yield* Effect.fail(notFound('Someday item not found'));
    }

    return somedayItemToApi(updated, userId);
  });
