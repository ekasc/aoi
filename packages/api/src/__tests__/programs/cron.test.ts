import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_RETENTION_MS,
  LOCATION_LIVE_FRESHNESS_MS,
  MEDIA_SOFT_DELETE_PURGE_MS,
  MEDIA_STAGED_TTL_MS,
  ORPHAN_MIN_AGE_MS,
  ORPHAN_SWEEP_MAX_PAGES,
  mediaPurgeProgram,
  retentionProgram,
} from '../../programs/cron';
import { makeTestHarness } from '../../effects/test-harness';
import { mediaDisplayKey, mediaOriginalKey, mediaThumbKey } from '../../domains/media';

function seed(d1: ReturnType<typeof makeTestHarness>['d1'], now: number): void {
  const db = d1.rawDb;
  db.prepare("insert into users (id, email, name) values ('u1', 'a@b.co', 'A')").run();
  db.prepare("insert into users (id, email, name) values ('u2', 'c@d.co', 'B')").run();
  db.prepare(
    "insert into spaces (id, name, relationship_start_date, created_by_user_id) values ('s1', 'us', '2024-06-01', 'u1')"
  ).run();
  db.prepare("insert into space_members (space_id, user_id, role, state) values ('s1', 'u1', 'you', 'active')").run();
  db.prepare("insert into space_members (space_id, user_id, role, state) values ('s1', 'u2', 'partner', 'active')").run();

  // Activity: one fresh, one stale.
  db.prepare(
    "insert into space_activity (id, space_id, actor_user_id, kind, occurred_at) values ('a1', 's1', 'u1', 'moment_deleted', ?)"
  ).bind(now - ACTIVITY_RETENTION_MS - 1000).run();
  db.prepare(
    "insert into space_activity (id, space_id, actor_user_id, kind, occurred_at) values ('a2', 's1', 'u1', 'moment_deleted', ?)"
  ).bind(now - 1000).run();

  // Location shares: expired live row + fresh grant + expired grant.
  const base = "insert into location_shares (id, user_id, space_id, mode, latitude, longitude, reported_at) values (?, ?, ?, ?, ?, ?, ?)";
  db.prepare(base).bind('l1', 'u1', 's1', 'live', 37.7, -122.4, now - LOCATION_LIVE_FRESHNESS_MS - 1000).run();
  db.prepare(base).bind('l2', 'u2', 's1', 'on_request_granted', 37.7, -122.4, now - 1000).run();
}

describe('retention cron program', () => {
  it('purges stale activity and expired location shares (keeps fresh rows)', async () => {
    const harness = makeTestHarness();
    const now = harness.clock.value();
    seed(harness.d1, now);

    const result = await Effect.runPromise(Effect.provide(retentionProgram, harness.layer));

    expect(result.activityPurged).toBe(1);
    expect(result.locationSharesExpired).toBe(1);

    const activity = harness.d1.rawDb.prepare('select id from space_activity').all() as Array<{ id: string }>;
    expect(activity.map((r) => r.id)).toEqual(['a2']);

    const shares = harness.d1.rawDb.prepare('select id from location_shares').all() as Array<{ id: string }>;
    expect(shares.map((r) => r.id)).toEqual(['l2']);
  });

  it('is a no-op when everything is fresh', async () => {
    const harness = makeTestHarness();
    const now = harness.clock.value();
    seed(harness.d1, now);
    harness.d1.rawDb
      .prepare('update space_activity set occurred_at = ? where id = ?')
      .bind(now - 1000, 'a1')
      .run();
    harness.d1.rawDb
      .prepare('update location_shares set reported_at = ? where id = ?')
      .bind(now - 1000, 'l1')
      .run();

    const result = await Effect.runPromise(Effect.provide(retentionProgram, harness.layer));
    expect(result.activityPurged).toBe(0);
    expect(result.locationSharesExpired).toBe(0);
  });

  it('is idempotent across runs (safe to re-fire)', async () => {
    const harness = makeTestHarness();
    const now = harness.clock.value();
    seed(harness.d1, now);

    const first = await Effect.runPromise(Effect.provide(retentionProgram, harness.layer));
    const second = await Effect.runPromise(Effect.provide(retentionProgram, harness.layer));

    expect(first.activityPurged).toBe(1);
    expect(second.activityPurged).toBe(0);
    expect(second.locationSharesExpired).toBe(0);
  });
});

function seedUserSpace(d1: ReturnType<typeof makeTestHarness>['d1']): void {
  const db = d1.rawDb;
  db.prepare("insert into users (id, email, name) values ('u1', 'a@b.co', 'A')").run();
  db.prepare(
    "insert into spaces (id, name, relationship_start_date, created_by_user_id) values ('s1', 'us', '2024-06-01', 'u1')"
  ).run();
  db.prepare("insert into space_members (space_id, user_id, role, state) values ('s1', 'u1', 'you', 'active')").run();
}

function insertMediaRow(
  d1: ReturnType<typeof makeTestHarness>['d1'],
  opts: {
    id: string;
    mimeType?: string;
    uploadState?: 'pending' | 'complete' | 'failed';
    variantKeys?: string | null;
    createdAt?: number;
    deletedAt?: number | null;
  }
): string {
  const mimeType = opts.mimeType ?? 'image/jpeg';
  const storageKey = mediaOriginalKey(opts.id, mimeType);
  const now = Date.parse('2026-01-15T00:00:00.000Z');
  d1.rawDb
    .prepare(
      `insert into media_objects
        (id, space_id, created_by_user_id, filename, mime_type, size_bytes,
         storage_key, upload_state, variant_keys, created_at, deleted_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      opts.id,
      's1',
      'u1',
      'photo.jpg',
      mimeType,
      1000,
      storageKey,
      opts.uploadState ?? 'complete',
      opts.variantKeys ?? null,
      opts.createdAt ?? now,
      opts.deletedAt ?? null
    )
    .run();
  return storageKey;
}

function mediaRowExists(d1: ReturnType<typeof makeTestHarness>['d1'], id: string): boolean {
  const row = d1.rawDb.prepare('select id from media_objects where id = ?').get(id) as { id: string } | undefined;
  return row !== undefined;
}

describe('media purge program (fail-closed)', () => {
  it('deletes zero R2 objects when the known-key DB lookup fails', async () => {
    const harness = makeTestHarness();
    const now = harness.clock.value();
    seedUserSpace(harness.d1);

    // One claimed row (complete, not staged/soft eligible) + its R2 object.
    const knownId = 'm-known-1';
    const knownKey = insertMediaRow(harness.d1, { id: knownId, uploadState: 'complete', createdAt: now });
    harness.r2.putSync(knownKey, new Uint8Array([1, 2, 3]), 'image/jpeg');

    // One aged orphan candidate.
    const orphanKey = 'media/orphan-1/original.bin';
    harness.r2.putSync(orphanKey, new Uint8Array([9, 9, 9]));

    // Deterministic injected D1 failure: only the known-keys lookup throws.
    const origPrepare = harness.d1.prepare.bind(harness.d1);
    harness.d1.prepare = ((sql: string) => {
      if (sql.includes('select storage_key, variant_keys')) {
        throw new Error('injected known-keys failure');
      }
      return origPrepare(sql);
    }) as typeof harness.d1.prepare;

    const result = await Effect.runPromise(Effect.provide(mediaPurgeProgram, harness.layer));

    expect(harness.r2.deletes).toHaveLength(0);
    expect(harness.r2.objects.has(orphanKey)).toBe(true);
    expect(harness.r2.objects.has(knownKey)).toBe(true);
    expect(mediaRowExists(harness.d1, knownId)).toBe(true);
    expect(result.orphansDeleted).toBe(0);
  });

  it('deletes zero orphans when variant reference metadata is malformed', async () => {
    const harness = makeTestHarness();
    const now = harness.clock.value();
    seedUserSpace(harness.d1);

    // Malformed variant_keys: unparseable JSON means the known set is untrusted.
    insertMediaRow(harness.d1, {
      id: 'm-bad-variant',
      uploadState: 'complete',
      createdAt: now,
      variantKeys: '{{{not-json',
    });

    const orphanKey = 'media/orphan-badref/original.bin';
    harness.r2.putSync(orphanKey, new Uint8Array([7, 7, 7]));

    const result = await Effect.runPromise(Effect.provide(mediaPurgeProgram, harness.layer));

    expect(harness.r2.deletes).toHaveLength(0);
    expect(harness.r2.objects.has(orphanKey)).toBe(true);
    expect(result.orphansDeleted).toBe(0);
  });

  it('does not sweep in-flight/recent objects (minimum-age guard)', async () => {
    const harness = makeTestHarness();
    const now = harness.clock.value();
    seedUserSpace(harness.d1);

    // No DB rows claim these keys — pure orphan candidates, but young.
    const recentKey = 'media/orphan-recent/original.bin';
    harness.r2.putSync(recentKey, new Uint8Array([5, 5, 5]), 'application/octet-stream', new Date(now - 1000));
    const futureKey = 'media/orphan-future/original.bin';
    harness.r2.putSync(futureKey, new Uint8Array([6, 6, 6]), 'application/octet-stream', new Date(now + 60_000));

    const result = await Effect.runPromise(Effect.provide(mediaPurgeProgram, harness.layer));

    expect(harness.r2.objects.has(recentKey)).toBe(true);
    expect(harness.r2.objects.has(futureKey)).toBe(true);
    expect(harness.r2.deletes).toHaveLength(0);
    expect(result.orphansDeleted).toBe(0);
    expect(ORPHAN_MIN_AGE_MS).toBeGreaterThan(0);
  });

  it('leaves failed R2 deletions retryable (staged + soft-deleted)', async () => {
    const harness = makeTestHarness();
    const now = harness.clock.value();
    seedUserSpace(harness.d1);

    // Staged: pending + older than 24h.
    const stagedId = 'm-staged-retry';
    const stagedKey = insertMediaRow(harness.d1, {
      id: stagedId,
      uploadState: 'pending',
      createdAt: now - MEDIA_STAGED_TTL_MS - 1000,
    });
    harness.r2.putSync(stagedKey, new Uint8Array([1, 1, 1]), 'image/jpeg');

    // Soft-deleted: deleted_at older than 30 days, with all three R2 keys.
    const purgedId = 'm-purge-retry';
    const purgedOriginal = insertMediaRow(harness.d1, {
      id: purgedId,
      uploadState: 'complete',
      createdAt: now - MEDIA_SOFT_DELETE_PURGE_MS - 2000,
      deletedAt: now - MEDIA_SOFT_DELETE_PURGE_MS - 1000,
    });
    const purgedDisplay = mediaDisplayKey(purgedId);
    const purgedThumb = mediaThumbKey(purgedId);
    harness.r2.putSync(purgedOriginal, new Uint8Array([2, 2, 2]), 'image/jpeg');
    harness.r2.putSync(purgedDisplay, new Uint8Array([3, 3, 3]), 'image/webp');
    harness.r2.putSync(purgedThumb, new Uint8Array([4, 4, 4]), 'image/webp');

    // Deterministic injected R2 failure: every delete throws, head still works.
    const origDelete = harness.r2.delete.bind(harness.r2);
    harness.r2.delete = async () => {
      throw new Error('injected R2 delete failure');
    };

    const first = await Effect.runPromise(Effect.provide(mediaPurgeProgram, harness.layer));

    // Fail-closed: rows retained, objects retained, nothing counted as purged.
    expect(first.stagedPurged).toBe(0);
    expect(first.softDeletedPurged).toBe(0);
    expect(mediaRowExists(harness.d1, stagedId)).toBe(true);
    expect(mediaRowExists(harness.d1, purgedId)).toBe(true);
    expect(harness.r2.objects.has(stagedKey)).toBe(true);
    expect(harness.r2.objects.has(purgedOriginal)).toBe(true);

    // Next run: storage recovers, the same rows are eligible and purge.
    harness.r2.delete = origDelete;
    const second = await Effect.runPromise(Effect.provide(mediaPurgeProgram, harness.layer));

    expect(second.stagedPurged).toBe(1);
    expect(second.softDeletedPurged).toBe(1);
    expect(mediaRowExists(harness.d1, stagedId)).toBe(false);
    expect(mediaRowExists(harness.d1, purgedId)).toBe(false);
    expect(harness.r2.objects.has(stagedKey)).toBe(false);
    expect(harness.r2.objects.has(purgedOriginal)).toBe(false);
    expect(harness.r2.objects.has(purgedDisplay)).toBe(false);
    expect(harness.r2.objects.has(purgedThumb)).toBe(false);

    // Idempotent: a third run is a no-op.
    const third = await Effect.runPromise(Effect.provide(mediaPurgeProgram, harness.layer));
    expect(third.stagedPurged).toBe(0);
    expect(third.softDeletedPurged).toBe(0);
  });

  it('still cleans up legitimate sufficiently-aged orphans (and keeps claimed keys)', async () => {
    const harness = makeTestHarness();
    const now = harness.clock.value();
    seedUserSpace(harness.d1);

    const knownId = 'm-known-keep';
    const displayKey = mediaDisplayKey(knownId);
    const thumbKey = mediaThumbKey(knownId);
    const knownKey = insertMediaRow(harness.d1, {
      id: knownId,
      uploadState: 'complete',
      createdAt: now,
      variantKeys: JSON.stringify({ display: displayKey, thumb: thumbKey }),
    });
    harness.r2.putSync(knownKey, new Uint8Array([1]), 'image/jpeg');
    harness.r2.putSync(displayKey, new Uint8Array([2]), 'image/webp');
    harness.r2.putSync(thumbKey, new Uint8Array([3]), 'image/webp');

    // Aged orphan (default uploaded Date(0) is far older than 24h).
    const orphanKey = 'media/orphan-legit/original.bin';
    harness.r2.putSync(orphanKey, new Uint8Array([9]));

    const result = await Effect.runPromise(Effect.provide(mediaPurgeProgram, harness.layer));

    expect(harness.r2.objects.has(orphanKey)).toBe(false);
    expect(harness.r2.deletes).toContain(orphanKey);
    expect(harness.r2.objects.has(knownKey)).toBe(true);
    expect(harness.r2.objects.has(displayKey)).toBe(true);
    expect(harness.r2.objects.has(thumbKey)).toBe(true);
    expect(result.orphansDeleted).toBe(1);
    expect(result.orphanScanned).toBeGreaterThanOrEqual(2);
  });

  it('makes bounded forward progress across R2 pages (cursor, no unbounded scan)', async () => {
    // Forward progress: 5 aged orphans, listing forced to 2-per-page.
    const harness = makeTestHarness();
    seedUserSpace(harness.d1);
    const orphanKeys = [
      'media/orphan-p1/original.bin',
      'media/orphan-p2/original.bin',
      'media/orphan-p3/original.bin',
      'media/orphan-p4/original.bin',
      'media/orphan-p5/original.bin',
    ];
    for (const key of orphanKeys) {
      harness.r2.putSync(key, new Uint8Array([8]));
    }

    let listCalls = 0;
    const origList = harness.r2.list.bind(harness.r2);
    harness.r2.list = async (opts) => {
      // Only the media prefix is under test; the album pass is its own sweep.
      if (opts?.prefix !== 'media/') return origList(opts);
      listCalls += 1;
      return origList({ ...opts, limit: 2 });
    };

    const result = await Effect.runPromise(Effect.provide(mediaPurgeProgram, harness.layer));

    // Old single-page code would leave the last 3 behind; cursor progress deletes all 5.
    for (const key of orphanKeys) {
      expect(harness.r2.objects.has(key)).toBe(false);
    }
    expect(result.orphansDeleted).toBe(5);
    expect(listCalls).toBe(3);

    // Bounded: an always-truncated bucket must stop after MAX_PAGES, not loop forever.
    const harness2 = makeTestHarness();
    seedUserSpace(harness2.d1);
    let infiniteCalls = 0;
    harness2.r2.list = async (opts) => {
      if (opts?.prefix !== 'media/') return { objects: [], truncated: false, cursor: undefined };
      infiniteCalls += 1;
      const n = infiniteCalls;
      return {
        objects: [
          {
            key: `media/orphan-inf-${n}/original.bin`,
            size: 10,
            httpEtag: `etag-${n}`,
            uploaded: new Date(0),
            writeHttpMetadata() {},
          },
        ],
        truncated: true,
        cursor: `cursor-${n}`,
      };
    };

    await Effect.runPromise(Effect.provide(mediaPurgeProgram, harness2.layer));
    expect(infiniteCalls).toBe(ORPHAN_SWEEP_MAX_PAGES);
  });
});

describe('album cleanup', () => {
  const ALBUM_MEDIA = '00000000-0000-4000-8000-000000000101';
  const albumKey = `album/s1/${ALBUM_MEDIA}.bin`;

  function insertReservation(
    d1: ReturnType<typeof makeTestHarness>['d1'],
    state: 'pending' | 'expiring' | 'complete' | 'failed',
    expiresAt: number
  ): void {
    d1.rawDb
      .prepare(
        `insert into album_media_reservations
           (space_id, media_id, created_by_user_id, uploader_device_id, generation,
            byte_length, state, created_at, expires_at)
         values ('s1', ?, 'u1', 'device-a', 1, 10, ?, ?, ?)`
      )
      .run(ALBUM_MEDIA, state, expiresAt - 1000, expiresAt);
  }

  /** A legacy album row, with the one object its storage key names. */
  function insertLegacyAlbum(
    d1: ReturnType<typeof makeTestHarness>['d1'],
    id: string,
    opts: { state?: string; createdAt: number; deletedAt?: number | null }
  ): string {
    const key = `album/s1/${id}.bin`;
    d1.rawDb
      .prepare(
        `insert into album_media
           (id, space_id, created_by_user_id, mime_type, byte_length, sealed_nonce,
            wrapped_key_nonce, wrapped_key_ciphertext, storage_key, upload_state, created_at, deleted_at)
         values (?, 's1', 'u1', 'image/jpeg', 10, 'n', 'n', 'c', ?, ?, ?, ?)`
      )
      .run(id, key, opts.state ?? 'pending', opts.createdAt, opts.deletedAt ?? null);
    return key;
  }

  function reservationState(d1: ReturnType<typeof makeTestHarness>['d1']): string {
    const row = d1.rawDb
      .prepare('select state from album_media_reservations where media_id = ?')
      .get(ALBUM_MEDIA) as { state: string };
    return row.state;
  }

  it('deletes an abandoned object and only then releases its reservation', async () => {
    const harness = makeTestHarness();
    seedUserSpace(harness.d1);
    const now = harness.clock.value();
    insertReservation(harness.d1, 'pending', now - 1);
    harness.r2.putSync(albumKey, new Uint8Array(10), 'application/octet-stream');

    const result = await Effect.runPromise(Effect.provide(mediaPurgeProgram, harness.layer));

    expect(result.reservationsExpired).toBe(1);
    expect(harness.r2.objects.has(albumKey)).toBe(false);
    expect(reservationState(harness.d1)).toBe('failed');
  });

  it('leaves a completed reservation and its object alone', async () => {
    const harness = makeTestHarness();
    seedUserSpace(harness.d1);
    const now = harness.clock.value();
    insertReservation(harness.d1, 'complete', now - 1);
    harness.r2.putSync(albumKey, new Uint8Array(10), 'application/octet-stream');

    const result = await Effect.runPromise(Effect.provide(mediaPurgeProgram, harness.layer));

    expect(result.reservationsExpired).toBe(0);
    expect(harness.r2.objects.has(albumKey)).toBe(true);
  });

  it('retains the reservation when the storage delete cannot be confirmed', async () => {
    const harness = makeTestHarness();
    seedUserSpace(harness.d1);
    const now = harness.clock.value();
    insertReservation(harness.d1, 'pending', now - 1);
    harness.r2.putSync(albumKey, new Uint8Array(10), 'application/octet-stream');
    harness.r2.delete = async () => {
      throw new Error('r2 down');
    };

    const result = await Effect.runPromise(Effect.provide(mediaPurgeProgram, harness.layer));

    expect(result.reservationsExpired).toBe(0);
    expect(harness.r2.objects.has(albumKey)).toBe(true);
    // Claimed but not finished, so it still holds its bytes for the next sweep.
    expect(reservationState(harness.d1)).toBe('expiring');
  });

  it('does not reclaim a claimed reservation while its PUT URL can still land', async () => {
    const harness = makeTestHarness();
    seedUserSpace(harness.d1);
    const now = harness.clock.value();
    // Claimed, but the authorization it was issued under has not lapsed yet —
    // deleting now would let a late PUT refill the key after the row stopped
    // counting it.
    insertReservation(harness.d1, 'expiring', now + 60_000);
    harness.r2.putSync(albumKey, new Uint8Array(10), 'application/octet-stream');

    const result = await Effect.runPromise(Effect.provide(mediaPurgeProgram, harness.layer));

    expect(result.reservationsExpired).toBe(0);
    expect(harness.r2.objects.has(albumKey)).toBe(true);
    expect(reservationState(harness.d1)).toBe('expiring');
  });

  it('purges a stale legacy pending upload, object first', async () => {
    const harness = makeTestHarness();
    seedUserSpace(harness.d1);
    const now = harness.clock.value();
    const key = insertLegacyAlbum(harness.d1, 'legacy-stale', {
      createdAt: now - MEDIA_STAGED_TTL_MS - 1,
    });
    harness.r2.putSync(key, new Uint8Array(10), 'application/octet-stream');

    const result = await Effect.runPromise(Effect.provide(mediaPurgeProgram, harness.layer));

    expect(result.albumStagedPurged).toBe(1);
    expect(harness.r2.objects.has(key)).toBe(false);
    expect(harness.d1.rawDb.prepare('select id from album_media').all()).toHaveLength(0);
  });

  it('keeps a stale legacy row when its object cannot be removed, and recovers next run', async () => {
    const harness = makeTestHarness();
    seedUserSpace(harness.d1);
    const now = harness.clock.value();
    const key = insertLegacyAlbum(harness.d1, 'legacy-stuck', {
      createdAt: now - MEDIA_STAGED_TTL_MS - 1,
    });
    harness.r2.putSync(key, new Uint8Array(10), 'application/octet-stream');

    const originalDelete = harness.r2.delete.bind(harness.r2);
    harness.r2.delete = async () => {
      throw new Error('r2 down');
    };
    const blocked = await Effect.runPromise(Effect.provide(mediaPurgeProgram, harness.layer));
    expect(blocked.albumStagedPurged).toBe(0);
    // The row is retained, so its bytes stay accounted for.
    expect(harness.d1.rawDb.prepare('select id from album_media').all()).toHaveLength(1);

    harness.r2.delete = originalDelete;
    const recovered = await Effect.runPromise(Effect.provide(mediaPurgeProgram, harness.layer));
    expect(recovered.albumStagedPurged).toBe(1);
    expect(harness.r2.objects.has(key)).toBe(false);
    expect(harness.d1.rawDb.prepare('select id from album_media').all()).toHaveLength(0);
  });

  it('reclaims a soft-deleted legacy row after the grace period', async () => {
    const harness = makeTestHarness();
    seedUserSpace(harness.d1);
    const now = harness.clock.value();
    const stale = now - MEDIA_SOFT_DELETE_PURGE_MS - 1;
    const key = insertLegacyAlbum(harness.d1, 'legacy-deleted', {
      state: 'complete',
      createdAt: stale,
      deletedAt: stale,
    });
    harness.r2.putSync(key, new Uint8Array(10), 'application/octet-stream');

    const result = await Effect.runPromise(Effect.provide(mediaPurgeProgram, harness.layer));

    expect(result.albumDeletedPurged).toBe(1);
    expect(harness.r2.objects.has(key)).toBe(false);
    expect(harness.d1.rawDb.prepare('select id from album_media').all()).toHaveLength(0);
  });

  it('sweeps an album object no row names, and leaves a named one alone', async () => {
    const harness = makeTestHarness();
    seedUserSpace(harness.d1);
    const now = harness.clock.value();
    const named = insertLegacyAlbum(harness.d1, 'legacy-named', {
      state: 'complete',
      createdAt: now,
    });
    harness.r2.putSync(named, new Uint8Array(10), 'application/octet-stream', new Date(0));
    const orphan = 'album/s1/orphan.bin';
    harness.r2.putSync(orphan, new Uint8Array(10), 'application/octet-stream', new Date(0));

    const result = await Effect.runPromise(Effect.provide(mediaPurgeProgram, harness.layer));

    expect(result.albumOrphansDeleted).toBe(1);
    expect(harness.r2.objects.has(orphan)).toBe(false);
    expect(harness.r2.objects.has(named)).toBe(true);
  });

  it('reclaims an object at a failed reservation key, so a late PUT cannot persist', async () => {
    const harness = makeTestHarness();
    seedUserSpace(harness.d1);
    const now = harness.clock.value();
    insertReservation(harness.d1, 'failed', now - 1);
    // The reservation released this key when it failed, so whatever is there now
    // is unaccounted — the sweep is the net that catches it.
    harness.r2.putSync(albumKey, new Uint8Array(10), 'application/octet-stream', new Date(0));

    const result = await Effect.runPromise(Effect.provide(mediaPurgeProgram, harness.layer));

    expect(result.albumOrphansDeleted).toBe(1);
    expect(harness.r2.objects.has(albumKey)).toBe(false);
  });
});
