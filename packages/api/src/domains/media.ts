import { Effect } from 'effect';

import {
  MEDIA_MAX_BYTES,
  PLUS_MEDIA_BYTES,
  isAllowedMediaMimeType,
  type MediaUploadIntentRequest,
  type MediaUploadIntentResponse,
} from '@aoi/shared';

import { nowMs, type ClockService } from '../effects/clock';
import { newId, type IdService } from '../effects/id';
import { Db, type DbService } from '../effects/d1';
import type { D1Database } from '../env';
import { Logger, type LoggerService } from '../effects/logger';
import { enqueueJob, type JobQueueService } from '../services/job-queue';
import {
  MediaStore,
  MEDIA_PRESIGN_TTL_SEC,
  type MediaStoreService,
} from '../services/media-store';
import {
  BadRequestError,
  ForbiddenError,
  InternalError,
  LimitExceededError,
  NotFoundError,
  badRequest,
  forbidden,
  limitExceeded,
  notFound,
} from './errors';
import { readSpaceUsage, type SpaceUsage } from './plus';
import { getActiveSpaceId } from './spaces';

/**
 * Media domain — the private R2 pipeline, fully off the request path:
 *
 *   upload-url (intent) ──presigned PUT──▶ device uploads directly to R2
 *        │                                    │
 *        ▼                                    ▼
 *   media_objects: 'pending'            complete (head-verify + guarded
 *        │                                pending→complete) → enqueue
 *        ▼                                    media.sanitize
 *   serve via /v1/media/:id/object?variant=…  ◀── variants written by the job
 *
 * State machine (D1-guarded transitions, all idempotent):
 *   pending → complete (head-verified; sanitize queued)
 *   pending → failed  (head-verify mismatch — content-type/size lie)
 *   complete → failed (sanitize terminally failed after bounded attempts)
 *
 * Storage keys are deterministic and stable (derived from the media id, so
 * re-processing overwrites the same keys):
 *   media/{mediaId}/original.{ext}   media/{mediaId}/display.webp   media/{mediaId}/thumb.webp
 *
 * Serving is a stable app URL with a `variant` query param — never a durable
 * signed URL. Reads gate on ACTIVE MEMBERSHIP of the media's space.
 */

// ── Keys ─────────────────────────────────────────────────────────────────

export function extensionForMimeType(mimeType: string): string {
  switch (mimeType) {
    case 'image/jpeg': return 'jpg';
    case 'image/png': return 'png';
    case 'image/webp': return 'webp';
    case 'image/gif': return 'gif';
    case 'image/avif': return 'avif';
    case 'image/heic': return 'heic';
    case 'image/heif': return 'heif';
    case 'audio/m4a':
    case 'audio/x-m4a':
    case 'audio/mp4':
      return 'm4a';
    case 'audio/aac': return 'aac';
    case 'audio/wav': return 'wav';
    default: return 'bin';
  }
}

export const mediaOriginalKey = (mediaId: string, mimeType: string): string =>
  `media/${mediaId}/original.${extensionForMimeType(mimeType)}`;

export const mediaDisplayKey = (mediaId: string): string => `media/${mediaId}/display.webp`;

export const mediaThumbKey = (mediaId: string): string => `media/${mediaId}/thumb.webp`;

export function sanitizeFilename(name: string): string {
  return name.replace(/["\n\r\\;]/g, '_').replace(/[\u0000-\u001f]/g, '').substring(0, 255);
}

interface MediaRow {
  id: string;
  space_id: string;
  created_by_user_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_key: string;
  upload_state: 'pending' | 'complete' | 'failed';
  content_hash: string | null;
  variant_keys: string | null;
  processing_attempts: number;
}

const MEDIA_ROW_SELECT = `
  select id, space_id, created_by_user_id, filename, mime_type, size_bytes,
         storage_key, upload_state, content_hash, variant_keys, processing_attempts
  from media_objects
`;

function parseVariantKeys(raw: string | null): Record<string, string> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, string>;
    }
  } catch {
    // Stored by us; a corrupt row serves original only.
  }
  return null;
}

// ── Upload intent (presigned direct PUT) ─────────────────────────────────

export const createUploadIntentProgram = (
  userId: string,
  input: MediaUploadIntentRequest
): Effect.Effect<
  MediaUploadIntentResponse,
  BadRequestError | LimitExceededError | InternalError,
  DbService | MediaStoreService | ClockService | IdService
> =>
  Effect.gen(function* () {
    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return yield* Effect.fail(badRequest('You must have an active space to upload media'));
    }

    if (!isAllowedMediaMimeType(input.mimeType)) {
      return yield* Effect.fail(badRequest('Unsupported MIME type'));
    }

    // kind must match the declared MIME family (image/* ↔ image).
    const expectedKind = input.mimeType.startsWith('audio/') ? 'audio' : 'image';
    if (input.kind !== expectedKind) {
      return yield* Effect.fail(badRequest('MIME type does not match the declared kind'));
    }

    if (input.sizeBytes > MEDIA_MAX_BYTES) {
      return yield* Effect.fail(badRequest('File is too large'));
    }

    const mediaId = yield* newId;
    const at = yield* nowMs;
    const storageKey = mediaOriginalKey(mediaId, input.mimeType);
    const filename = sanitizeFilename(input.filename || `upload_${mediaId}`);

    const db = yield* Db;
    // Quota-guarded intent in ONE statement: the row is inserted only when
    // current counted usage + declared size fits the Space limit. Atomic
    // under SQLite's serialized writes, so concurrent intents cannot both
    // pass when together they exceed quota. Pending intents reserve their
    // declared size (released if abandoned via the staged purge); the client
    // never supplies usage — it is always recomputed here.
    const usage = yield* readSpaceUsage(db.d1, spaceId, at);
    const inserted = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `insert into media_objects
               (id, space_id, created_by_user_id, filename, mime_type, size_bytes,
                storage_key, upload_state, created_at)
             select ?, ?, ?, ?, ?, ?, ?, 'pending', ?
             where (select coalesce(sum(size_bytes), 0) from media_objects
                    where space_id = ? and deleted_at is null
                      and upload_state in ('pending', 'complete')) + ? <= ?`
          )
          .bind(
            mediaId,
            spaceId,
            userId,
            filename,
            input.mimeType,
            input.sizeBytes,
            storageKey,
            at,
            spaceId,
            input.sizeBytes,
            usage.mediaLimitBytes
          )
          .run(),
      catch: () => new InternalError({}),
    });
    if ((inserted.meta?.changes ?? 0) === 0) {
      // Re-read for a truthful typed error (failure path only).
      const current = yield* readSpaceUsage(db.d1, spaceId, at);
      return yield* Effect.fail(
        limitExceeded('This space is out of media room', {
          kind: 'media_quota',
          usedBytes: current.mediaUsedBytes,
          limitBytes: current.mediaLimitBytes,
          plusLimitBytes: PLUS_MEDIA_BYTES,
        })
      );
    }

    const store = yield* MediaStore;
    const uploadUrl = yield* Effect.tryPromise({
      try: () => store.presignPutUrl(storageKey, input.mimeType, input.sizeBytes),
      catch: () => new InternalError({}),
    });

    return {
      mediaId,
      uploadUrl,
      expiresInSec: MEDIA_PRESIGN_TTL_SEC,
      headers: { 'Content-Type': input.mimeType },
    };
  });

// ── Complete (head-verify + guarded transition + enqueue sanitize) ───────

export const completeUploadProgram = (
  userId: string,
  mediaId: string
): Effect.Effect<{ ok: true }, BadRequestError | ForbiddenError | NotFoundError | LimitExceededError | InternalError, DbService | MediaStoreService | JobQueueService | LoggerService | IdService | ClockService> =>
  Effect.gen(function* () {
    const db = yield* Db;

    const media = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(`${MEDIA_ROW_SELECT} where id = ? and deleted_at is null`)
          .bind(mediaId)
          .first<MediaRow>(),
      catch: () => new InternalError({}),
    });
    if (!media) {
      return yield* Effect.fail(notFound('Media not found'));
    }
    if (media.created_by_user_id !== userId) {
      return yield* Effect.fail(forbidden('You can only confirm your own uploads'));
    }
    if (media.upload_state !== 'pending') {
      return yield* Effect.fail(badRequest('Upload is already completed'));
    }

    const store = yield* MediaStore;
    const head = yield* Effect.tryPromise({
      try: () => store.head(media.storage_key),
      catch: () => new InternalError({}),
    });

    const verified =
      head !== null &&
      head.size <= MEDIA_MAX_BYTES &&
      (head.httpMetadata?.contentType === undefined ||
        head.httpMetadata.contentType === media.mime_type);

    if (!verified) {
      // The device lied (wrong content type, wrong size) or the object never
      // landed. Terminal: pending → failed, and the caller gets a 400.
      yield* Effect.tryPromise({
        try: () =>
          db.d1
            .prepare(`update media_objects set upload_state = 'failed' where id = ? and upload_state = 'pending'`)
            .bind(mediaId)
            .run(),
        catch: () => new InternalError({}),
      });
      return yield* Effect.fail(badRequest('Uploaded content type does not match declared MIME type'));
    }

    // Completion-time quota: the authoritative R2 size may exceed the
    // declared reservation. Effective completed usage = counted usage
    // WITHOUT this row's reservation + actual size (no double-count).
    // The permit is one guarded UPDATE — atomic under serialized writes, so
    // concurrent completions cannot both squeeze oversized actuals past
    // quota. The limit is read fresh here (current entitlement), so a
    // Free→Plus upgrade mid-upload permits while Plus→Free constrains,
    // without ever touching existing completed media.
    const dbNow = yield* nowMs;
    const usage = yield* readSpaceUsage(db.d1, media.space_id, dbNow);
    const adjustment = head.size - media.size_bytes;
    const transition = yield* Effect.tryPromise({
      try: () => {
        if (adjustment <= 0) {
          return db.d1
            .prepare(
              `update media_objects set upload_state = 'complete', size_bytes = ?
               where id = ? and upload_state = 'pending'`
            )
            .bind(head.size, mediaId)
            .run();
        }
        return db.d1
          .prepare(
            `update media_objects set upload_state = 'complete', size_bytes = ?
             where id = ? and upload_state = 'pending'
               and (select coalesce(sum(size_bytes), 0) from media_objects
                    where space_id = ? and deleted_at is null
                      and upload_state in ('pending', 'complete') and id != ?)
                   + ? <= ?`
          )
          .bind(head.size, mediaId, media.space_id, mediaId, head.size, usage.mediaLimitBytes)
          .run();
      },
      catch: () => new InternalError({}),
    });
    if ((transition.meta?.changes ?? 0) === 0) {
      // Ambiguous: a concurrent complete won, or quota refused the delta.
      // Re-read to tell them apart (existing double-complete semantics stay).
      const fresh = yield* Effect.tryPromise({
        try: () =>
          db.d1
            .prepare(`select upload_state from media_objects where id = ?`)
            .bind(mediaId)
            .first<{ upload_state: string }>(),
        catch: () => new InternalError({}),
      });
      if (!fresh || fresh.upload_state !== 'pending') {
        return yield* Effect.fail(badRequest('Upload is already completed'));
      }
      return yield* rejectOverQuotaUpload(db.d1, store, media, head.size, usage);
    }

    // Sanitization happens in the queue, never on the request path.
    yield* enqueueJob({ type: 'media.sanitize', mediaId });

    return { ok: true as const };
  });

/**
 * Over-quota completion aftermath. The object must never become `complete`:
 * delete it from R2 immediately; on success the row flips to terminal
 * `failed` (reference preserved, quota released, normal-flow retry with a
 * smaller file stays possible). If R2 deletion fails, the row stays
 * `pending` with its reservation held — the existing staged purge retries
 * storage deletion deterministically instead of losing the reference.
 * Either way: no untracked orphan, no silent partial success.
 */
const rejectOverQuotaUpload = (
  d1: D1Database,
  store: MediaStoreService,
  media: { id: string; space_id: string; storage_key: string },
  actualSize: number,
  usage: SpaceUsage
): Effect.Effect<never, LimitExceededError | InternalError> =>
  Effect.gen(function* () {
    const deleted: boolean = yield* Effect.promise(() =>
      store.delete(media.storage_key).then(
        () => true,
        () => false
      )
    );
    if (deleted) {
      yield* Effect.tryPromise({
        try: () =>
          d1
            .prepare(`update media_objects set upload_state = 'failed' where id = ? and upload_state = 'pending'`)
            .bind(media.id)
            .run(),
        catch: () => new InternalError({}),
      });
    }
    // Authoritative post-adjustment semantics: usage excluding this row's
    // stale reservation plus the actual size that would have landed.
    const usedExcludingReservation = yield* Effect.tryPromise({
      try: async () => {
        const row = await d1
          .prepare(
            `select coalesce(sum(size_bytes), 0) as used from media_objects
             where space_id = ? and deleted_at is null
               and upload_state in ('pending', 'complete') and id != ?`
          )
          .bind(media.space_id, media.id)
          .first<{ used: number }>();
        return row?.used ?? 0;
      },
      catch: () => new InternalError({}),
    });
    return yield* Effect.fail(
      limitExceeded('This upload would exceed the space media quota', {
        kind: 'media_quota',
        usedBytes: usedExcludingReservation + actualSize,
        limitBytes: usage.mediaLimitBytes,
        plusLimitBytes: PLUS_MEDIA_BYTES,
      })
    );
  });

// ── Serve (membership-gated, range-capable, never a signed URL) ──────────

export type MediaVariantName = 'original' | 'display' | 'thumb';

export interface MediaServeOutput {
  status: 200 | 206;
  headers: Record<string, string>;
  body: ReadableStream;
}

/**
 * Parse a single-range `Range` header against a known total. Returns null
 * for absent/invalid ranges (caller serves the full object).
 */
export function parseRangeHeader(
  header: string | null,
  total: number
): { offset: number; length?: number } | null {
  if (!header || total <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const rawStart = match[1];
  const rawEnd = match[2];

  if (rawStart === '' && rawEnd === '') return null;

  if (rawStart !== '') {
    const start = Number(rawStart);
    if (!Number.isFinite(start) || start < 0 || start >= total) return null;
    if (rawEnd !== '') {
      const end = Number(rawEnd);
      if (!Number.isFinite(end) || end < start) return null;
      return { offset: start, length: Math.min(end - start + 1, total - start) };
    }
    return { offset: start, length: total - start };
  }

  // Suffix range: last N bytes.
  const suffix = Number(rawEnd);
  if (!Number.isFinite(suffix) || suffix <= 0) return null;
  const offset = Math.max(total - suffix, 0);
  return { offset, length: Math.min(suffix, total) };
}

export const serveMediaProgram = (
  userId: string,
  mediaId: string,
  variant: MediaVariantName,
  rangeHeader: string | null
): Effect.Effect<
  MediaServeOutput,
  BadRequestError | ForbiddenError | NotFoundError | InternalError,
  DbService | MediaStoreService
> =>
  Effect.gen(function* () {
    const db = yield* Db;

    const media = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(`${MEDIA_ROW_SELECT} where id = ? and deleted_at is null`)
          .bind(mediaId)
          .first<MediaRow>(),
      catch: () => new InternalError({}),
    });
    if (!media) {
      return yield* Effect.fail(notFound('Media not found'));
    }

    // Membership gate — the media is only visible to the space's members.
    const membership = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `select 1 from space_members where space_id = ? and user_id = ? and state = 'active' limit 1`
          )
          .bind(media.space_id, userId)
          .first(),
      catch: () => new InternalError({}),
    });
    if (!membership) {
      return yield* Effect.fail(forbidden('You do not have access to this media'));
    }

    if (media.upload_state !== 'complete') {
      return yield* Effect.fail(badRequest('Upload is not yet complete'));
    }

    const variantKeys = parseVariantKeys(media.variant_keys);
    const isAudio = media.mime_type.startsWith('audio/');

    let key: string;
    if (variant === 'original' || isAudio) {
      // Audio is pass-through verified (no re-encode); original serves all
      // variants until (if ever) a display variant exists.
      key = variantKeys?.[variant] ?? media.storage_key;
    } else {
      const variantKey = variantKeys?.[variant];
      if (!variantKey) {
        return yield* Effect.fail(badRequest('Media is still processing'));
      }
      key = variantKey;
    }

    const store = yield* MediaStore;
    const head = yield* Effect.tryPromise({
      try: () => store.head(key),
      catch: () => new InternalError({}),
    });
    if (!head) {
      return yield* Effect.fail(notFound('Media not found'));
    }

    const total = head.size;
    const range = parseRangeHeader(rangeHeader, total);
    const object = yield* Effect.tryPromise({
      try: () => store.get(key, range ? { range } : undefined),
      catch: () => new InternalError({}),
    });
    if (!object) {
      return yield* Effect.fail(notFound('Media not found'));
    }

    const contentType =
      variant === 'display' || variant === 'thumb'
        ? 'image/webp'
        : media.mime_type;

    const disposition = `inline; filename="${sanitizeFilename(media.filename)}"`;

    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Content-Length': String(object.size),
      'Accept-Ranges': 'bytes',
      'Content-Disposition': disposition,
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      ETag: object.httpEtag,
    };

    if (range) {
      const start = range.offset;
      const end = start + object.size - 1;
      headers['Content-Range'] = `bytes ${start}-${end}/${total}`;
      return { status: 206 as const, headers, body: object.body };
    }

    return { status: 200 as const, headers, body: object.body };
  });
