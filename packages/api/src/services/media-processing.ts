import { fileTypeFromBuffer } from 'file-type';
import { Effect } from 'effect';

import { MEDIA_MAX_BYTES } from '@aoi/shared';

import { nowMs, type ClockService } from '../effects/clock';
import { Db, type DbService } from '../effects/d1';
import { Logger, type LoggerService } from '../effects/logger';
import {
  MediaStore,
  type MediaStoreService,
} from '../services/media-store';
import { mediaDisplayKey, mediaThumbKey } from '../domains/media';

/**
 * Media sanitization — runs inside the queue consumer (`media.sanitize`),
 * never on the request path. Follows Tsuki's proven worker pattern:
 * dynamic `await import('sharp')` (sharp pinned 0.35.3 + @img/sharp-wasm32
 * under nodejs_compat), `limitInputPixels` + dimension caps, WebP output.
 *
 * Privacy guarantees (verified by tests):
 * - EXIF/GPS segments never survive: the display/thumb variants are
 *   re-encoded from pixels only (`.rotate()` consumes orientation, the
 *   re-encode drops every metadata segment);
 * - magic-byte verification (`file-type`) rejects renamed payloads;
 * - animated inputs collapse to a single frame (no animation carried);
 * - output size caps bound stored bytes per variant.
 *
 * Idempotency: the terminal update is guarded on `upload_state='complete'`
 * AND `content_hash is null` (audio) / `variant_keys is null` (images), so a
 * re-delivered job is a no-op. Processing failures are bounded: the row's
 * `processing_attempts` counter is incremented, and after
 * `MAX_MEDIA_PROCESSING_ATTEMPTS` the row is marked `failed` (terminal);
 * the queue-level retry/DLQ policy handles transient failures in between.
 */

export const MAX_MEDIA_PROCESSING_ATTEMPTS = 3;

// Tsuki's proven input cap: 16384 × 16384 + slack.
export const SHARP_LIMIT_INPUT_PIXELS = 268_402_689;
export const MAX_IMAGE_DIMENSION = 16_384;

export const DISPLAY_MAX_DIMENSION = 2048;
export const THUMB_MAX_DIMENSION = 512;
export const DISPLAY_MAX_BYTES = 8 * 1024 * 1024;
export const THUMB_MAX_BYTES = 1024 * 1024;

interface MediaRow {
  id: string;
  mime_type: string;
  storage_key: string;
  upload_state: 'pending' | 'complete' | 'failed';
  content_hash: string | null;
  variant_keys: string | null;
  processing_attempts: number;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const view = new Uint8Array(bytes.byteLength);
  view.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', view.buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Does the detected magic type match the declared family? */
function magicMatches(declared: string, detected: { mime: string } | undefined): boolean {
  if (!detected) {
    // file-type cannot identify proprietary containers (HEIC/HEIF) — the
    // sharp decoder is the validator for those.
    return declared === 'image/heic' || declared === 'image/heif';
  }
  if (declared === 'image/jpeg') return detected.mime === 'image/jpeg';
  if (declared === 'image/png') return detected.mime === 'image/png';
  if (declared === 'image/webp') return detected.mime === 'image/webp';
  if (declared === 'image/gif') return detected.mime === 'image/gif';
  if (declared === 'image/avif') return detected.mime === 'image/avif';
  if (declared.startsWith('audio/')) return detected.mime.startsWith('audio/');
  return false;
}

interface MediaRowLike {
  id: string;
  mime_type: string;
  storage_key: string;
  upload_state: 'pending' | 'complete' | 'failed';
  content_hash: string | null;
  variant_keys: string | null;
  processing_attempts: number;
}

/** Guarded terminal transition complete → failed (best-effort). */
function markFailed(db: DbService, mediaId: string, attempts: number, at: number): Effect.Effect<void, never, LoggerService> {
  return Effect.tryPromise({
    try: () =>
      db.d1
        .prepare(
          `update media_objects
           set upload_state = 'failed', processing_attempts = ?, completed_at = ?
           where id = ? and upload_state = 'complete'`
        )
        .bind(attempts + 1, at, mediaId)
        .run(),
    catch: () => new Error('media: failed-state update failed'),
  }).pipe(
    Effect.catchAll(() =>
      Effect.flatMap(Logger, (logger) => {
        logger.warn('media: failed-state update failed', { mediaId });
        return Effect.void;
      })
    )
  );
}

/**
 * The sanitize job body. Fails only for retryable conditions; terminal
 * conditions are contained and logged. Never dies.
 *
 * Retry accounting lives in `sanitizeMediaJob` (via `Effect.catchAll`): a
 * `yield*` failure inside the gen must reach the bounded-attempts logic, and
 * it never passes through a JavaScript try/catch — only Effect combinators
 * see it.
 */
function sanitizeMediaBody(
  mediaId: string
): Effect.Effect<void, Error, DbService | MediaStoreService | LoggerService | ClockService> {
  return Effect.gen(function* () {
    const db = yield* Db;
    const store = yield* MediaStore;
    const logger = yield* Logger;

    const row = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `select id, mime_type, storage_key, upload_state, content_hash,
                    variant_keys, processing_attempts
             from media_objects where id = ? limit 1`
          )
          .bind(mediaId)
          .first<MediaRowLike>(),
      catch: () => new Error('media: row load failed'),
    });

    if (!row) {
      // Row gone (purged) — nothing to do; ack cleanly.
      return;
    }

    // State machine gate: only head-verified `complete` objects sanitize.
    if (row.upload_state !== 'complete') {
      logger.info('media: sanitize skipped (not complete)', { mediaId, state: row.upload_state });
      return;
    }
    // Idempotent re-delivery: already sanitized.
    if (row.content_hash !== null) {
      logger.info('media: sanitize skipped (already sanitized)', { mediaId });
      return;
    }

    try {
      const original = yield* Effect.tryPromise({
        try: () => store.get(row.storage_key),
        catch: () => new Error('media: original read failed'),
      });
      if (!original) {
        // Object missing (never uploaded / purged) — terminal: fail the row.
        yield* markFailed(db, mediaId, row.processing_attempts, yield* nowMs);
        logger.warn('media: original object missing, marked failed', { mediaId });
        return;
      }

      const bytes = new Uint8Array(
        yield* Effect.tryPromise({
          try: () => new Response(original.body).arrayBuffer(),
          catch: () => new Error('media: original read failed'),
        })
      );
      if (bytes.byteLength > MEDIA_MAX_BYTES) {
        yield* markFailed(db, mediaId, row.processing_attempts, yield* nowMs);
        logger.warn('media: oversized object, marked failed', { mediaId });
        return;
      }

      const detected = yield* Effect.tryPromise({
        try: () => fileTypeFromBuffer(bytes),
        catch: () => new Error('media: magic-byte detection failed'),
      });
      if (!magicMatches(row.mime_type, detected)) {
        yield* markFailed(db, mediaId, row.processing_attempts, yield* nowMs);
        logger.warn('media: magic-byte mismatch, marked failed', {
          mediaId,
          declared: row.mime_type,
          detected: detected?.mime ?? null,
        });
        return;
      }

      const contentHash = yield* Effect.tryPromise({
        try: () => sha256Hex(bytes),
        catch: () => new Error('media: hashing failed'),
      });
      const at = yield* nowMs;

      if (row.mime_type.startsWith('audio/')) {
        // Audio: pass-through verified (no re-encode). Record the hash and
        // complete; variants stay absent and serve resolves to original.
        const result = yield* Effect.tryPromise({
          try: () =>
            db.d1
              .prepare(
                `update media_objects
                 set content_hash = ?, processing_attempts = ?, completed_at = ?
                 where id = ? and upload_state = 'complete' and content_hash is null`
              )
              .bind(contentHash, row.processing_attempts + 1, at, mediaId)
              .run(),
          catch: () => new Error('media: audio completion update failed'),
        });
        logger.info('media: audio verified', {
          mediaId,
          raced: (result.meta?.changes ?? 0) === 0,
        });
        return;
      }

      // Image: sharp re-encode (Tsuki pattern: dynamic import, pixel cap).
      const { default: sharp } = yield* Effect.tryPromise({
        try: () => import('sharp'),
        catch: () => new Error('media: sharp import failed'),
      });
      const shared = { limitInputPixels: SHARP_LIMIT_INPUT_PIXELS, sequentialRead: true } as const;

      const metadata = yield* Effect.tryPromise({
        try: () => sharp(bytes, shared).metadata(),
        catch: () => new Error('media: sharp metadata failed'),
      });
      const width = metadata.width ?? 0;
      const height = metadata.height ?? 0;
      if (width <= 0 || height <= 0 || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
        yield* markFailed(db, mediaId, row.processing_attempts, yield* nowMs);
        logger.warn('media: dimension cap exceeded, marked failed', { mediaId, width, height });
        return;
      }

      const displayKey = mediaDisplayKey(mediaId);
      const thumbKey = mediaThumbKey(mediaId);

      const display = yield* Effect.tryPromise({
        try: () =>
          sharp(bytes, shared)
            .rotate()
            .resize(DISPLAY_MAX_DIMENSION, DISPLAY_MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 84 })
            .toBuffer(),
        catch: () => new Error('media: display encode failed'),
      });
      if (display.byteLength > DISPLAY_MAX_BYTES) {
        yield* markFailed(db, mediaId, row.processing_attempts, yield* nowMs);
        logger.warn('media: display cap exceeded, marked failed', { mediaId });
        return;
      }

      const thumb = yield* Effect.tryPromise({
        try: () =>
          sharp(bytes, shared)
            .rotate()
            .resize(THUMB_MAX_DIMENSION, THUMB_MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 80 })
            .toBuffer(),
        catch: () => new Error('media: thumb encode failed'),
      });
      if (thumb.byteLength > THUMB_MAX_BYTES) {
        yield* markFailed(db, mediaId, row.processing_attempts, yield* nowMs);
        logger.warn('media: thumb cap exceeded, marked failed', { mediaId });
        return;
      }

      // Variants land at deterministic keys (same id → same keys, so a
      // re-delivery overwrites rather than duplicates).
      yield* Effect.tryPromise({
        try: () => store.put(displayKey, display, { httpMetadata: { contentType: 'image/webp' } }),
        catch: () => new Error('media: display put failed'),
      });
      yield* Effect.tryPromise({
        try: () => store.put(thumbKey, thumb, { httpMetadata: { contentType: 'image/webp' } }),
        catch: () => new Error('media: thumb put failed'),
      });

      const variantKeys = JSON.stringify({ display: displayKey, thumb: thumbKey });
      const result = yield* Effect.tryPromise({
        try: () =>
          db.d1
            .prepare(
              `update media_objects
               set content_hash = ?, variant_keys = ?, processing_attempts = ?, completed_at = ?
               where id = ? and upload_state = 'complete' and variant_keys is null`
            )
            .bind(contentHash, variantKeys, row.processing_attempts + 1, at, mediaId)
            .run(),
        catch: () => new Error('media: completion update failed'),
      });
      logger.info('media: sanitized', { mediaId, raced: (result.meta?.changes ?? 0) === 0 });
      return;
    } catch {
      // Unreachable for Effect failures (they surface via catchAll in
      // `sanitizeMediaJob`); retained only to contain sync throws from the
      // generator body itself (e.g. JSON.stringify) so they never Die.
      return yield* Effect.fail(new Error('media: unexpected sync failure'));
    }
  });
}

/**
 * The sanitize job entry: body + bounded retry accounting. Any body failure
 * (retryable condition) increments the row's `processing_attempts`; after
 * `MAX_MEDIA_PROCESSING_ATTEMPTS` the row is marked `failed` (terminal) and
 * the job is contained (ack, no DLQ). Below the cap the job FAILS so the
 * queue consumer's retry policy re-delivers it.
 */
export const sanitizeMediaJob = (
  mediaId: string
): Effect.Effect<void, Error, DbService | MediaStoreService | LoggerService | ClockService> =>
  sanitizeMediaBody(mediaId).pipe(
    Effect.catchAll((error) =>
      Effect.gen(function* () {
        const db = yield* Db;
        const logger = yield* Logger;

        // Re-read the current attempt count (concurrent deliveries may have
        // bumped it already).
        const row = yield* Effect.tryPromise({
          try: () =>
            db.d1
              .prepare(
                'select processing_attempts from media_objects where id = ? limit 1'
              )
              .bind(mediaId)
              .first<{ processing_attempts: number }>(),
          catch: () => new Error('media: attempts read failed'),
        }).pipe(
          Effect.catchAll(() => Effect.succeed({ processing_attempts: 0 }))
        );

        if (!row) {
          // Row gone (purged) — nothing left to do; ack cleanly.
          logger.warn('media: sanitize failed for missing row', { mediaId });
          return;
        }

        const nextAttempts = row.processing_attempts + 1;
        if (nextAttempts >= MAX_MEDIA_PROCESSING_ATTEMPTS) {
          yield* markFailed(db, mediaId, row.processing_attempts, yield* nowMs);
          logger.error('media: sanitize terminally failed', {
            mediaId,
            attempts: nextAttempts,
            error: error instanceof Error ? error.message : 'unknown',
          });
          return; // Terminal — contained, never a DLQ message.
        }

        yield* Effect.tryPromise({
          try: () =>
            db.d1
              .prepare(
                'update media_objects set processing_attempts = ? where id = ? and upload_state = ?'
              )
              .bind(nextAttempts, mediaId, 'complete')
              .run(),
          catch: () => new Error('media: attempts update failed'),
        }).pipe(Effect.catchAll(() => Effect.void));
        logger.warn('media: sanitize failed, retrying', { mediaId, attempts: nextAttempts });
        return yield* Effect.fail(new Error('media sanitize failed'));
      })
    )
  );
