import { Effect } from 'effect';

import {
  albumUploadIntentRequestSchema,
  spaceBackupSchema,
  type AlbumMediaRecord,
  type AlbumUploadIntentRequest,
  type AlbumUploadIntentResponse,
  type SpaceBackup,
} from '@aoi/shared';

import { nowMs, type ClockService } from '../effects/clock';
import { newId, type IdService } from '../effects/id';
import { Db, type DbService } from '../effects/d1';
import {
  MEDIA_PRESIGN_TTL_SEC,
  MediaStore,
  type MediaStoreService,
} from '../services/media-store';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  badRequest,
  conflict,
  forbidden,
  notFound,
} from './errors';
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
  BadRequestError | InternalError,
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
    yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `insert into album_media
               (id, space_id, created_by_user_id, mime_type, byte_length, width,
                height, person_tag, sealed_nonce, wrapped_key_nonce,
                wrapped_key_ciphertext, storage_key, upload_state, created_at)
             values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
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
            at
          )
          .run(),
      catch: () => new InternalError({}),
    });

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
      yield* markFailed();
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
