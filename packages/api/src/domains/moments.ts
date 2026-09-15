import { Effect } from 'effect';

import type {
  CreateMomentRequest,
  MarkMomentsReadRequest,
  Moment,
  MomentAttachment,
  MomentAttachmentInput,
  MomentListResponse,
  MomentType,
  TimelineResponse,
  UpdateMomentRequest,
} from '@aoi/shared';

import { MOMENT_ATTACHMENT_MAX, mediaObjectUrl } from '@aoi/shared';

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
 * Moments domain — the vertical slice: authorization, keyset pagination,
 * idempotent create, guarded update/delete with tombstones + activity rows
 * written atomically, and queue-based partner notification.
 *
 * Invariants:
 * - every mutation is scoped to the caller's OWN moment (403 otherwise) and
 *   to an active membership of the moment's space;
 * - create with a `clientId` is idempotent via the partial unique
 *   `uq_moments_space_client_id` (space_id, client_id) WHERE deleted_at IS
 *   NULL — a duplicate is a replay of the first result, never a second row;
 * - update/delete are guarded `UPDATE … WHERE deleted_at IS NULL` in one D1
 *   batch with the activity insert (the insert only fires when the guard
 *   matched — `(SELECT changes()) > 0`), so a double-delete is a 404 that
 *   never produces a second tombstone row;
 * - attribution is computed per request (viewer-relative `isOwn`,
 *   `authorRole`), never read from the stored snapshot columns;
 * - partner notification is enqueued (one queue), never sent inline.
 */

export interface MomentRow {
  id: string;
  type: string;
  title: string;
  body: string;
  occurred_at: number;
  target_at: number | null;
  created_at: number;
  updated_at: number;
  created_by_user_id: string;
  author_name: string;
  media_preview: string | null;
  audio_uri: string | null;
  media_id: string | null;
}

const MOMENT_SELECT = `
  select m.id, m.type, m.title, m.body, m.occurred_at, m.target_at,
         m.created_at, m.updated_at, m.created_by_user_id,
         u.name as author_name, m.media_preview, m.audio_uri, m.media_id
  from moments m
  join users u on u.id = m.created_by_user_id
`;

const MOMENT_SELECT_WHERE_ID = `${MOMENT_SELECT} where m.id = ? and m.deleted_at is null`;

/** Viewer-relative serializer — the ONLY shape a moment leaves the domain. */
export function momentToApi(
  row: MomentRow,
  viewerUserId: string,
  attachments: MomentAttachment[] = []
): Moment {
  const isOwn = row.created_by_user_id === viewerUserId;
  return {
    id: row.id,
    type: row.type as MomentType,
    title: row.title,
    body: row.body,
    occurredAt: new Date(row.occurred_at).toISOString(),
    targetAt: row.target_at === null ? null : new Date(row.target_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    authorId: row.created_by_user_id,
    authorRole: isOwn ? 'you' : 'partner',
    authorName: isOwn ? 'You' : row.author_name,
    isOwn,
    mediaPreview: row.media_preview,
    audioUri: row.audio_uri,
    mediaId: row.media_id,
    attachments,
  };
}

/**
 * Parse the opaque composite cursor `occurredAtMs|id`. Legacy bare-ISO
 * cursors (one page, client-ephemeral) are accepted for backward
 * compatibility. Returns null for anything unrecognized.
 */
export /**
 * Media lifecycle (one-media-per-moment is NOT guaranteed — `media_id` has
 * no uniqueness, so several live moments may share one media row):
 * - attaching (create, or update that changes `media_id`) requires a live
 *   same-space media row, so a delete racing the attach cannot leave a
 *   moment pointing at tombstoned media (fail-closed 404);
 * - deleting a moment, or replacing its media, releases the previous media
 *   id only when no other live moment references it. The release runs in
 *   the SAME batch as the moment tombstone/update, so the
 *   `not exists (live reference)` check observes the post-write state and
 *   a concurrent new reference cannot slip between check and write.
 * - release is logical (`deleted_at`): quota drops immediately (usage sums
 *   only non-deleted pending/complete rows), reads 404 per current
 *   semantics, and the R2 bytes stay referenced for the retryable media
 *   purge — an R2 failure never loses the DB row.
 */
const releaseMediaIfUnreferenced = (db: DbService, mediaId: string, at: number) =>
  db.d1.prepare(
    `update media_objects set deleted_at = ?
     where id = ? and deleted_at is null
       and not exists (select 1 from moments where media_id = ? and deleted_at is null)
       and not exists (select 1 from moment_attachments ma
                       join moments m on m.id = ma.moment_id
                       where ma.media_id = ? and m.deleted_at is null)`
  ).bind(at, mediaId, mediaId, mediaId);

const requireLiveSpaceMedia = (
  db: DbService,
  spaceId: string,
  mediaId: string
): Effect.Effect<void, NotFoundError | InternalError> =>
  Effect.gen(function* () {
    const row = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare('select id from media_objects where id = ? and space_id = ? and deleted_at is null')
          .bind(mediaId, spaceId)
          .first<{ id: string }>(),
      catch: () => new InternalError({}),
    });
    if (!row) {
      return yield* Effect.fail(notFound('Media not found'));
    }
  });

/**
 * Ordered multi-attachment helpers (unified memory composer).
 *
 * Write rules:
 * - input is `{ mediaId, kind }` only (ordered, max 10) — no device URI,
 *   no URL, no remote path; `.strict()` at the schema rejects extras;
 * - each entry must be the caller's OWN upload (`created_by_user_id`),
 *   in the moment's space, `complete`, live (`deleted_at IS NULL`), with
 *   the declared `kind` matching the stored MIME family. Fail-closed:
 *   missing/deleted/wrong-space/wrong-owner is 404 (no existence oracle),
 *   incomplete or kind-mismatched is 400;
 * - `kind` is image|audio only — video stays rejected until a privacy
 *   stripping + playback pipeline exists.
 *
 * Read rules: `url` is the stable member-authorized serve URL —
 * `mediaObjectUrl(id, 'display')` for images, `mediaObjectUrl(id,
 * 'original')` for audio. Legacy `media_preview`/`audio_uri`/`media_id`
 * columns are preserved for old clients and derived from the first
 * image/audio attachment whenever attachments are written.
 */

export function attachmentUrl(mediaId: string, kind: 'image' | 'audio'): string {
  return mediaObjectUrl(mediaId, kind === 'image' ? 'display' : 'original');
}

interface AttachmentMediaRow {
  id: string;
  space_id: string;
  created_by_user_id: string;
  mime_type: string;
  upload_state: string;
}

const requireValidAttachments = (
  db: DbService,
  spaceId: string,
  userId: string,
  attachments: MomentAttachmentInput[] | undefined
): Effect.Effect<void, BadRequestError | NotFoundError | InternalError> =>
  Effect.gen(function* () {
    if (!attachments || attachments.length === 0) return;
    if (attachments.length > MOMENT_ATTACHMENT_MAX) {
      return yield* Effect.fail(badRequest('Too many attachments'));
    }
    const seen = new Set<string>();
    for (const item of attachments) {
      if (seen.has(item.mediaId)) {
        return yield* Effect.fail(badRequest('Duplicate media ids'));
      }
      seen.add(item.mediaId);
    }
    const placeholders = attachments.map(() => '?').join(',');
    const rows = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `select id, space_id, created_by_user_id, mime_type, upload_state
             from media_objects where id in (${placeholders}) and deleted_at is null`
          )
          .bind(...attachments.map((item) => item.mediaId))
          .all<AttachmentMediaRow>(),
      catch: () => new InternalError({}),
    });
    const byId = new Map((rows.results ?? []).map((row) => [row.id, row]));
    for (const item of attachments) {
      const media = byId.get(item.mediaId);
      if (!media || media.space_id !== spaceId || media.created_by_user_id !== userId) {
        return yield* Effect.fail(notFound('Media not found'));
      }
      if (media.upload_state !== 'complete') {
        return yield* Effect.fail(badRequest('Media is not ready'));
      }
      const actualKind = media.mime_type.startsWith('audio/') ? 'audio' : 'image';
      if (item.kind !== actualKind) {
        return yield* Effect.fail(badRequest('MIME type does not match the declared kind'));
      }
    }
  });

/** Derive legacy single-media columns from the ordered attachment set. */
function deriveLegacyFromAttachments(attachments: MomentAttachmentInput[]): {
  mediaId: string | null;
  mediaPreview: string | null;
  audioUri: string | null;
} {
  if (attachments.length === 0) {
    return { mediaId: null, mediaPreview: null, audioUri: null };
  }
  const firstImage = attachments.find((item) => item.kind === 'image');
  const firstAudio = attachments.find((item) => item.kind === 'audio');
  return {
    mediaId: attachments[0].mediaId,
    mediaPreview: firstImage ? attachmentUrl(firstImage.mediaId, 'image') : null,
    audioUri: firstAudio ? attachmentUrl(firstAudio.mediaId, 'audio') : null,
  };
}

interface AttachmentRow {
  moment_id: string;
  media_id: string;
  position: number;
  kind: string;
}

/**
 * Batched attachment fetch — one bounded query per page (≤100 moments ×
 * ≤10 attachments), never N+1 per row. Returns ordered response
 * attachments per moment id. Moments with no attachment rows but a legacy
 * `media_id` synthesize a single entry from the live media row (existing-
 * records compatibility) so new clients see old photos via `attachments`
 * while old clients keep reading the legacy columns.
 */
const fetchAttachmentsMap = (
  db: DbService,
  rows: { id: string; media_id: string | null }[]
): Effect.Effect<Map<string, MomentAttachment[]>, InternalError> =>
  Effect.gen(function* () {
    const map = new Map<string, MomentAttachment[]>();
    if (rows.length === 0) return map;
    for (const row of rows) map.set(row.id, []);
    const placeholders = rows.map(() => '?').join(',');
    const attached = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `select moment_id, media_id, position, kind from moment_attachments
             where moment_id in (${placeholders}) order by moment_id, position`
          )
          .bind(...rows.map((row) => row.id))
          .all<AttachmentRow>(),
      catch: () => new InternalError({}),
    });
    for (const item of attached.results ?? []) {
      const kind = item.kind === 'audio' ? 'audio' : 'image';
      map.get(item.moment_id)?.push({
        mediaId: item.media_id,
        kind,
        url: attachmentUrl(item.media_id, kind),
      });
    }
    const legacyIds = rows.filter((row) => (map.get(row.id)?.length ?? 0) === 0 && row.media_id !== null);
    if (legacyIds.length === 0) return map;
    const mediaPlaceholders = legacyIds.map(() => '?').join(',');
    const mediaRows = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `select id, mime_type from media_objects
             where id in (${mediaPlaceholders}) and deleted_at is null`
          )
          .bind(...legacyIds.map((row) => row.media_id as string))
          .all<{ id: string; mime_type: string }>(),
      catch: () => new InternalError({}),
    });
    const mimeById = new Map((mediaRows.results ?? []).map((row) => [row.id, row.mime_type]));
    for (const row of legacyIds) {
      const mime = mimeById.get(row.media_id as string);
      if (!mime) continue;
      const kind = mime.startsWith('audio/') ? 'audio' : 'image';
      map.set(row.id, [
        {
          mediaId: row.media_id as string,
          kind,
          url: attachmentUrl(row.media_id as string, kind),
        },
      ]);
    }
    return map;
  });

export function parseMomentCursor(cursor: string | undefined): {
  occurredAtMs: number;
  id: string | null;
} | null {
  if (!cursor) return null;
  const pipe = cursor.indexOf('|');
  if (pipe > 0) {
    const ms = Number(cursor.slice(0, pipe));
    const id = cursor.slice(pipe + 1);
    if (Number.isFinite(ms) && ms >= 0 && id.length > 0) {
      return { occurredAtMs: ms, id };
    }
    return null;
  }
  const legacy = Date.parse(cursor);
  if (Number.isFinite(legacy)) {
    return { occurredAtMs: legacy, id: null };
  }
  return null;
}

export const MOMENT_LIST_DEFAULT_LIMIT = 20;
export const MOMENT_LIST_MAX_LIMIT = 100;
/** Chapter ranges (monthly ≈ 31d, anniversary ≈ 366d) stay bounded. */
export const CHAPTER_RANGE_MAX_MS = 400 * 24 * 60 * 60 * 1000;

/**
 * List moments, newest first, keyset-paginated by `(occurred_at, id)` with a
 * `limit+1` hasMore probe. Optional `fromMs`/`toMs` bound occurred_at to
 * [fromMs, toMs) so a chapter range pages to completion without crawling
 * the archive (validated: finite, fromMs < toMs, span ≤ 400 days). Ranged
 * reads additionally apply chapter eligibility (note/media/trace only) —
 * unbounded reads are unchanged.
 * No active space → empty feed (never an error).
 */
export const listMomentsProgram = (
  userId: string,
  query: { cursor?: string; limit?: number; fromMs?: number; toMs?: number; type?: string }
): Effect.Effect<MomentListResponse, BadRequestError | InternalError, DbService | ClockService> =>
  Effect.gen(function* () {
    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return { moments: [], nextCursor: undefined };
    }

    const limit = Math.min(Math.max(query.limit ?? MOMENT_LIST_DEFAULT_LIMIT, 1), MOMENT_LIST_MAX_LIMIT);
    const cursor = parseMomentCursor(query.cursor);
    if (query.cursor !== undefined && cursor === null) {
      return yield* Effect.fail(badRequest('Invalid cursor'));
    }

    const fromMs = query.fromMs ?? null;
    const toMs = query.toMs ?? null;
    if (fromMs !== null || toMs !== null) {
      if (
        fromMs === null ||
        toMs === null ||
        !Number.isFinite(fromMs) ||
        !Number.isFinite(toMs) ||
        fromMs >= toMs ||
        toMs - fromMs > CHAPTER_RANGE_MAX_MS
      ) {
        return yield* Effect.fail(badRequest('Invalid range'));
      }
    }

    // Single-type filter for Plans-owned reads (goals); validated against
    // the same enum the write path uses.
    const MOMENT_TYPES = ['note', 'milestone', 'date', 'goal', 'media', 'trace'] as const;
    const typeFilter: string | null = query.type ?? null;
    if (typeFilter !== null && !(MOMENT_TYPES as readonly string[]).includes(typeFilter)) {
      return yield* Effect.fail(badRequest('Invalid type'));
    }

    const db = yield* Db;
    const rows = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `${MOMENT_SELECT}
             where m.space_id = ? and m.deleted_at is null
               and (? is null or ? is not null or m.type in ('note', 'media', 'trace'))
               and (? is null or m.type = ?)
               and (? is null or m.occurred_at >= ?)
               and (? is null or m.occurred_at < ?)
               and (? is null or m.occurred_at < ? or (m.occurred_at = ? and m.id < ?))
             order by m.occurred_at desc, m.id desc
             limit ?`
          )
          .bind(
            spaceId,
            fromMs,
            typeFilter,
            typeFilter,
            typeFilter ?? '',
            fromMs,
            fromMs ?? 0,
            toMs,
            toMs ?? 0,
            cursor ? cursor.occurredAtMs : null,
            cursor ? cursor.occurredAtMs : 0,
            cursor ? cursor.occurredAtMs : 0,
            cursor?.id ?? '',
            limit + 1
          )
          .all<MomentRow>(),
      catch: () => new InternalError({}),
    });

    const results = rows.results ?? [];
    const hasMore = results.length > limit;
    const page = results.slice(0, limit);
    const attachmentsByMoment = yield* fetchAttachmentsMap(db, page);
    const items = page.map((row) => momentToApi(row, userId, attachmentsByMoment.get(row.id) ?? []));

    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last
        ? `${Date.parse(last.occurredAt)}|${last.id}`
        : undefined;

    return { moments: items, nextCursor };
  });

/**
 * Chapter-discovery bucket summary over client-supplied absolute bounds.
 * The server performs zero timezone math: it counts eligible memories and
 * finds the earliest photo inside each [fromMs, toMs) bucket, plus whether
 * any eligible memory predates the earliest bucket (`hasOlder` = explicit
 * exhaustion). One batched round trip for ≤24 buckets; no moment bodies.
 * No active space → empty.
 */
export const MAX_SUMMARY_BUCKETS = 24;

export const listBucketSummaryProgram = (
  userId: string,
  query: { buckets?: string }
): Effect.Effect<{ buckets: { fromMs: number; toMs: number; count: number; cover: string | null }[]; hasOlder: boolean }, BadRequestError | InternalError, DbService> =>
  Effect.gen(function* () {
    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return { buckets: [], hasOlder: false };
    }

    const bounds: { fromMs: number; toMs: number }[] = [];
    if (query.buckets !== undefined) {
      for (const pair of query.buckets.split(',')) {
        const [fromRaw, toRaw] = pair.split(':');
        const fromMs = Number(fromRaw);
        const toMs = Number(toRaw);
        if (
          !Number.isFinite(fromMs) ||
          !Number.isFinite(toMs) ||
          fromMs < 0 ||
          toMs < 0 ||
          fromMs >= toMs ||
          toMs - fromMs > CHAPTER_RANGE_MAX_MS
        ) {
          return yield* Effect.fail(badRequest('Invalid buckets'));
        }
        bounds.push({ fromMs, toMs });
      }
    }
    if (bounds.length === 0 || bounds.length > MAX_SUMMARY_BUCKETS) {
      return yield* Effect.fail(badRequest('Invalid buckets'));
    }

    const db = yield* Db;
    // Sequential bounded reads (≤24 tiny aggregates + 1 probe): one round
    // trip per bucket keeps each query independently bounded anyway.
    const oldestFrom = Math.min(...bounds.map((bound) => bound.fromMs));
    const buckets: { fromMs: number; toMs: number; count: number; cover: string | null }[] = [];
    for (const bound of bounds) {
      const row = yield* Effect.tryPromise({
        try: () =>
          db.d1
            .prepare(
              `select count(*) as count,
                      (select m2.media_preview from moments m2
                       where m2.space_id = ? and m2.deleted_at is null
                         and m2.type = 'media' and m2.media_preview is not null
                         and m2.occurred_at >= ? and m2.occurred_at < ?
                       order by m2.occurred_at asc, m2.id asc limit 1) as cover
               from moments m
               where m.space_id = ? and m.deleted_at is null
                 and m.type in ('note', 'media', 'trace')
                 and m.occurred_at >= ? and m.occurred_at < ?`
            )
            .bind(spaceId, bound.fromMs, bound.toMs, spaceId, bound.fromMs, bound.toMs)
            .first<{ count: number; cover: string | null }>(),
        catch: () => new InternalError({}),
      });
      buckets.push({
        fromMs: bound.fromMs,
        toMs: bound.toMs,
        count: row?.count ?? 0,
        cover: row?.cover ?? null,
      });
    }
    const older = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `select 1 as older from moments m
             where m.space_id = ? and m.deleted_at is null
               and m.type in ('note', 'media', 'trace')
               and m.occurred_at < ? limit 1`
          )
          .bind(spaceId, oldestFrom)
          .first<{ older: number }>(),
      catch: () => new InternalError({}),
    });
    return { buckets, hasOlder: older !== null };
  });

export interface CreateMomentResult {
  moment: Moment;
  /** false when the clientId replay hit the existing row (idempotent). */
  created: boolean;
}

/**
 * Create a moment. When `clientId` is supplied, the partial unique makes a
 * duplicate (space, clientId) a no-op that returns the first result — the
 * double-tap fix. The author snapshot (role + display name) is captured at
 * creation; reads always recompute attribution from user ids.
 *
 * Attachments (`attachments`, ordered max 10) persist atomically with the
 * moment in one D1 batch: the moment insert plus one guarded
 * `INSERT … SELECT … WHERE EXISTS (moment)` per attachment, so a
 * clientId race that loses the moment insert inserts zero attachment rows
 * and falls back to replaying the winner (original content + attachments,
 * no duplicate media links, no second push). Legacy single-media columns
 * are preserved: omitted attachments leave old fields as-supplied; a
 * supplied non-empty set re-derives them from the first image/audio for
 * old clients. A replay returns the original row + its attachments.
 */
export const createMomentProgram = (
  userId: string,
  input: CreateMomentRequest
): Effect.Effect<CreateMomentResult, BadRequestError | ForbiddenError | NotFoundError | InternalError, DbService | JobQueueService | LoggerService | ClockService | IdService> =>
  Effect.gen(function* () {
    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return yield* Effect.fail(badRequest('You must have an active space to create moments'));
    }

    const db = yield* Db;
    const author = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `select sm.role, u.name
             from space_members sm
             join users u on u.id = sm.user_id
             where sm.space_id = ? and sm.user_id = ? and sm.state = 'active'
             limit 1`
          )
          .bind(spaceId, userId)
          .first<{ role: 'you' | 'partner'; name: string }>(),
      catch: () => new InternalError({}),
    });
    if (!author) {
      return yield* Effect.fail(forbidden('You are not an active member of this space'));
    }

    const attachments = input.attachments ?? undefined;
    yield* requireValidAttachments(db, spaceId, userId, attachments);

    if (input.mediaId) {
      yield* requireLiveSpaceMedia(db, spaceId, input.mediaId);
    }

    // Fast-path replay: a clientId that already resolved returns the
    // original content + attachments with no writes and no second push.
    if (input.clientId) {
      const replayed = yield* Effect.tryPromise({
        try: () =>
          db.d1
            .prepare(
              `${MOMENT_SELECT}
               where m.space_id = ? and m.created_by_user_id = ?
                 and m.client_id = ? and m.deleted_at is null
               limit 1`
            )
            .bind(spaceId, userId, input.clientId)
            .first<MomentRow>(),
        catch: () => new InternalError({}),
      });
      if (replayed) {
        const existingAttachments = yield* fetchAttachmentsMap(db, [replayed]);
        return {
          moment: momentToApi(replayed, userId, existingAttachments.get(replayed.id) ?? []),
          created: false,
        };
      }
    }

    const id = yield* newId;
    const at = yield* nowMs;
    const occurredAt = input.occurredAt ? Date.parse(input.occurredAt) : at;
    const targetAt = input.targetAt ? Date.parse(input.targetAt) : null;

    let mediaPreview = input.mediaPreview ?? null;
    let audioUri = input.audioUri ?? null;
    let mediaId = input.mediaId ?? null;
    if (attachments !== undefined && attachments.length > 0) {
      const derived = deriveLegacyFromAttachments(attachments);
      mediaPreview = derived.mediaPreview;
      audioUri = derived.audioUri;
      mediaId = derived.mediaId;
    }

    const results = yield* batch([
      db.d1
        .prepare(
          `insert into moments
             (id, space_id, created_by_user_id, author_role, author_name,
              type, title, body, occurred_at, target_at, media_preview,
              audio_uri, media_id, client_id, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           on conflict do nothing`
        )
        .bind(
          id,
          spaceId,
          userId,
          author.role,
          author.name,
          input.type,
          input.title ?? '',
          input.body ?? '',
          occurredAt,
          targetAt,
          mediaPreview,
          audioUri,
          mediaId,
          input.clientId ?? null,
          at,
          at
        ),
      ...((attachments ?? []).map((item, position) =>
        db.d1
          .prepare(
            `insert into moment_attachments (moment_id, media_id, position, kind)
             select ?, ?, ?, ? where exists (select 1 from moments where id = ?)`
          )
          .bind(id, item.mediaId, position, item.kind, id)
      )),
    ]);

    const inserted = (results[0]?.meta?.changes ?? 0) > 0;
    let row: MomentRow | null = null;

    if (inserted) {
      row = yield* Effect.tryPromise({
        try: () =>
          db.d1
            .prepare(`${MOMENT_SELECT_WHERE_ID}`)
            .bind(id)
            .first<MomentRow>(),
        catch: () => new InternalError({}),
      });
    } else {
      // Lost a clientId race between the fast-path read and the batch:
      // replay the winner (creator-scoped, never the other partner's row).
      row = yield* Effect.tryPromise({
        try: () =>
          db.d1
            .prepare(
              `${MOMENT_SELECT}
               where m.space_id = ? and m.created_by_user_id = ?
                 and m.client_id = ? and m.deleted_at is null
               limit 1`
            )
            .bind(spaceId, userId, input.clientId ?? null)
            .first<MomentRow>(),
        catch: () => new InternalError({}),
      });
    }

    if (!row) {
      return yield* Effect.fail(new InternalError({}));
    }

    const attachmentsByMoment = yield* fetchAttachmentsMap(db, [row]);

    // Fire-and-forget partner notification — kind only, never content.
    // Only on a fresh create: a clientId replay already notified on the
    // first request (a duplicate push must never fire from a double-tap).
    if (inserted) {
      yield* enqueueJob({ type: 'push.deliver', kind: 'moment_added', spaceId, fromUserId: userId });
    }

    return {
      moment: momentToApi(row, userId, attachmentsByMoment.get(row.id) ?? []),
      created: inserted,
    };
  });

/**
 * Guarded update: own-only, active membership required, `deleted_at IS NULL`
 * re-checked inside the SAME batch as the activity insert (which only fires
 * when the update matched — `(SELECT changes()) > 0`). Atomic and idempotent.
 *
 * Attachments are an explicit optional replacement: omitted = attachments
 * untouched (legacy single-media fields update independently as before,
 * never erased); supplied (including `[]` to clear) = atomically replace
 * the full ordered set in the same batch, re-deriving the legacy columns
 * for old clients. Replaced-away media releases in the same batch when no
 * other live moment (legacy or attachment) references it.
 */
export const updateMomentProgram = (
  userId: string,
  momentId: string,
  input: UpdateMomentRequest
): Effect.Effect<Moment, BadRequestError | ForbiddenError | NotFoundError | InternalError, DbService | JobQueueService | LoggerService | ClockService | IdService> =>
  Effect.gen(function* () {
    const db = yield* Db;

    const existing = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `select id, space_id, created_by_user_id, media_id from moments
             where id = ? and deleted_at is null limit 1`
          )
          .bind(momentId)
          .first<{ id: string; space_id: string; created_by_user_id: string; media_id: string | null }>(),
      catch: () => new InternalError({}),
    });
    if (!existing) {
      return yield* Effect.fail(notFound('Moment not found'));
    }
    if (existing.created_by_user_id !== userId) {
      return yield* Effect.fail(forbidden('You can only edit your own moments'));
    }

    const membership = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `select 1 from space_members
             where space_id = ? and user_id = ? and state = 'active' limit 1`
          )
          .bind(existing.space_id, userId)
          .first(),
      catch: () => new InternalError({}),
    });
    if (!membership) {
      return yield* Effect.fail(forbidden('You are not an active member of this space'));
    }

    const attachments = input.attachments ?? undefined;
    yield* requireValidAttachments(db, existing.space_id, userId, attachments);
    const replacingAttachments = attachments !== undefined;

    const oldAttachmentIds = replacingAttachments
      ? yield* Effect.tryPromise({
          try: () =>
            db.d1
              .prepare(`select media_id from moment_attachments where moment_id = ?`)
              .bind(momentId)
              .all<{ media_id: string }>(),
          catch: () => new InternalError({}),
        }).pipe(Effect.map((res) => (res.results ?? []).map((row) => row.media_id)))
      : [];

    // Field whitelist → SET clause (never interpolate request keys).
    const sets: string[] = ['updated_at = ?'];
    const params: unknown[] = [yield* nowMs];
    if (input.type !== undefined) { sets.push('type = ?'); params.push(input.type); }
    if (input.title !== undefined) { sets.push('title = ?'); params.push(input.title); }
    if (input.body !== undefined) { sets.push('body = ?'); params.push(input.body); }
    if (input.occurredAt !== undefined) { sets.push('occurred_at = ?'); params.push(Date.parse(input.occurredAt)); }
    if (input.targetAt !== undefined) { sets.push('target_at = ?'); params.push(input.targetAt ? Date.parse(input.targetAt) : null); }
    if (replacingAttachments) {
      const derived = deriveLegacyFromAttachments(attachments ?? []);
      sets.push('media_preview = ?'); params.push(derived.mediaPreview);
      sets.push('audio_uri = ?'); params.push(derived.audioUri);
      sets.push('media_id = ?'); params.push(derived.mediaId);
    } else {
      if (input.mediaPreview !== undefined) { sets.push('media_preview = ?'); params.push(input.mediaPreview); }
      if (input.audioUri !== undefined) { sets.push('audio_uri = ?'); params.push(input.audioUri); }
      if (input.mediaId !== undefined) { sets.push('media_id = ?'); params.push(input.mediaId); }
    }

    const at = yield* nowMs;
    const activityId = yield* newId;
    const newMediaIds = replacingAttachments ? new Set((attachments ?? []).map((item) => item.mediaId)) : null;
    const legacyChanged =
      !replacingAttachments && input.mediaId !== undefined && input.mediaId !== existing.media_id;
    if (legacyChanged && input.mediaId) {
      yield* requireLiveSpaceMedia(db, existing.space_id, input.mediaId);
    }
    const toRelease = new Set<string>();
    if (replacingAttachments) {
      if (existing.media_id && !newMediaIds?.has(existing.media_id)) {
        toRelease.add(existing.media_id);
      }
      for (const oldId of oldAttachmentIds) {
        if (!newMediaIds?.has(oldId)) toRelease.add(oldId);
      }
    } else if (legacyChanged && existing.media_id) {
      toRelease.add(existing.media_id);
    }
    const results = yield* batch([
      db.d1
        .prepare(`update moments set ${sets.join(', ')} where id = ? and deleted_at is null`)
        .bind(...params, momentId),
      db.d1
        .prepare(
          `insert into space_activity (id, space_id, actor_user_id, kind, subject_id, occurred_at)
           select ?, ?, ?, 'moment_edited', ?, ?
           where (select changes()) > 0`
        )
        .bind(activityId, existing.space_id, userId, momentId, at),
      // Attachment replacement follows the activity guard so `(select
      // changes())` still observes the moments update, not the attachment
      // writes. Same atomic batch: delete + re-insert + releases observe
      // post-write state with the tombstone guard.
      ...(replacingAttachments
        ? [
            db.d1.prepare(`delete from moment_attachments where moment_id = ?`).bind(momentId),
            ...((attachments ?? []).map((item, position) =>
              db.d1
                .prepare(
                  `insert into moment_attachments (moment_id, media_id, position, kind)
                   values (?, ?, ?, ?)`
                )
                .bind(momentId, item.mediaId, position, item.kind)
            )),
          ]
        : []),
      ...[...toRelease].map((mediaId) => releaseMediaIfUnreferenced(db, mediaId, at)),
    ]);

    if ((results[0]?.meta?.changes ?? 0) === 0) {
      return yield* Effect.fail(notFound('Moment not found'));
    }

    const row = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(`${MOMENT_SELECT_WHERE_ID}`)
          .bind(momentId)
          .first<MomentRow>(),
      catch: () => new InternalError({}),
    });
    if (!row) {
      return yield* Effect.fail(new InternalError({}));
    }

    const attachmentsByMoment = yield* fetchAttachmentsMap(db, [row]);

    yield* enqueueJob({ type: 'push.deliver', kind: 'moment_edited', spaceId: existing.space_id, fromUserId: userId });

    return momentToApi(row, userId, attachmentsByMoment.get(row.id) ?? []);
  });

/**
 * Soft delete (tombstone): own-only, guarded `deleted_at` flip + activity row
 * in one batch. A second delete sees the guard fail → 404, no new tombstone.
 */
export const deleteMomentProgram = (
  userId: string,
  momentId: string
): Effect.Effect<{ ok: true }, ForbiddenError | NotFoundError | InternalError, DbService | JobQueueService | LoggerService | ClockService | IdService> =>
  Effect.gen(function* () {
    const db = yield* Db;

    const existing = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `select id, space_id, created_by_user_id, media_id from moments
             where id = ? and deleted_at is null limit 1`
          )
          .bind(momentId)
          .first<{ id: string; space_id: string; created_by_user_id: string; media_id: string | null }>(),
      catch: () => new InternalError({}),
    });
    if (!existing) {
      return yield* Effect.fail(notFound('Moment not found'));
    }
    if (existing.created_by_user_id !== userId) {
      return yield* Effect.fail(forbidden('You can only delete your own moments'));
    }

    const membership = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `select 1 from space_members
             where space_id = ? and user_id = ? and state = 'active' limit 1`
          )
          .bind(existing.space_id, userId)
          .first(),
      catch: () => new InternalError({}),
    });
    if (!membership) {
      return yield* Effect.fail(forbidden('You are not an active member of this space'));
    }

    const at = yield* nowMs;
    const activityId = yield* newId;
    const attached = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(`select media_id from moment_attachments where moment_id = ?`)
          .bind(momentId)
          .all<{ media_id: string }>(),
      catch: () => new InternalError({}),
    });
    const toRelease = new Set<string>();
    if (existing.media_id) toRelease.add(existing.media_id);
    for (const row of attached.results ?? []) toRelease.add(row.media_id);
    const results = yield* batch([
      db.d1
        .prepare(`update moments set deleted_at = ?, updated_at = ? where id = ? and deleted_at is null`)
        .bind(at, at, momentId),
      db.d1
        .prepare(
          `insert into space_activity (id, space_id, actor_user_id, kind, subject_id, occurred_at)
           select ?, ?, ?, 'moment_deleted', ?, ?
           where (select changes()) > 0`
        )
        .bind(activityId, existing.space_id, userId, momentId, at),
      // Unreferenced-media release, same atomic batch (see helper): quota
      // drops in the same step as the tombstone, and a concurrent new
      // reference wins the race instead of losing its media. Both the
      // legacy `media_id` and every attachment row are releasable; the
      // `not exists` checks cover both reference paths in post-write state.
      ...[...toRelease].map((mediaId) => releaseMediaIfUnreferenced(db, mediaId, at)),
    ]);

    if ((results[0]?.meta?.changes ?? 0) === 0) {
      return yield* Effect.fail(notFound('Moment not found'));
    }

    yield* enqueueJob({ type: 'push.deliver', kind: 'moment_deleted', spaceId: existing.space_id, fromUserId: userId });

    return { ok: true as const };
  });

/**
 * Bounded synced read state + bidirectional chronological timeline.
 *
 * Eligibility (visible-only): live moments excluding goals
 * (`deleted_at IS NULL AND type != 'goal'`). Own moments are included in
 * the timeline as intrinsically read; unread is partner-only plus unread:
 * `created_by_user_id != viewer AND NOT EXISTS moment_reads`.
 *
 * Ordering is always ascending `(occurred_at ASC, id ASC)` — latest at the
 * bottom. Cursors are the opaque composite `occurredAtMs|id` shared with
 * the legacy list. `before` pages strictly older, `after` strictly newer;
 * both use a `limit+1` probe so `olderCursor`/`newerCursor` are exact.
 * `firstUnread` + `unreadCount` are global across the full space, never
 * just the page, so a years-old first unread is still found without an
 * archive sweep — the initial window centers on it and `newerCursor`
 * pages forward from there.
 *
 * All body fetches are bounded (`LIMIT limit+1`); the count/first-unread
 * probes fetch ids/counts only, never bodies.
 */

export const TIMELINE_DEFAULT_LIMIT = 30;
export const TIMELINE_MAX_LIMIT = 100;

export interface TimelineRow extends MomentRow {
  read_moment_id: string | null;
}

const TIMELINE_SELECT = `
  select m.id, m.type, m.title, m.body, m.occurred_at, m.target_at,
         m.created_at, m.updated_at, m.created_by_user_id,
         u.name as author_name, m.media_preview, m.audio_uri, m.media_id,
         r.moment_id as read_moment_id
  from moments m
  join users u on u.id = m.created_by_user_id
  left join moment_reads r on r.moment_id = m.id and r.user_id = ?
`;

const TIMELINE_ELIGIBLE = `m.space_id = ? and m.deleted_at is null and m.type != 'goal'`;

function timelineCursorOf(row: { occurred_at: number; id: string }): string {
  return `${row.occurred_at}|${row.id}`;
}

/** Timeline serializer — always includes viewer-relative `isRead`. */
export function timelineRowToApi(
  row: TimelineRow,
  viewerUserId: string,
  attachments: MomentAttachment[] = []
): Moment {
  const base = momentToApi(row, viewerUserId, attachments);
  const isRead = row.created_by_user_id === viewerUserId || row.read_moment_id !== null;
  return { ...base, isRead };
}

interface TimelineCursor {
  occurredAtMs: number;
  id: string | null;
}

function cursorOlderClause(cursor: TimelineCursor): { sql: string; params: unknown[] } {
  if (cursor.id !== null) {
    return {
      sql: `(m.occurred_at < ? or (m.occurred_at = ? and m.id < ?))`,
      params: [cursor.occurredAtMs, cursor.occurredAtMs, cursor.id],
    };
  }
  return { sql: `m.occurred_at < ?`, params: [cursor.occurredAtMs] };
}

function cursorNewerClause(cursor: TimelineCursor): { sql: string; params: unknown[] } {
  if (cursor.id !== null) {
    return {
      sql: `(m.occurred_at > ? or (m.occurred_at = ? and m.id > ?))`,
      params: [cursor.occurredAtMs, cursor.occurredAtMs, cursor.id],
    };
  }
  return { sql: `m.occurred_at > ?`, params: [cursor.occurredAtMs] };
}

function cursorAtOrNewerClause(cursor: TimelineCursor): { sql: string; params: unknown[] } {
  if (cursor.id !== null) {
    return {
      sql: `(m.occurred_at > ? or (m.occurred_at = ? and m.id >= ?))`,
      params: [cursor.occurredAtMs, cursor.occurredAtMs, cursor.id],
    };
  }
  return { sql: `m.occurred_at >= ?`, params: [cursor.occurredAtMs] };
}

function cursorAtOrOlderClause(cursor: TimelineCursor): { sql: string; params: unknown[] } {
  if (cursor.id !== null) {
    return {
      sql: `(m.occurred_at < ? or (m.occurred_at = ? and m.id <= ?))`,
      params: [cursor.occurredAtMs, cursor.occurredAtMs, cursor.id],
    };
  }
  return { sql: `m.occurred_at <= ?`, params: [cursor.occurredAtMs] };
}

/**
 * List the bidirectional timeline window. No active space → empty timeline
 * (never an error). `before`/`after`/`anchor` are mutually exclusive;
 * unrecognized cursors are 400s, unknown/ineligible anchors are 404s.
 * Moments return ascending with exact older/newer cursors. `anchor` centers
 * the same bounded window as the FIRST-unread path on the saved-composer
 * entry id; `firstUnread` + `unreadCount` stay global for read UI.
 */
export const listTimelineProgram = (
  userId: string,
  query: { before?: string; after?: string; anchor?: string; limit?: number }
): Effect.Effect<TimelineResponse, BadRequestError | NotFoundError | InternalError, DbService> =>
  Effect.gen(function* () {
    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return { moments: [], olderCursor: null, newerCursor: null, firstUnread: null, unreadCount: 0 };
    }

    const limit = Math.min(Math.max(query.limit ?? TIMELINE_DEFAULT_LIMIT, 1), TIMELINE_MAX_LIMIT);

    const beforeParsed = query.before !== undefined ? parseMomentCursor(query.before) : undefined;
    if (beforeParsed === null) {
      return yield* Effect.fail(badRequest('Invalid cursor'));
    }
    const afterParsed = query.after !== undefined ? parseMomentCursor(query.after) : undefined;
    if (afterParsed === null) {
      return yield* Effect.fail(badRequest('Invalid cursor'));
    }
    if (
      [query.before, query.after, query.anchor].filter((entry) => entry !== undefined).length > 1
    ) {
      return yield* Effect.fail(badRequest('Only one of before, after, or anchor may be provided'));
    }
    const before: TimelineCursor | undefined = beforeParsed;
    const after: TimelineCursor | undefined = afterParsed;

    const db = yield* Db;

    const firstUnreadRow = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `select m.id, m.occurred_at from moments m
             where ${TIMELINE_ELIGIBLE}
               and m.created_by_user_id != ?
               and not exists (select 1 from moment_reads r where r.moment_id = m.id and r.user_id = ?)
             order by m.occurred_at asc, m.id asc limit 1`
          )
          .bind(spaceId, userId, userId)
          .first<{ id: string; occurred_at: number }>(),
      catch: () => new InternalError({}),
    });

    const countRow = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `select count(*) as count from moments m
             where ${TIMELINE_ELIGIBLE}
               and m.created_by_user_id != ?
               and not exists (select 1 from moment_reads r where r.moment_id = m.id and r.user_id = ?)`
          )
          .bind(spaceId, userId, userId)
          .first<{ count: number }>(),
      catch: () => new InternalError({}),
    });

    const firstUnread =
      firstUnreadRow === null
        ? null
        : { id: firstUnreadRow.id, occurredAt: new Date(firstUnreadRow.occurred_at).toISOString() };
    const unreadCount = countRow?.count ?? 0;

    const toApi = (rows: TimelineRow[]): Effect.Effect<Moment[], InternalError, never> =>
      Effect.gen(function* () {
        const byMoment = yield* fetchAttachmentsMap(db, rows);
        return rows.map((row) => timelineRowToApi(row, userId, byMoment.get(row.id) ?? []));
      });

    // ── Before: strictly older, immediate predecessors ──────────────────
    if (before !== undefined) {
      const clause = cursorOlderClause(before);
      const rows = yield* Effect.tryPromise({
        try: () =>
          db.d1
            .prepare(
              `${TIMELINE_SELECT}
               where ${TIMELINE_ELIGIBLE} and ${clause.sql}
               order by m.occurred_at desc, m.id desc
               limit ?`
            )
            .bind(userId, spaceId, ...clause.params, limit + 1)
            .all<TimelineRow>(),
        catch: () => new InternalError({}),
      });
      const found = rows.results ?? [];
      const hasOlder = found.length > limit;
      const pageDesc = found.slice(0, limit);
      const pageAsc = [...pageDesc].reverse();

      const newerProbe = cursorAtOrNewerClause(before);
      const hasNewerRow = yield* Effect.tryPromise({
        try: () =>
          db.d1
            .prepare(
              `select 1 as one from moments m
               where ${TIMELINE_ELIGIBLE} and ${newerProbe.sql} limit 1`
            )
            .bind(spaceId, ...newerProbe.params)
            .first<{ one: number }>(),
        catch: () => new InternalError({}),
      });

      if (pageAsc.length === 0) {
        return {
          moments: [],
          olderCursor: null,
          newerCursor: hasNewerRow !== null ? query.before ?? null : null,
          firstUnread,
          unreadCount,
        };
      }
      return {
        moments: yield* toApi(pageAsc),
        olderCursor: hasOlder ? timelineCursorOf(pageAsc[0]) : null,
        newerCursor: hasNewerRow !== null ? timelineCursorOf(pageAsc[pageAsc.length - 1]) : null,
        firstUnread,
        unreadCount,
      };
    }

    // ── After: strictly newer, immediate successors ─────────────────────
    if (after !== undefined) {
      const clause = cursorNewerClause(after);
      const rows = yield* Effect.tryPromise({
        try: () =>
          db.d1
            .prepare(
              `${TIMELINE_SELECT}
               where ${TIMELINE_ELIGIBLE} and ${clause.sql}
               order by m.occurred_at asc, m.id asc
               limit ?`
            )
            .bind(userId, spaceId, ...clause.params, limit + 1)
            .all<TimelineRow>(),
        catch: () => new InternalError({}),
      });
      const found = rows.results ?? [];
      const hasNewer = found.length > limit;
      const pageAsc = found.slice(0, limit);

      const olderProbe = cursorAtOrOlderClause(after);
      const hasOlderRow = yield* Effect.tryPromise({
        try: () =>
          db.d1
            .prepare(
              `select 1 as one from moments m
               where ${TIMELINE_ELIGIBLE} and ${olderProbe.sql} limit 1`
            )
            .bind(spaceId, ...olderProbe.params)
            .first<{ one: number }>(),
        catch: () => new InternalError({}),
      });

      if (pageAsc.length === 0) {
        return {
          moments: [],
          olderCursor: hasOlderRow !== null ? query.after ?? null : null,
          newerCursor: null,
          firstUnread,
          unreadCount,
        };
      }
      return {
        moments: yield* toApi(pageAsc),
        olderCursor: hasOlderRow !== null ? timelineCursorOf(pageAsc[0]) : null,
        newerCursor: hasNewer ? timelineCursorOf(pageAsc[pageAsc.length - 1]) : null,
        firstUnread,
        unreadCount,
      };
    }

    const centeredWindow = (
      anchor: TimelineCursor
    ): Effect.Effect<TimelineResponse, InternalError, never> =>
      Effect.gen(function* () {
        const beforeCount = Math.floor(limit / 2);

        const beforeClause = cursorOlderClause(anchor);
        let hasOlder: boolean;
        let beforePageAsc: TimelineRow[];
        if (beforeCount > 0) {
          const beforeResult = yield* Effect.tryPromise({
            try: () =>
              db.d1
                .prepare(
                  `${TIMELINE_SELECT}
                   where ${TIMELINE_ELIGIBLE} and ${beforeClause.sql}
                   order by m.occurred_at desc, m.id desc
                   limit ?`
                )
                .bind(userId, spaceId, ...beforeClause.params, beforeCount + 1)
                .all<TimelineRow>(),
            catch: () => new InternalError({}),
          });
          const beforeRows = beforeResult.results ?? [];
          hasOlder = beforeRows.length > beforeCount;
          beforePageAsc = [...beforeRows.slice(0, beforeCount)].reverse();
        } else {
          // limit=1: no before page fits, but prior history still exists.
          // Probe strictly-older existence so olderCursor stays exact
          // instead of collapsing to null.
          const olderProbe = yield* Effect.tryPromise({
            try: () =>
              db.d1
                .prepare(
                  `select 1 as one from moments m
                   where ${TIMELINE_ELIGIBLE} and ${beforeClause.sql} limit 1`
                )
                .bind(spaceId, ...beforeClause.params)
                .first<{ one: number }>(),
            catch: () => new InternalError({}),
          });
          hasOlder = olderProbe !== null;
          beforePageAsc = [];
        }

        const remaining = limit - beforePageAsc.length;
        const atOrNewer = cursorAtOrNewerClause(anchor);
        const afterRows = yield* Effect.tryPromise({
          try: () =>
            db.d1
              .prepare(
                `${TIMELINE_SELECT}
                 where ${TIMELINE_ELIGIBLE} and ${atOrNewer.sql}
                 order by m.occurred_at asc, m.id asc
                 limit ?`
              )
              .bind(userId, spaceId, ...atOrNewer.params, remaining + 1)
              .all<TimelineRow>(),
          catch: () => new InternalError({}),
        });
        const afterFound = afterRows.results ?? [];
        const hasNewer = afterFound.length > remaining;
        const afterPageAsc = afterFound.slice(0, remaining);

        const items = [...beforePageAsc, ...afterPageAsc];
        if (items.length === 0) {
          return { moments: [], olderCursor: null, newerCursor: null, firstUnread, unreadCount };
        }
        return {
          moments: yield* toApi(items),
          olderCursor: hasOlder ? timelineCursorOf(items[0]) : null,
          newerCursor: hasNewer ? timelineCursorOf(items[items.length - 1]) : null,
          firstUnread,
          unreadCount,
        };
      });

    // ── Anchor: saved-composer entry, same centered window ──────────────
    if (query.anchor !== undefined) {
      const anchorRow = yield* Effect.tryPromise({
        try: () =>
          db.d1
            .prepare(
              `select m.id, m.occurred_at from moments m
               where ${TIMELINE_ELIGIBLE} and m.id = ? limit 1`
            )
            .bind(spaceId, query.anchor)
            .first<{ id: string; occurred_at: number }>(),
        catch: () => new InternalError({}),
      });
      if (anchorRow === null) {
        return yield* Effect.fail(notFound('Moment not found'));
      }
      return yield* centeredWindow({ occurredAtMs: anchorRow.occurred_at, id: anchorRow.id });
    }

    // ── Initial window: around FIRST unread, else latest ────────────────
    if (firstUnreadRow !== null) {
      return yield* centeredWindow({
        occurredAtMs: firstUnreadRow.occurred_at,
        id: firstUnreadRow.id,
      });
    }

    const latest = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `${TIMELINE_SELECT}
             where ${TIMELINE_ELIGIBLE}
             order by m.occurred_at desc, m.id desc
             limit ?`
          )
          .bind(userId, spaceId, limit + 1)
          .all<TimelineRow>(),
      catch: () => new InternalError({}),
    });
    const latestFound = latest.results ?? [];
    const hasOlderLatest = latestFound.length > limit;
    const latestPageAsc = [...latestFound.slice(0, limit)].reverse();
    if (latestPageAsc.length === 0) {
      return { moments: [], olderCursor: null, newerCursor: null, firstUnread, unreadCount };
    }
    return {
      moments: yield* toApi(latestPageAsc),
      olderCursor: hasOlderLatest ? timelineCursorOf(latestPageAsc[0]) : null,
      newerCursor: null,
      firstUnread,
      unreadCount,
    };
  });

/**
 * Mark moments read for the viewer. Scoped insert-select: only live,
 * non-goal, partner-authored moments in the caller's ACTIVE space take
 * effect; own/deleted/goal/outside-space ids are silently skipped.
 * Idempotent (`ON CONFLICT DO NOTHING`); never enqueues a notification.
 * No active space → `{ ok: true }` no-op (never an error).
 */
export const markMomentsReadProgram = (
  userId: string,
  input: MarkMomentsReadRequest
): Effect.Effect<{ ok: true }, BadRequestError | InternalError, DbService | ClockService> =>
  Effect.gen(function* () {
    const deduped = [...new Set(input.momentIds)];
    if (deduped.length === 0 || deduped.length > 100) {
      return yield* Effect.fail(badRequest('Invalid moment ids'));
    }

    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return { ok: true as const };
    }

    const db = yield* Db;
    const at = yield* nowMs;
    const placeholders = deduped.map(() => '?').join(',');

    yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `insert into moment_reads (moment_id, user_id, space_id, read_at)
             select m.id, ?, m.space_id, ?
             from moments m
             where m.id in (${placeholders})
               and m.space_id = ?
               and m.deleted_at is null
               and m.type != 'goal'
               and m.created_by_user_id != ?
             on conflict (moment_id, user_id) do nothing`
          )
          .bind(userId, at, ...deduped, spaceId, userId)
          .run(),
      catch: () => new InternalError({}),
    });

    return { ok: true as const };
  });
