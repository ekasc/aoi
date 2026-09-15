import { Effect } from 'effect';

import type { WorkerCtx } from '../env';
import { Db, guardedUpdate, type DbService } from '../effects/d1';
import { nowMs } from '../effects/clock';
import { Logger, logInfo, type LoggerService } from '../effects/logger';
import { MediaStore, type MediaStoreService } from '../services/media-store';
import { mediaDisplayKey, mediaThumbKey } from '../domains/media';

/**
 * Cron programs — bounded retention/cleanup work, all idempotent (deletes
 * guarded by time bounds, safe to re-run). Every threshold reads the Clock
 * service so tests pin time with TestClock.
 */

export const ACTIVITY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const LOCATION_LIVE_FRESHNESS_MS = 15 * 60 * 1000; // live / until_arrive
export const LOCATION_GRANT_FRESHNESS_MS = 5 * 60 * 1000; // one-time grants

/** Staged uploads that never completed → remove after 24h (rows + R2). */
export const MEDIA_STAGED_TTL_MS = 24 * 60 * 60 * 1000;
/** Soft-deleted media rows + their R2 objects → purge after 30 days. */
export const MEDIA_SOFT_DELETE_PURGE_MS = 30 * 24 * 60 * 60 * 1000;
/** Push tokens not seen in 90 days are stale → prune. */
export const PUSH_TOKEN_STALE_MS = 90 * 24 * 60 * 60 * 1000;
/** Orphan sweep is bounded: page size per R2 list call. */
export const ORPHAN_SWEEP_PAGE_LIMIT = 1000;
/**
 * Orphan sweep forward-progress bound: max R2 pages per scheduled execution.
 * The sweep follows `cursor` within a single run (so it cannot get stuck
 * forever on the first page) but never scans the whole bucket unbounded.
 */
export const ORPHAN_SWEEP_MAX_PAGES = 5;
/**
 * Orphan publication-race guard: an R2 object younger than this is never
 * treated as an orphan, even when no DB row claims it. The upload intent
 * inserts the DB row before the device PUT lands, but the row may not be
 * visible yet (replication / in-flight PUT); `R2Object.uploaded` is the only
 * trustworthy age signal. Objects with missing/invalid/future `uploaded`
 * are treated as young (fail-closed).
 */
export const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Fail-closed storage delete: returns true only when R2 positively shows the
 * key is gone — either `delete` succeeded (R2 delete is idempotent) or a
 * follow-up `head` returns null (already absent). Any uncertainty (delete
 * threw AND head shows present or head itself failed) returns false so the
 * caller retains the authoritative DB row for a later retry.
 */
const deleteKeyConfirmed = (
  store: MediaStoreService,
  key: string
): Effect.Effect<boolean, never, never> =>
  Effect.tryPromise({
    try: () => store.delete(key),
    catch: () => new Error('cron: r2 delete failed'),
  }).pipe(
    Effect.as(true),
    Effect.catchAll(() =>
      Effect.tryPromise({
        try: () => store.head(key),
        catch: () => new Error('cron: r2 head failed'),
      }).pipe(
        Effect.map((head) => head === null),
        Effect.catchAll(() => Effect.succeed(false))
      )
    )
  );

/**
 * Minimum-age gate for orphan candidates. Unknown age (missing, non-Date,
 * NaN, or future-dated via clock skew) is NOT eligible — uncertainty must
 * never cause deletion.
 */
function isOrphanAgedEnough(uploaded: unknown, now: number): boolean {
  if (!(uploaded instanceof Date)) return false;
  const t = uploaded.getTime();
  if (!Number.isFinite(t)) return false;
  if (t > now) return false;
  return now - t >= ORPHAN_MIN_AGE_MS;
}

/**
 * Retention sweep:
 * 1. purge `space_activity` older than 7 days (tombstones are read-side
 *    ephemeral — the feed never needs old entries),
 * 2. delete expired `location_shares` (ephemeral by design: expiry must
 *    leave nothing behind — live/until_arrive 15 min, grants 5 min).
 */
export const retentionProgram = Effect.gen(function* () {
  const now = yield* nowMs;

  yield* logInfo('cron: retention sweep started', { at: new Date(now).toISOString() });

  const activity = yield* guardedUpdate(
    'delete from space_activity where occurred_at < ?',
    now - ACTIVITY_RETENTION_MS
  );

  const liveExpired = yield* guardedUpdate(
    `delete from location_shares
      where (mode in ('live', 'until_arrive') and reported_at < ?)
         or (mode = 'on_request_granted' and reported_at < ?)`,
    now - LOCATION_LIVE_FRESHNESS_MS,
    now - LOCATION_GRANT_FRESHNESS_MS
  );

  yield* logInfo('cron: retention sweep done', {
    activityPurged: activity.changes,
    locationSharesExpired: liveExpired.changes,
  });

  return { activityPurged: activity.changes, locationSharesExpired: liveExpired.changes };
});

/**
 * Media purge sweep (fail-closed):
 * 1. staged (`pending`, >24h) rows: delete the authoritative R2 key, then the
 *    DB row — but ONLY when storage positively confirms absence (delete
 *    succeeded or head returns null). A transient R2 failure retains the row
 *    for the next run (retryable, idempotent).
 * 2. soft-deleted rows older than 30 days: same per-row confirmation across
 *    original + display/thumb before the DB row is removed.
 * 3. orphan R2 objects under `media/` (no row claims them): deleted only when
 *    ALL of these hold —
 *    - the known-key DB lookup succeeded (never substitute empty on failure),
 *    - every `variant_keys` payload parsed into string values (any malformed
 *      reference data aborts the phase),
 *    - the object is sufficiently aged per `uploaded` (>= ORPHAN_MIN_AGE_MS;
 *      missing/invalid/future timestamps are treated as young),
 *    - pagination follows `cursor` for bounded forward progress (at most
 *      ORPHAN_SWEEP_MAX_PAGES pages per run, never a full-bucket scan).
 * 4. stale push tokens (no `last_seen_at` in 90 days) are pruned (bounded
 *    guarded delete, unchanged).
 *
 * Deletion invariants: uncertainty never causes deletion; R2 failures are
 * logged and retried, never converted into “does not exist”.
 */
export const mediaPurgeProgram = Effect.gen(function* () {
  const db = yield* Db;
  const store = yield* MediaStore;
  const now = yield* nowMs;

  // 1. Staged uploads (fail-closed per row).
  const staged = yield* Effect.tryPromise({
    try: () =>
      db.d1
        .prepare(
          `select id, mime_type, storage_key from media_objects
           where upload_state = 'pending' and created_at < ?`
        )
        .bind(now - MEDIA_STAGED_TTL_MS)
        .all<{ id: string; mime_type: string; storage_key: string }>(),
    catch: () => new Error('cron: staged query failed'),
  }).pipe(
    Effect.catchAll(() =>
      Effect.flatMap(Logger, (l) => {
        l.warn('cron: staged query failed');
        return Effect.succeed({ results: [] as { id: string; mime_type: string; storage_key: string }[] });
      })
    )
  );

  const stagedRows = staged.results ?? [];
  let stagedPurged = 0;
  for (const row of stagedRows) {
    const confirmed = yield* deleteKeyConfirmed(store, row.storage_key);
    if (!confirmed) {
      yield* Effect.flatMap(Logger, (l) => {
        l.warn('cron: staged storage delete uncertain — retaining row for retry');
        return Effect.void;
      });
      continue;
    }
    const deleted = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `delete from media_objects
             where id = ? and upload_state = 'pending' and created_at < ?`
          )
          .bind(row.id, now - MEDIA_STAGED_TTL_MS)
          .run(),
      catch: () => new Error('cron: staged row delete failed'),
    }).pipe(
      Effect.map((res) => res.meta?.changes ?? 0),
      Effect.catchAll(() =>
        Effect.flatMap(Logger, (l) => {
          l.warn('cron: staged row delete failed');
          return Effect.succeed(0);
        })
      )
    );
    if (deleted > 0) stagedPurged += 1;
  }

  // 2. Soft-deleted purge (fail-closed per row).
  const softDeleted = yield* Effect.tryPromise({
    try: () =>
      db.d1
        .prepare(
          `select id, mime_type, storage_key from media_objects
           where deleted_at is not null and deleted_at < ?`
        )
        .bind(now - MEDIA_SOFT_DELETE_PURGE_MS)
        .all<{ id: string; mime_type: string; storage_key: string }>(),
    catch: () => new Error('cron: soft-delete query failed'),
  }).pipe(
    Effect.catchAll(() =>
      Effect.flatMap(Logger, (l) => {
        l.warn('cron: soft-delete query failed');
        return Effect.succeed({ results: [] as { id: string; mime_type: string; storage_key: string }[] });
      })
    )
  );

  const softDeletedRows = softDeleted.results ?? [];
  let softDeletedPurged = 0;
  for (const row of softDeletedRows) {
    const keys = [row.storage_key, mediaDisplayKey(row.id), mediaThumbKey(row.id)];
    let allConfirmed = true;
    for (const key of keys) {
      const confirmed = yield* deleteKeyConfirmed(store, key);
      if (!confirmed) {
        allConfirmed = false;
        break;
      }
    }
    if (!allConfirmed) {
      yield* Effect.flatMap(Logger, (l) => {
        l.warn('cron: purge storage delete uncertain — retaining row for retry');
        return Effect.void;
      });
      continue;
    }
    const deleted = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `delete from media_objects
             where id = ? and deleted_at is not null and deleted_at < ?`
          )
          .bind(row.id, now - MEDIA_SOFT_DELETE_PURGE_MS)
          .run(),
      catch: () => new Error('cron: purge row delete failed'),
    }).pipe(
      Effect.map((res) => res.meta?.changes ?? 0),
      Effect.catchAll(() =>
        Effect.flatMap(Logger, (l) => {
          l.warn('cron: purge row delete failed');
          return Effect.succeed(0);
        })
      )
    );
    if (deleted > 0) softDeletedPurged += 1;
  }

  // 3. Orphan R2 sweep (bounded cursor pagination, fail-closed).
  let orphanScanned = 0;
  let orphansDeleted = 0;

  const firstPage = yield* Effect.tryPromise({
    try: () => store.list({ prefix: 'media/', limit: ORPHAN_SWEEP_PAGE_LIMIT }),
    catch: () => new Error('cron: r2 list failed'),
  }).pipe(
    Effect.map((listing) => ({ ok: true as const, listing })),
    Effect.catchAll(() =>
      Effect.flatMap(Logger, (l) => {
        l.warn('cron: r2 list failed');
        return Effect.succeed({ ok: false as const, listing: null as null });
      })
    )
  );

  if (firstPage.ok && firstPage.listing && (firstPage.listing.objects ?? []).length > 0) {
    // Known-key lookup: failure aborts the orphan phase with ZERO deletes.
    // Never convert DB uncertainty into an empty authoritative set.
    const knownOutcome = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `select storage_key, variant_keys from media_objects`
          )
          .all<{ storage_key: string; variant_keys: string | null }>(),
      catch: () => new Error('cron: known-keys query failed'),
    }).pipe(
      Effect.map((res) => ({ ok: true as const, results: res.results ?? [] })),
      Effect.catchAll(() =>
        Effect.flatMap(Logger, (l) => {
          l.warn('cron: known-keys query failed — skipping orphan sweep (fail-closed)');
          return Effect.succeed({ ok: false as const, results: [] as { storage_key: string; variant_keys: string | null }[] });
        })
      )
    );

    if (!knownOutcome.ok) {
      yield* logInfo('cron: orphan sweep skipped', { reason: 'known-keys-uncertain', scanned: 0, orphaned: 0 });
    } else {
      // Variant metadata uncertainty aborts the phase: a malformed payload
      // means the known set cannot be trusted.
      const known = new Set<string>();
      let referenceUntrusted = false;
      for (const row of knownOutcome.results) {
        known.add(row.storage_key);
        if (row.variant_keys) {
          try {
            const parsed = JSON.parse(row.variant_keys) as unknown;
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
              referenceUntrusted = true;
              break;
            }
            for (const value of Object.values(parsed as Record<string, unknown>)) {
              if (typeof value !== 'string' || value.length === 0) {
                referenceUntrusted = true;
                break;
              }
              known.add(value);
            }
            if (referenceUntrusted) break;
          } catch {
            referenceUntrusted = true;
            break;
          }
        }
      }

      if (referenceUntrusted) {
        yield* Effect.flatMap(Logger, (l) => {
          l.warn('cron: variant reference data untrusted — skipping orphan sweep (fail-closed)');
          return Effect.void;
        });
        yield* logInfo('cron: orphan sweep skipped', { reason: 'variant-uncertain', scanned: 0, orphaned: 0 });
      } else {
        let cursor: string | undefined = undefined;
        let truncated = true;
        let pages = 0;
        let current: typeof firstPage.listing | null = firstPage.listing;

        while (current && pages < ORPHAN_SWEEP_MAX_PAGES) {
          pages += 1;
          const objects = current.objects ?? [];
          orphanScanned += objects.length;
          for (const object of objects) {
            if (known.has(object.key)) continue;
            if (!isOrphanAgedEnough(object.uploaded, now)) continue;
            const deleted = yield* Effect.tryPromise({
              try: () => store.delete(object.key),
              catch: () => new Error('cron: orphan delete failed'),
            }).pipe(
              Effect.map(() => true),
              Effect.catchAll(() =>
                Effect.flatMap(Logger, (l) => {
                  l.warn('cron: orphan delete failed — will retry next run');
                  return Effect.succeed(false);
                })
              )
            );
            if (deleted) orphansDeleted += 1;
          }

          truncated = current.truncated;
          cursor = current.cursor;
          if (!truncated) break;
          if (!cursor) {
            yield* Effect.flatMap(Logger, (l) => {
              l.warn('cron: orphan listing truncated without cursor — stopping (bounded)');
              return Effect.void;
            });
            break;
          }
          if (pages >= ORPHAN_SWEEP_MAX_PAGES) break;

          const next = yield* Effect.tryPromise({
            try: () => store.list({ prefix: 'media/', limit: ORPHAN_SWEEP_PAGE_LIMIT, cursor }),
            catch: () => new Error('cron: r2 list failed'),
          }).pipe(
            Effect.map((listing) => ({ ok: true as const, listing })),
            Effect.catchAll(() =>
              Effect.flatMap(Logger, (l) => {
                l.warn('cron: r2 list failed mid-sweep — stopping (fail-closed)');
                return Effect.succeed({ ok: false as const, listing: null as null });
              })
            )
          );
          if (!next.ok || !next.listing) break;
          current = next.listing;
        }

        yield* logInfo('cron: orphan sweep done', { scanned: orphanScanned, orphaned: orphansDeleted });
      }
    }
  } else if (!firstPage.ok) {
    // R2 list failure is already fail-closed (zero deletes); nothing to do.
  }

  // 4. Stale push tokens.
  const staleTokens = yield* guardedUpdate(
    'delete from push_tokens where last_seen_at < ?',
    now - PUSH_TOKEN_STALE_MS
  );

  yield* logInfo('cron: media purge done', {
    stagedPurged,
    softDeletedPurged,
    orphanScanned,
    orphansDeleted,
    staleTokensPruned: staleTokens.changes,
  });

  return {
    stagedPurged,
    softDeletedPurged,
    orphanScanned,
    orphansDeleted,
    staleTokensPruned: staleTokens.changes,
  };
});

/** Scheduled entry: route the cron name to its program (retention + media). */
export const scheduledProgram = (
  cron: string,
  _ctx: WorkerCtx
) => {
  void cron;
  return Effect.gen(function* () {
    yield* retentionProgram;
    yield* mediaPurgeProgram;
  });
};
