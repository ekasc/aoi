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
    harness2.r2.list = async () => {
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
