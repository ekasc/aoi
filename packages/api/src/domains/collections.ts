import { Effect } from 'effect';

import {
  type Collection,
  type CollectionItem,
  type CreateCollectionItemRequest,
  type CreateCollectionRequest,
  type UpdateCollectionItemRequest,
  type UpdateCollectionRequest,
} from '@aoi/shared';

import { nowMs, type ClockService } from '../effects/clock';
import { newId, type IdService } from '../effects/id';
import { Db, type DbService } from '../effects/d1';
import { getActiveSpaceId } from './spaces';
import {
  BadRequestError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  badRequest,
  notFound,
} from './errors';

/**
 * Collections domain — the shared shelves a couple authors. Both members may
 * create, edit, reorder, and remove any shelf or item. Reads and writes are
 * scoped to the caller's ACTIVE space: a resource the caller cannot reach is a
 * 404, whether it is missing or belongs to another space (no existence leak,
 * matching the rest of the API). Removals are
 * soft-deletes (deleting a shelf tombstones its items too, atomically).
 * `position` is append-on-create (max + 1) so drag-reorder is additive later.
 */

export interface CollectionRow {
  id: string;
  space_id: string;
  created_by_user_id: string;
  name: string;
  emoji: string | null;
  color: string | null;
  position: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  item_count?: number;
}

export interface CollectionItemRow {
  id: string;
  collection_id: string;
  space_id: string;
  created_by_user_id: string;
  title: string;
  note: string | null;
  link: string | null;
  cover_url: string | null;
  status: string | null;
  score: number | null;
  position: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export function collectionToApi(row: CollectionRow): Collection {
  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji ?? undefined,
    color: (row.color ?? undefined) as Collection['color'],
    position: row.position,
    itemCount: row.item_count ?? 0,
    createdByUserId: row.created_by_user_id,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export function collectionItemToApi(row: CollectionItemRow): CollectionItem {
  return {
    id: row.id,
    collectionId: row.collection_id,
    title: row.title,
    note: row.note ?? undefined,
    link: row.link ?? undefined,
    coverUrl: row.cover_url ?? undefined,
    status: (row.status ?? undefined) as CollectionItem['status'],
    score: row.score ?? undefined,
    position: row.position,
    createdByUserId: row.created_by_user_id,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

const COLLECTION_SELECT = `
  select id, space_id, created_by_user_id, name, emoji, color, position,
         created_at, updated_at, deleted_at
  from collections
`;

const COLLECTION_ITEM_SELECT = `
  select id, collection_id, space_id, created_by_user_id, title, note, link,
         cover_url, status, score,
         position, created_at, updated_at, deleted_at
  from collection_items
`;

/** An optional text field is stored as NULL when absent or blank. */
function nullableText(value: string | null | undefined): string | null {
  return value !== undefined && value !== null && value.length > 0 ? value : null;
}

/** An optional number is stored as NULL when absent. */
function nullableInt(value: number | null | undefined): number | null {
  return value === undefined || value === null ? null : value;
}

/**
 * Load a collection the caller may reach. Missing, deleted, or outside the
 * caller's space → 404 (a non-member cannot tell it exists).
 */
function loadCollectionForMember(
  userId: string,
  id: string
): Effect.Effect<CollectionRow, NotFoundError | ForbiddenError | InternalError, DbService> {
  return Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(`${COLLECTION_SELECT} where id = ? and deleted_at is null limit 1`)
          .bind(id)
          .first<CollectionRow>(),
      catch: () => new InternalError({}),
    });
    if (!row) {
      return yield* Effect.fail(notFound('Collection not found'));
    }
    const member = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            "select 1 from space_members where space_id = ? and user_id = ? and state = 'active' limit 1"
          )
          .bind(row.space_id, userId)
          .first(),
      catch: () => new InternalError({}),
    });
    if (!member) {
      return yield* Effect.fail(notFound('Collection not found'));
    }
    return row;
  });
}

/** Load an item and verify membership via the item's space. */
function loadItemForMember(
  userId: string,
  id: string
): Effect.Effect<CollectionItemRow, NotFoundError | ForbiddenError | InternalError, DbService> {
  return Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(`${COLLECTION_ITEM_SELECT} where id = ? and deleted_at is null limit 1`)
          .bind(id)
          .first<CollectionItemRow>(),
      catch: () => new InternalError({}),
    });
    if (!row) {
      return yield* Effect.fail(notFound('Collection item not found'));
    }
    const member = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            "select 1 from space_members where space_id = ? and user_id = ? and state = 'active' limit 1"
          )
          .bind(row.space_id, userId)
          .first(),
      catch: () => new InternalError({}),
    });
    if (!member) {
      return yield* Effect.fail(notFound('Collection item not found'));
    }
    return row;
  });
}

/** Next append position within a scope (max + 1, or 0 for the first row). */
function nextPosition(
  sql: string,
  ...params: unknown[]
): Effect.Effect<number, InternalError, DbService> {
  return Effect.flatMap(Db, (s) =>
    Effect.tryPromise({
      try: async () => {
        const row = await s.d1
          .prepare(sql)
          .bind(...params)
          .first<{ max: number | null }>();
        return (row?.max ?? -1) + 1;
      },
      catch: () => new InternalError({}),
    })
  );
}

// ── List shelves ─────────────────────────────────────────────────────────

export const listCollectionsProgram = (
  userId: string
): Effect.Effect<Collection[], InternalError, DbService> =>
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
            `select c.id, c.space_id, c.created_by_user_id, c.name, c.emoji, c.color, c.position,
                    c.created_at, c.updated_at, c.deleted_at,
                    (select count(*) from collection_items i
                       where i.collection_id = c.id and i.deleted_at is null) as item_count
             from collections c
             where c.space_id = ? and c.deleted_at is null
             order by c.position asc, c.created_at asc`
          )
          .bind(spaceId)
          .all<CollectionRow>(),
      catch: () => new InternalError({}),
    });

    return (rows.results ?? []).map(collectionToApi);
  });

// ── Create shelf ─────────────────────────────────────────────────────────

export const createCollectionProgram = (
  userId: string,
  input: CreateCollectionRequest
): Effect.Effect<
  Collection,
  BadRequestError | InternalError,
  DbService | ClockService | IdService
> =>
  Effect.gen(function* () {
    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return yield* Effect.fail(
        badRequest('You must have an active space to create a collection')
      );
    }

    const db = yield* Db;
    const id = yield* newId;
    const at = yield* nowMs;
    const position = yield* nextPosition(
      'select max(position) as max from collections where space_id = ? and deleted_at is null',
      spaceId
    );
    const emoji = nullableText(input.emoji);
    const color = nullableText(input.color);

    yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `insert into collections
               (id, space_id, created_by_user_id, name, emoji, color, position, created_at, updated_at)
             values (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(id, spaceId, userId, input.name, emoji, color, position, at, at)
          .run(),
      catch: () => new InternalError({}),
    });

    return collectionToApi({
      id,
      space_id: spaceId,
      created_by_user_id: userId,
      name: input.name,
      emoji,
      color,
      position,
      created_at: at,
      updated_at: at,
      deleted_at: null,
      item_count: 0,
    });
  });

// ── Update shelf ─────────────────────────────────────────────────────────

export const updateCollectionProgram = (
  userId: string,
  id: string,
  input: UpdateCollectionRequest
): Effect.Effect<
  Collection,
  NotFoundError | ForbiddenError | InternalError,
  DbService | ClockService
> =>
  Effect.gen(function* () {
    const existing = yield* loadCollectionForMember(userId, id);

    const sets: string[] = [];
    const params: unknown[] = [];
    if (input.name !== undefined && input.name !== existing.name) {
      sets.push('name = ?');
      params.push(input.name);
    }
    if (input.emoji !== undefined) {
      const nextEmoji = nullableText(input.emoji);
      if (nextEmoji !== existing.emoji) {
        sets.push('emoji = ?');
        params.push(nextEmoji);
      }
    }
    if (input.color !== undefined) {
      const nextColor = nullableText(input.color);
      if (nextColor !== existing.color) {
        sets.push('color = ?');
        params.push(nextColor);
      }
    }
    if (input.position !== undefined && input.position !== existing.position) {
      sets.push('position = ?');
      params.push(input.position);
    }

    if (sets.length === 0) {
      return collectionToApi(existing);
    }

    const db = yield* Db;
    const at = yield* nowMs;
    yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `update collections set ${sets.join(', ')}, updated_at = ?
             where id = ? and deleted_at is null`
          )
          .bind(...params, at, id)
          .run(),
      catch: () => new InternalError({}),
    });

    const updated = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(`${COLLECTION_SELECT} where id = ? and deleted_at is null limit 1`)
          .bind(id)
          .first<CollectionRow>(),
      catch: () => new InternalError({}),
    });
    if (!updated) {
      return yield* Effect.fail(notFound('Collection not found'));
    }

    return collectionToApi(updated);
  });

// ── Delete shelf (soft; tombstones its items too) ────────────────────────

export const deleteCollectionProgram = (
  userId: string,
  id: string
): Effect.Effect<
  { ok: true },
  NotFoundError | ForbiddenError | InternalError,
  DbService | ClockService
> =>
  Effect.gen(function* () {
    const existing = yield* loadCollectionForMember(userId, id);
    const db = yield* Db;
    const at = yield* nowMs;

    yield* Effect.tryPromise({
      try: () =>
        db.batch([
          db.d1
            .prepare(
              'update collections set deleted_at = ?, updated_at = ? where id = ? and deleted_at is null'
            )
            .bind(at, at, id),
          db.d1
            .prepare(
              'update collection_items set deleted_at = ?, updated_at = ? where collection_id = ? and deleted_at is null'
            )
            .bind(at, at, existing.id),
        ]),
      catch: () => new InternalError({}),
    });

    return { ok: true as const };
  });

// ── List items ───────────────────────────────────────────────────────────

export const listCollectionItemsProgram = (
  userId: string,
  collectionId: string
): Effect.Effect<
  CollectionItem[],
  NotFoundError | ForbiddenError | InternalError,
  DbService
> =>
  Effect.gen(function* () {
    yield* loadCollectionForMember(userId, collectionId);
    const db = yield* Db;
    const rows = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `${COLLECTION_ITEM_SELECT}
             where collection_id = ? and deleted_at is null
             order by position asc, created_at asc`
          )
          .bind(collectionId)
          .all<CollectionItemRow>(),
      catch: () => new InternalError({}),
    });
    return (rows.results ?? []).map(collectionItemToApi);
  });

// ── Create item ──────────────────────────────────────────────────────────

export const createCollectionItemProgram = (
  userId: string,
  collectionId: string,
  input: CreateCollectionItemRequest
): Effect.Effect<
  CollectionItem,
  NotFoundError | ForbiddenError | InternalError,
  DbService | ClockService | IdService
> =>
  Effect.gen(function* () {
    const collection = yield* loadCollectionForMember(userId, collectionId);
    const db = yield* Db;
    const id = yield* newId;
    const at = yield* nowMs;
    const position = yield* nextPosition(
      'select max(position) as max from collection_items where collection_id = ? and deleted_at is null',
      collection.id
    );
    const note = nullableText(input.note);
    const link = nullableText(input.link);
    const coverUrl = nullableText(input.coverUrl);
    const status = nullableText(input.status);
    const score = nullableInt(input.score);

    yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `insert into collection_items
               (id, collection_id, space_id, created_by_user_id, title, note, link,
                cover_url, status, score, position, created_at, updated_at)
             values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            id,
            collection.id,
            collection.space_id,
            userId,
            input.title,
            note,
            link,
            coverUrl,
            status,
            score,
            position,
            at,
            at
          )
          .run(),
      catch: () => new InternalError({}),
    });

    return collectionItemToApi({
      id,
      collection_id: collection.id,
      space_id: collection.space_id,
      created_by_user_id: userId,
      title: input.title,
      note,
      link,
      cover_url: coverUrl,
      status,
      score,
      position,
      created_at: at,
      updated_at: at,
      deleted_at: null,
    });
  });

// ── Update item ──────────────────────────────────────────────────────────

export const updateCollectionItemProgram = (
  userId: string,
  id: string,
  input: UpdateCollectionItemRequest
): Effect.Effect<
  CollectionItem,
  NotFoundError | ForbiddenError | InternalError,
  DbService | ClockService
> =>
  Effect.gen(function* () {
    const existing = yield* loadItemForMember(userId, id);

    const sets: string[] = [];
    const params: unknown[] = [];
    if (input.title !== undefined && input.title !== existing.title) {
      sets.push('title = ?');
      params.push(input.title);
    }
    if (input.note !== undefined) {
      const nextNote = nullableText(input.note);
      if (nextNote !== existing.note) {
        sets.push('note = ?');
        params.push(nextNote);
      }
    }
    if (input.link !== undefined) {
      const nextLink = nullableText(input.link);
      if (nextLink !== existing.link) {
        sets.push('link = ?');
        params.push(nextLink);
      }
    }
    if (input.coverUrl !== undefined) {
      const nextCover = nullableText(input.coverUrl);
      if (nextCover !== existing.cover_url) {
        sets.push('cover_url = ?');
        params.push(nextCover);
      }
    }
    if (input.status !== undefined) {
      const nextStatus = nullableText(input.status);
      if (nextStatus !== existing.status) {
        sets.push('status = ?');
        params.push(nextStatus);
      }
    }
    if (input.score !== undefined) {
      const nextScore = nullableInt(input.score);
      if (nextScore !== existing.score) {
        sets.push('score = ?');
        params.push(nextScore);
      }
    }
    if (input.position !== undefined && input.position !== existing.position) {
      sets.push('position = ?');
      params.push(input.position);
    }

    if (sets.length === 0) {
      return collectionItemToApi(existing);
    }

    const db = yield* Db;
    const at = yield* nowMs;
    yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `update collection_items set ${sets.join(', ')}, updated_at = ?
             where id = ? and deleted_at is null`
          )
          .bind(...params, at, id)
          .run(),
      catch: () => new InternalError({}),
    });

    const updated = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(`${COLLECTION_ITEM_SELECT} where id = ? and deleted_at is null limit 1`)
          .bind(id)
          .first<CollectionItemRow>(),
      catch: () => new InternalError({}),
    });
    if (!updated) {
      return yield* Effect.fail(notFound('Collection item not found'));
    }

    return collectionItemToApi(updated);
  });

// ── Delete item (soft) ───────────────────────────────────────────────────

export const deleteCollectionItemProgram = (
  userId: string,
  id: string
): Effect.Effect<
  { ok: true },
  NotFoundError | ForbiddenError | InternalError,
  DbService | ClockService
> =>
  Effect.gen(function* () {
    yield* loadItemForMember(userId, id);
    const db = yield* Db;
    const at = yield* nowMs;

    yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            'update collection_items set deleted_at = ?, updated_at = ? where id = ? and deleted_at is null'
          )
          .bind(at, at, id)
          .run(),
      catch: () => new InternalError({}),
    });

    return { ok: true as const };
  });
