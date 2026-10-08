import { Effect } from 'effect';

import {
  PLUS_MEDIA_BYTES,
  albumUploadIntentRequestSchema,
  spaceBackupSchema,
  wireAlbumMediaReservationRequestSchema,
  type AlbumMediaRecord,
  type AlbumUploadIntentRequest,
  type AlbumUploadIntentResponse,
  type SpaceBackup,
  type WireAlbumMediaReservationResponse,
} from '@aoi/shared';

import { nowMs, type ClockService } from '../effects/clock';
import { newId, type IdService } from '../effects/id';
import { Db, type DbService } from '../effects/d1';
import {
  MEDIA_PRESIGN_TTL_SEC,
  MediaStore,
  deleteKeyConfirmed,
  type MediaStoreService,
} from '../services/media-store';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  InternalError,
  LimitExceededError,
  NotFoundError,
  badRequest,
  conflict,
  forbidden,
  limitExceeded,
  notFound,
} from './errors';
import { COUNTED_MEDIA_BYTES_SQL, readSpaceUsage } from './plus';
import { getActiveSpaceId } from './spaces';

/**
 * Album domain — the E2EE shared photo library, server side.
 *
 * The server is a dumb, membership-gated pipe. It stores sealed ciphertext it
 * cannot read (opaque bytes in R2) and a per-photo key wrapped under the space
 * key it cannot unwrap. It never sees plaintext, keys, or the wrapped key's
 * contents.
 *
 *   intent ──presigned PUT──▶ device uploads sealed bytes directly to R2
 *      │                          │
 *      ▼                          ▼
 *   album_media: 'pending'   complete (head-verify size → guarded
 *      │                     pending→complete)
 *      ▼
 *   list → metadata only; object → sealed ciphertext, membership-gated
 *
 * Storage keys are deterministic and stable — derived from the ids so a retry
 * always targets the same object:
 *   album/{spaceId}/{mediaId}.bin
 */

// ── Keys ─────────────────────────────────────────────────────────────────

export const albumMediaKey = (spaceId: string, mediaId: string): string =>
  `album/${spaceId}/${mediaId}.bin`;

/** Sealed ciphertext is opaque; R2 always stores it as octet-stream. */
export const ALBUM_CONTENT_TYPE = 'application/octet-stream';

interface AlbumMediaRow {
  id: string;
  space_id: string;
  created_by_user_id: string;
  mime_type: string;
  byte_length: number;
  width: number | null;
  height: number | null;
  person_tag: 'you' | 'partner' | null;
  sealed_nonce: string;
  wrapped_key_nonce: string;
  wrapped_key_ciphertext: string;
  storage_key: string;
  upload_state: 'pending' | 'complete' | 'failed';
  created_at: number;
  completed_at: number | null;
  completed_etag: string | null;
  completed_size: number | null;
}

const ALBUM_MEDIA_ROW_SELECT = `
  select id, space_id, created_by_user_id, mime_type, byte_length, width, height,
         person_tag, sealed_nonce, wrapped_key_nonce, wrapped_key_ciphertext,
         storage_key, upload_state, created_at, completed_at,
         completed_etag, completed_size
  from album_media
`;

function rowToRecord(row: AlbumMediaRow): AlbumMediaRecord {
  return {
    id: row.id,
    wrappedKey: {
      nonce: row.wrapped_key_nonce,
      ciphertext: row.wrapped_key_ciphertext,
    },
    sealedNonce: row.sealed_nonce,
    createdAt: new Date(row.created_at).toISOString(),
    byteLength: row.byte_length,
    mimeType: row.mime_type,
    ...(row.width !== null ? { width: row.width } : {}),
    ...(row.height !== null ? { height: row.height } : {}),
    ...(row.person_tag !== null ? { personTag: row.person_tag } : {}),
    createdByUserId: row.created_by_user_id,
  };
}

/** Default backup for a space with none stored (or a corrupt payload). */
export const EMPTY_SPACE_BACKUP: SpaceBackup = {
  identities: [],
  deviceKeys: [],
  envelopes: [],
};

/**
 * Union two backups by device, incoming winning on a collision.
 *
 * Every entry is keyed by the device that owns it, so merging is total: a
 * device writes its own identity and device key and leaves every other entry
 * alone. Doing that union on the server — not only in the client before the
 * PUT — is what makes the promise in `album-session.ts` true. A device that
 * read a stale backup, or an empty one after a transient miss, would
 * otherwise overwrite the entries it never meant to touch, and the partner's
 * signed device keys and space-key envelopes would disappear for good.
 */
function mergeBackupByDevice(existing: SpaceBackup, incoming: SpaceBackup): SpaceBackup {
  return {
    identities: mergeByDeviceId(existing.identities, incoming.identities),
    deviceKeys: mergeByDeviceId(existing.deviceKeys, incoming.deviceKeys),
    envelopes: mergeByDeviceId(existing.envelopes, incoming.envelopes),
  };
}

function mergeByDeviceId<T extends { deviceId: string }>(existing: T[], incoming: T[]): T[] {
  const byDeviceId = new Map(existing.map((entry) => [entry.deviceId, entry]));
  for (const entry of incoming) {
    byDeviceId.set(entry.deviceId, entry);
  }
  return [...byDeviceId.values()];
}

/** The stored backup, or the empty default when absent or unreadable. */
const readStoredBackup = (
  spaceId: string
): Effect.Effect<SpaceBackup, InternalError, DbService> =>
  Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare('select payload from album_backups where space_id = ?')
          .bind(spaceId)
          .first<{ payload: string }>(),
      catch: () => new InternalError({}),
    });
    if (!row) return EMPTY_SPACE_BACKUP;

    try {
      const parsed = spaceBackupSchema.safeParse(JSON.parse(row.payload));
      return parsed.success ? parsed.data : EMPTY_SPACE_BACKUP;
    } catch {
      // Stored by us; a corrupt payload degrades to empty, never a 500.
      return EMPTY_SPACE_BACKUP;
    }
  });

const isActiveMember = (
  db: DbService,
  spaceId: string,
  userId: string
): Effect.Effect<boolean, InternalError> =>
  Effect.tryPromise({
    try: async () => {
      const row = await db.d1
        .prepare(
          "select 1 from space_members where space_id = ? and user_id = ? and state = 'active' limit 1"
        )
        .bind(spaceId, userId)
        .first();
      return row !== null;
    },
    catch: () => new InternalError({}),
  });

// ── Upload intent (presigned direct PUT) ─────────────────────────────────

export const createAlbumUploadIntentProgram = (
  userId: string,
  input: AlbumUploadIntentRequest
): Effect.Effect<
  AlbumUploadIntentResponse,
  BadRequestError | LimitExceededError | InternalError,
  DbService | MediaStoreService | ClockService | IdService
> =>
  Effect.gen(function* () {
    // The route validates with this schema; re-validating here keeps the
    // domain the authority when called directly (bounded size, non-empty
    // wrapped key/nonce).
    const parsed = albumUploadIntentRequestSchema.safeParse(input);
    if (!parsed.success) {
      return yield* Effect.fail(badRequest('Invalid photo upload'));
    }
    const request = parsed.data;

    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return yield* Effect.fail(
        badRequest('You must have an active space to upload photos')
      );
    }

    const mediaId = yield* newId;
    const at = yield* nowMs;
    const storageKey = albumMediaKey(spaceId, mediaId);

    const db = yield* Db;
    // Quota-guarded in ONE statement, against the same counted-usage expression
    // every other path uses, so the legacy album cannot exceed the shared
    // budget. The request and success-response shapes are unchanged; the new
    // failure mode is the same limit error ordinary media already returns.
    const usage = yield* readSpaceUsage(db.d1, spaceId, at);
    const inserted = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `insert into album_media
               (id, space_id, created_by_user_id, mime_type, byte_length, width,
                height, person_tag, sealed_nonce, wrapped_key_nonce,
                wrapped_key_ciphertext, storage_key, upload_state, created_at)
             select ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?
             where ${COUNTED_MEDIA_BYTES_SQL} + ? <= ?`
          )
          .bind(
            mediaId,
            spaceId,
            userId,
            request.mimeType,
            request.byteLength,
            request.width ?? null,
            request.height ?? null,
            request.personTag ?? null,
            request.sealedNonce,
            request.wrappedKey.nonce,
            request.wrappedKey.ciphertext,
            storageKey,
            at,
            spaceId,
            spaceId,
            spaceId,
            request.byteLength,
            usage.mediaLimitBytes
          )
          .run(),
      catch: () => new InternalError({}),
    });
    if ((inserted.meta?.changes ?? 0) === 0) {
      return yield* Effect.fail(
        limitExceeded('This space is out of media room', {
          kind: 'media_quota',
          usedBytes: usage.mediaUsedBytes,
          limitBytes: usage.mediaLimitBytes,
          plusLimitBytes: PLUS_MEDIA_BYTES,
        })
      );
    }

    const store = yield* MediaStore;
    const presigned = yield* Effect.tryPromise({
      try: () =>
        store.presignPutUrl(storageKey, ALBUM_CONTENT_TYPE, request.byteLength, {
          ifNoneMatch: true,
        }),
      catch: () => new InternalError({}),
    });

    return {
      mediaId,
      uploadUrl: presigned.url,
      expiresInSec: MEDIA_PRESIGN_TTL_SEC,
      headers: presigned.headers,
    };
  });

// ── Complete (head-verify size + guarded pending→complete) ───────────────

export const completeAlbumUploadProgram = (
  userId: string,
  mediaId: string
): Effect.Effect<
  { ok: true },
  BadRequestError | ForbiddenError | NotFoundError | InternalError,
  DbService | MediaStoreService | ClockService
> =>
  Effect.gen(function* () {
    const db = yield* Db;

    const media = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(`${ALBUM_MEDIA_ROW_SELECT} where id = ? and deleted_at is null`)
          .bind(mediaId)
          .first<AlbumMediaRow>(),
      catch: () => new InternalError({}),
    });
    if (!media) {
      return yield* Effect.fail(notFound('Photo not found'));
    }
    if (media.created_by_user_id !== userId) {
      return yield* Effect.fail(forbidden('You can only confirm your own uploads'));
    }
    if (media.upload_state !== 'pending') {
      return yield* Effect.fail(badRequest('Upload is already completed'));
    }

    // A member who has left cannot finalise what they reserved. This is the
    // early refusal; the condition on the write below is the authority, so a
    // removal that lands between the two cannot slip through.
    if (!(yield* isActiveMember(db, media.space_id, userId))) {
      return yield* Effect.fail(forbidden('You are no longer a member of this Space'));
    }

    const store = yield* MediaStore;
    const head = yield* Effect.tryPromise({
      try: () => store.head(media.storage_key),
      catch: () => new InternalError({}),
    });

    const markFailed = () =>
      Effect.tryPromise({
        try: () =>
          db.d1
            .prepare(
              "update album_media set upload_state = 'failed' where id = ? and upload_state = 'pending'"
            )
            .bind(mediaId)
            .run(),
        catch: () => new InternalError({}),
      });

    if (head === null) {
      // Nothing landed, so nothing is left unaccounted for: releasing the
      // reservation is safe.
      yield* markFailed();
      return yield* Effect.fail(badRequest('The uploaded object was not found'));
    }

    // Exact equality, with no allowance. The declared length is the ciphertext
    // object's own length now, so a different size means this is not the object
    // that was reserved. Nothing here has to know how the ciphertext was framed.
    const contentTypeOk =
      head.httpMetadata?.contentType === undefined ||
      head.httpMetadata.contentType === ALBUM_CONTENT_TYPE;
    if (head.size !== media.byte_length || !contentTypeOk) {
      // The object exists but is not what was reserved. `failed` releases the
      // reservation, so the bytes have to be gone first; if the delete cannot
      // be confirmed the row stays `pending` and the staged purge retries,
      // rather than freeing quota for storage that is still there.
      const confirmed = yield* deleteKeyConfirmed(store, media.storage_key);
      if (confirmed) {
        yield* markFailed();
      }
      return yield* Effect.fail(
        badRequest('Uploaded content does not match the reserved size')
      );
    }

    const at = yield* nowMs;
    const transition = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `update album_media
                set upload_state = 'complete', completed_at = ?,
                    completed_etag = ?, completed_size = ?
              where id = ? and upload_state = 'pending'
                and exists (
                  select 1 from space_members
                   where space_id = album_media.space_id
                     and user_id = ? and state = 'active'
                )`
          )
          .bind(at, head.httpEtag, head.size, mediaId, userId)
          .run(),
      catch: () => new InternalError({}),
    });
    if ((transition.meta?.changes ?? 0) === 0) {
      const fresh = yield* Effect.tryPromise({
        try: () =>
          db.d1
            .prepare('select upload_state from album_media where id = ?')
            .bind(mediaId)
            .first<{ upload_state: string }>(),
        catch: () => new InternalError({}),
      });
      if (!fresh || fresh.upload_state !== 'pending') {
        // A concurrent complete won, or the row moved to failed meanwhile.
        return yield* Effect.fail(badRequest('Upload is already completed'));
      }
      // Still pending, so membership is what refused the write: the member was
      // removed after the check above and before this statement.
      return yield* Effect.fail(forbidden('You are no longer a member of this Space'));
    }

    return { ok: true as const };
  });

// ── List (metadata only, newest first) ───────────────────────────────────

export const listAlbumMediaProgram = (
  userId: string
): Effect.Effect<{ media: AlbumMediaRecord[] }, InternalError, DbService> =>
  Effect.gen(function* () {
    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) return { media: [] };

    const db = yield* Db;
    const rows = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `${ALBUM_MEDIA_ROW_SELECT}
              where space_id = ? and deleted_at is null and upload_state = 'complete'
              order by created_at desc, id desc`
          )
          .bind(spaceId)
          .all<AlbumMediaRow>(),
      catch: () => new InternalError({}),
    });

    return { media: (rows.results ?? []).map(rowToRecord) };
  });

// ── Object (sealed ciphertext, membership-gated) ─────────────────────────

export interface AlbumServeOutput {
  status: 200;
  headers: Record<string, string>;
  body: ReadableStream;
}

export const serveAlbumObjectProgram = (
  userId: string,
  mediaId: string
): Effect.Effect<
  AlbumServeOutput,
  ForbiddenError | NotFoundError | ConflictError | InternalError,
  DbService | MediaStoreService
> =>
  Effect.gen(function* () {
    const db = yield* Db;

    const media = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(`${ALBUM_MEDIA_ROW_SELECT} where id = ? and deleted_at is null`)
          .bind(mediaId)
          .first<AlbumMediaRow>(),
      catch: () => new InternalError({}),
    });
    if (!media) {
      return yield* Effect.fail(notFound('Photo not found'));
    }

    if (!(yield* isActiveMember(db, media.space_id, userId))) {
      return yield* Effect.fail(forbidden('You do not have access to this photo'));
    }

    if (media.upload_state !== 'complete') {
      return yield* Effect.fail(notFound('Photo not found'));
    }

    const store = yield* MediaStore;
    const object = yield* Effect.tryPromise({
      try: () => store.get(media.storage_key),
      catch: () => new InternalError({}),
    });
    if (!object) {
      return yield* Effect.fail(notFound('Photo not found'));
    }

    // The object has to still be the one that was finalised. The presigned PUT
    // is a conditional create (`If-None-Match: *`), which is the write-side
    // defence; this etag and size pin is the read-side one, and it still earns
    // its place because the condition's enforcement is object storage's
    // behaviour rather than something the server can prove. Between them a
    // silent swap becomes a refusal at both ends.
    const replaced =
      (media.completed_etag !== null && object.httpEtag !== media.completed_etag) ||
      (media.completed_size !== null && object.size !== media.completed_size);
    if (replaced) {
      return yield* Effect.fail(
        conflict('The stored object no longer matches the one that was finalised')
      );
    }

    return {
      status: 200 as const,
      headers: {
        'Content-Type': ALBUM_CONTENT_TYPE,
        'Content-Length': String(object.size),
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
        ETag: object.httpEtag,
      },
      body: object.body,
    };
  });

// ── Delete (soft, shared library — any active member) ────────────────────

export const deleteAlbumMediaProgram = (
  userId: string,
  mediaId: string
): Effect.Effect<
  { ok: true },
  ForbiddenError | NotFoundError | InternalError,
  DbService | MediaStoreService | ClockService
> =>
  Effect.gen(function* () {
    const db = yield* Db;

    const media = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare('select id, space_id, storage_key from album_media where id = ? and deleted_at is null')
          .bind(mediaId)
          .first<{ id: string; space_id: string; storage_key: string }>(),
      catch: () => new InternalError({}),
    });
    if (!media) {
      return yield* Effect.fail(notFound('Photo not found'));
    }

    if (!(yield* isActiveMember(db, media.space_id, userId))) {
      return yield* Effect.fail(forbidden('You do not have access to this photo'));
    }

    const at = yield* nowMs;
    const updated = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare('update album_media set deleted_at = ? where id = ? and deleted_at is null')
          .bind(at, mediaId)
          .run(),
      catch: () => new InternalError({}),
    });
    if ((updated.meta?.changes ?? 0) === 0) {
      return yield* Effect.fail(notFound('Photo not found'));
    }

    // Best-effort storage cleanup: the tombstone is authoritative, a failed
    // R2 delete must not fail the request (a later purge can retry).
    const store = yield* MediaStore;
    yield* Effect.promise(() =>
      store.delete(media.storage_key).then(
        () => true,
        () => false
      )
    );

    return { ok: true as const };
  });

// ── Backup (space key envelopes) ─────────────────────────────────────────

export const getAlbumBackupProgram = (
  userId: string
): Effect.Effect<SpaceBackup, InternalError, DbService> =>
  Effect.gen(function* () {
    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) return EMPTY_SPACE_BACKUP;
    return yield* readStoredBackup(spaceId);
  });

export const putAlbumBackupProgram = (
  userId: string,
  backup: SpaceBackup
): Effect.Effect<SpaceBackup, BadRequestError | InternalError, DbService | ClockService> =>
  Effect.gen(function* () {
    const parsed = spaceBackupSchema.safeParse(backup);
    if (!parsed.success) {
      return yield* Effect.fail(badRequest('Invalid backup'));
    }

    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return yield* Effect.fail(badRequest('You must have an active space to back up keys'));
    }

    // Merge against what is stored rather than replacing it: the caller only
    // ever owns its own entries, and a read it did before this request must
    // not be able to delete anybody else's.
    const existing = yield* readStoredBackup(spaceId);
    const merged = mergeBackupByDevice(existing, parsed.data);
    const bounded = spaceBackupSchema.safeParse(merged);
    if (!bounded.success) {
      return yield* Effect.fail(badRequest('Backup is too large to store'));
    }

    const at = yield* nowMs;
    const db = yield* Db;
    yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `insert into album_backups (space_id, payload, updated_at)
             values (?, ?, ?)
             on conflict(space_id) do update set payload = excluded.payload, updated_at = excluded.updated_at`
          )
          .bind(spaceId, JSON.stringify(bounded.data), at)
          .run(),
      catch: () => new InternalError({}),
    });

    return bounded.data;
  });

// ── Signed media: reserve → finalise ──────────────────────────────────────

/** Generation 1 is the only writable generation until rotation exists. */
export const ALBUM_WRITABLE_GENERATION = 1;

/**
 * How long a reservation outlives its own presigned URL.
 *
 * A reservation must never expire while its URL can still be used, or a device
 * could land an object no row accounts for. The margin covers clock skew and a
 * request that started just before expiry.
 */
export const ALBUM_RESERVATION_SAFETY_MS = 15 * 60 * 1000;
export const ALBUM_RESERVATION_TTL_MS =
  MEDIA_PRESIGN_TTL_SEC * 1000 + ALBUM_RESERVATION_SAFETY_MS;

/**
 * Hard bound on how long one reservation may live, however many retries it
 * takes. A retry legitimately extends `expires_at` so a fresh URL is never
 * valid past cleanup eligibility, but an unbounded extension would let a client
 * keep one authorization alive forever. Past this bound the client starts a new
 * upload with a new id.
 */
export const ALBUM_RESERVATION_MAX_LIFETIME_MS = 24 * 60 * 60 * 1000;

interface AlbumReservationRow {
  space_id: string;
  media_id: string;
  created_by_user_id: string;
  uploader_device_id: string;
  generation: number;
  byte_length: number;
  state: 'pending' | 'expiring' | 'complete' | 'failed';
  expires_at: number;
}

const RESERVATION_SELECT = `
  select space_id, media_id, created_by_user_id, uploader_device_id,
         generation, byte_length, state, expires_at
  from album_media_reservations
`;

/**
 * Reserve one signed-media upload — the single pre-upload call.
 *
 * The id is the client's, because the ciphertext's AAD binds it and the
 * identity therefore has to exist before the bytes are sealed. The declared
 * length is the exact ciphertext size, so the presigned request and the quota
 * reservation are bound to it in the same breath.
 *
 * The quota guard and the insert are one statement, so two concurrent
 * reservations cannot both pass a read-time check and together exceed the
 * shared budget.
 */
export const reserveAlbumMediaProgram = (
  userId: string,
  input: unknown
): Effect.Effect<
  WireAlbumMediaReservationResponse,
  BadRequestError | ForbiddenError | ConflictError | LimitExceededError | InternalError,
  DbService | MediaStoreService | ClockService
> =>
  Effect.gen(function* () {
    const parsed = wireAlbumMediaReservationRequestSchema.safeParse(input);
    if (!parsed.success) {
      return yield* Effect.fail(badRequest('Invalid media reservation'));
    }
    const request = parsed.data;

    if (request.generation !== ALBUM_WRITABLE_GENERATION) {
      return yield* Effect.fail(
        badRequest('Only generation 1 may be written until key rotation exists')
      );
    }

    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return yield* Effect.fail(badRequest('You must have an active space to upload media'));
    }

    const db = yield* Db;

    // The uploader is who signs the manifest, so the row belongs to the account
    // that owns that device. The server never judges whether it was authorised.
    const uploader = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            'select owner_user_id from album_device_records where space_id = ? and device_id = ?'
          )
          .bind(spaceId, request.uploaderDeviceId)
          .first<{ owner_user_id: string }>(),
      catch: () => new InternalError({}),
    });
    if (!uploader) {
      return yield* Effect.fail(
        badRequest('The uploading device is not registered in this Space')
      );
    }
    if (uploader.owner_user_id !== userId) {
      return yield* Effect.fail(forbidden('You do not own the uploading device'));
    }

    // The id is the client's, so it can collide with a legacy album row. A
    // legacy id would let the legacy delete reach a signed object, so the
    // collision is refused rather than shared.
    const legacy = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare('select 1 as one from album_media where id = ?')
          .bind(request.mediaId)
          .first<{ one: number }>(),
      catch: () => new InternalError({}),
    });
    if (legacy) {
      return yield* Effect.fail(conflict('That media id is already in use'));
    }

    const at = yield* nowMs;
    const usage = yield* readSpaceUsage(db.d1, spaceId, at);

    yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `insert into album_media_reservations
               (space_id, media_id, created_by_user_id, uploader_device_id, generation,
                byte_length, state, created_at, expires_at)
             select ?, ?, ?, ?, ?, ?, 'pending', ?, ?
             where ${COUNTED_MEDIA_BYTES_SQL} + ? <= ?
             on conflict(space_id, media_id) do nothing`
          )
          .bind(
            spaceId,
            request.mediaId,
            userId,
            request.uploaderDeviceId,
            request.generation,
            request.byteLength,
            at,
            at + ALBUM_RESERVATION_TTL_MS,
            spaceId,
            spaceId,
            spaceId,
            request.byteLength,
            usage.mediaLimitBytes
          )
          .run(),
      catch: () => new InternalError({}),
    });

    const existing = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(`${RESERVATION_SELECT} where space_id = ? and media_id = ?`)
          .bind(spaceId, request.mediaId)
          .first<AlbumReservationRow>(),
      catch: () => new InternalError({}),
    });

    if (!existing) {
      // Nothing inserted and nothing stored: the shared budget refused it.
      return yield* Effect.fail(
        limitExceeded('This space is out of media room', {
          kind: 'media_quota',
          usedBytes: usage.mediaUsedBytes,
          limitBytes: usage.mediaLimitBytes,
          plusLimitBytes: PLUS_MEDIA_BYTES,
        })
      );
    }

    const sameRequest =
      existing.created_by_user_id === userId &&
      existing.uploader_device_id === request.uploaderDeviceId &&
      existing.generation === request.generation &&
      existing.byte_length === request.byteLength;
    if (!sameRequest) {
      return yield* Effect.fail(conflict('That media id is reserved for a different upload'));
    }
    if (existing.state !== 'pending') {
      // Completed, abandoned, or already owned by cleanup. Never mint a fresh
      // authorisation for an id that has been used.
      return yield* Effect.fail(conflict('That media id can no longer be uploaded'));
    }

    // Pending and identical: a retry of the same reservation. A fresh URL is
    // issued below, so the reservation has to be extended to outlive it — but
    // never past the hard bound, and never if cleanup has claimed it in the
    // meantime. The guarded extend is what decides that: if it touches no row,
    // this caller no longer owns the reservation and gets no authorization.
    const extended = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `update album_media_reservations
                set expires_at = min(?, created_at + ?)
              where space_id = ? and media_id = ? and state = 'pending'`
          )
          .bind(
            at + ALBUM_RESERVATION_TTL_MS,
            ALBUM_RESERVATION_MAX_LIFETIME_MS,
            spaceId,
            request.mediaId
          )
          .run(),
      catch: () => new InternalError({}),
    });
    if ((extended.meta?.changes ?? 0) === 0) {
      return yield* Effect.fail(conflict('That media id can no longer be uploaded'));
    }

    const store = yield* MediaStore;
    const presigned = yield* Effect.tryPromise({
      try: () =>
        store.presignPutUrl(
          albumMediaKey(spaceId, request.mediaId),
          ALBUM_CONTENT_TYPE,
          request.byteLength,
          { ifNoneMatch: true }
        ),
      catch: () => new InternalError({}),
    });

    return {
      mediaId: request.mediaId,
      generation: request.generation,
      uploadUrl: presigned.url,
      expiresInSec: MEDIA_PRESIGN_TTL_SEC,
      headers: presigned.headers,
    };
  });

/**
 * Abandon a reservation: claim it, then remove the object and release its bytes.
 *
 * The claim (`pending → expiring`) is what makes this safe. Once it lands,
 * finalisation can no longer complete the reservation, so the delete below can
 * never destroy an object that was just finalised. The row reaches `failed` —
 * the state that releases quota — only after storage positively confirms the
 * object is gone; otherwise it stays `expiring` for the sweep to retry, so a
 * failed delete never silently frees bytes that are still there.
 */
const abandonReservation = (
  db: DbService,
  store: MediaStoreService,
  spaceId: string,
  mediaId: string
): Effect.Effect<boolean, InternalError> =>
  Effect.gen(function* () {
    const claimed = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `update album_media_reservations set state = 'expiring'
              where space_id = ? and media_id = ? and state = 'pending'`
          )
          .bind(spaceId, mediaId)
          .run(),
      catch: () => new InternalError({}),
    });
    if ((claimed.meta?.changes ?? 0) === 0) {
      return false;
    }
    const confirmed = yield* deleteKeyConfirmed(store, albumMediaKey(spaceId, mediaId));
    if (!confirmed) {
      return false;
    }
    yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `update album_media_reservations set state = 'failed'
              where space_id = ? and media_id = ? and state = 'expiring'`
          )
          .bind(spaceId, mediaId)
          .run(),
      catch: () => new InternalError({}),
    });
    return true;
  });

/**
 * Finalise a reserved upload.
 *
 * Requires the owned reservation, active membership, an exact ciphertext-size
 * match, and an object whose identity can be pinned. Idempotent: a lost
 * response is retried, and a concurrent finalisation that won is success rather
 * than a conflict.
 */
export const finalizeAlbumMediaProgram = (
  userId: string,
  mediaId: string
): Effect.Effect<
  { ok: true },
  BadRequestError | ForbiddenError | NotFoundError | InternalError,
  DbService | MediaStoreService | ClockService
> =>
  Effect.gen(function* () {
    const db = yield* Db;
    const at = yield* nowMs;

    // Scope to the caller's active Space. A media id is not globally unique —
    // the table is keyed by (space_id, media_id) — so authorization comes from
    // the Space, never from the id being hard to guess.
    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return yield* Effect.fail(badRequest('You must have an active space to upload media'));
    }

    const reservation = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(`${RESERVATION_SELECT} where space_id = ? and media_id = ?`)
          .bind(spaceId, mediaId)
          .first<AlbumReservationRow>(),
      catch: () => new InternalError({}),
    });
    if (!reservation) {
      return yield* Effect.fail(notFound('Media not found'));
    }
    if (reservation.created_by_user_id !== userId) {
      return yield* Effect.fail(forbidden('You can only confirm your own uploads'));
    }
    if (reservation.state === 'complete') {
      return { ok: true as const };
    }
    if (reservation.state !== 'pending') {
      // `expiring` means cleanup owns it; `failed` means it is gone. Either way
      // there is nothing here to finalise.
      return yield* Effect.fail(badRequest('That upload is no longer available'));
    }
    if (reservation.expires_at <= at) {
      // Past its window, so cleanup is free to reclaim the object: finalising
      // now would race the delete.
      return yield* Effect.fail(badRequest('That upload has expired'));
    }
    if (!(yield* isActiveMember(db, reservation.space_id, userId))) {
      return yield* Effect.fail(forbidden('You are no longer a member of this Space'));
    }

    const store = yield* MediaStore;
    const head = yield* Effect.tryPromise({
      try: () => store.head(albumMediaKey(reservation.space_id, mediaId)),
      catch: () => new InternalError({}),
    });
    if (head === null) {
      // Nothing has landed yet. The client may still PUT; leave it pending.
      return yield* Effect.fail(badRequest('The uploaded object was not found'));
    }
    if (head.size !== reservation.byte_length) {
      // Not the object that was reserved, and a conditional PUT means it can
      // never be replaced. Abandon it rather than hold quota for bytes that can
      // never be finalised.
      yield* abandonReservation(db, store, reservation.space_id, mediaId);
      return yield* Effect.fail(badRequest('Uploaded content does not match the reserved size'));
    }

    const transition = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `update album_media_reservations
                set state = 'complete', completed_at = ?, completed_etag = ?, completed_size = ?
              where space_id = ? and media_id = ? and state = 'pending'
                and expires_at > ?
                and exists (
                  select 1 from space_members
                   where space_id = album_media_reservations.space_id
                     and user_id = ? and state = 'active'
                )`
          )
          .bind(at, head.httpEtag, head.size, spaceId, mediaId, at, userId)
          .run(),
      catch: () => new InternalError({}),
    });
    if ((transition.meta?.changes ?? 0) === 0) {
      const fresh = yield* Effect.tryPromise({
        try: () =>
          db.d1
            .prepare(
              'select state, expires_at from album_media_reservations where space_id = ? and media_id = ?'
            )
            .bind(spaceId, mediaId)
            .first<{ state: string; expires_at: number }>(),
        catch: () => new InternalError({}),
      });
      if (fresh?.state === 'complete') {
        // A concurrent finalisation won. Success, not a conflict.
        return { ok: true as const };
      }
      if (!fresh || fresh.state !== 'pending') {
        return yield* Effect.fail(badRequest('That upload is no longer available'));
      }
      if (fresh.expires_at <= at) {
        return yield* Effect.fail(badRequest('That upload has expired'));
      }
      return yield* Effect.fail(forbidden('You are no longer a member of this Space'));
    }

    return { ok: true as const };
  });
