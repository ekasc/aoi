import { describe, expect, it } from 'vitest';
import { Effect, Exit } from 'effect';

import { albumMediaRecordSchema, type SpaceBackup } from '@aoi/shared';

import { makeTestHarness, type ShimD1 } from '../../effects/test-harness';
import {
  ALBUM_RESERVATION_MAX_LIFETIME_MS,
  ALBUM_RESERVATION_TTL_MS,
  albumMediaKey,
  completeAlbumUploadProgram,
  createAlbumUploadIntentProgram,
  deleteAlbumMediaProgram,
  finalizeAlbumMediaProgram,
  getAlbumBackupProgram,
  listAlbumMediaProgram,
  putAlbumBackupProgram,
  reserveAlbumMediaProgram,
  serveAlbumObjectProgram,
} from '../../domains/album';
import { mediaPurgeProgram } from '../../programs/cron';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  LimitExceededError,
  NotFoundError,
} from '../../domains/errors';

/**
 * Album domain — the E2EE shared library server side:
 * - intent → pending row + presigned direct PUT,
 * - complete → head-verify size + guarded pending→complete|failed,
 * - list → metadata only, complete non-deleted, newest first,
 * - object → sealed ciphertext, membership-gated,
 * - delete → soft tombstone (shared library, any member),
 * - backup → opaque space key envelopes round-trip.
 */

const USER_A = '00000000-0000-4000-8000-000000000001';
const USER_B = '00000000-0000-4000-8000-000000000002';
const USER_C = '00000000-0000-4000-8000-000000000003';
const SPACE_1 = '00000000-0000-4000-8000-000000000010';
const OTHER_SPACE = '00000000-0000-4000-8000-000000000020';
const T0 = Date.parse('2026-01-15T00:00:00.000Z');

const ALT = 'MDEyMzQ1Njc4OWFiY2RlZg==';

function validIntent(overrides: Record<string, unknown> = {}) {
  return {
    mimeType: 'image/jpeg',
    byteLength: 4096,
    sealedNonce: ALT,
    wrappedKey: { nonce: ALT, ciphertext: ALT },
    width: 1024,
    height: 768,
    personTag: 'you' as const,
    ...overrides,
  };
}

function insertUser(d1: ShimD1, id: string, email: string, name: string): void {
  d1.runSync(
    'insert into users (id, email, name, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?)',
    id,
    email,
    name,
    T0,
    T0
  );
}

function insertSpace(d1: ShimD1, id: string, creatorId: string): void {
  d1.runSync(
    `insert into spaces (id, name, partner_name, relationship_start_date, created_by_user_id, created_at, updated_at)
     values (?, 'Our Space', 'Partner', '2026-01-01', ?, ?, ?)`,
    id,
    creatorId,
    T0,
    T0
  );
  insertMember(d1, id, creatorId, 'you');
}

function insertMember(d1: ShimD1, spaceId: string, userId: string, role: 'you' | 'partner'): void {
  d1.runSync(
    `insert into space_members (space_id, user_id, role, state, joined_at) values (?, ?, ?, 'active', ?)`,
    spaceId,
    userId,
    role,
    T0
  );
}

function insertAlbumMedia(
  d1: ShimD1,
  id: string,
  spaceId: string,
  userId: string,
  opts?: {
    state?: 'pending' | 'complete' | 'failed';
    byteLength?: number;
    mimeType?: string;
    createdAt?: number;
    deletedAt?: number | null;
    width?: number | null;
    height?: number | null;
    personTag?: string | null;
  }
): string {
  const storageKey = albumMediaKey(spaceId, id);
  d1.runSync(
    `insert into album_media (id, space_id, created_by_user_id, mime_type, byte_length,
       width, height, person_tag, sealed_nonce, wrapped_key_nonce, wrapped_key_ciphertext,
       storage_key, upload_state, created_at, completed_at, deleted_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    spaceId,
    userId,
    opts?.mimeType ?? 'image/jpeg',
    opts?.byteLength ?? 4096,
    opts?.width ?? 1024,
    opts?.height ?? 768,
    opts?.personTag ?? 'you',
    ALT,
    ALT,
    ALT,
    storageKey,
    opts?.state ?? 'pending',
    opts?.createdAt ?? T0,
    opts?.state === 'complete' ? T0 : null,
    opts?.deletedAt ?? null
  );
  return storageKey;
}

function makeCtx() {
  const harness = makeTestHarness();
  return {
    harness,
    provide: <A, E, R>(program: Effect.Effect<A, E, R>) =>
      Effect.provide(program as Effect.Effect<A, E, never>, harness.layer as never) as Effect.Effect<A, E, never>,
  };
}

function run<A>(effect: Effect.Effect<A, unknown, never>): Promise<A> {
  return Effect.runPromise(effect as Effect.Effect<A, unknown, never>);
}

async function failureOf<A>(effect: Effect.Effect<A, unknown, never>): Promise<unknown> {
  const exit = await Effect.runPromise(Effect.exit(effect as Effect.Effect<A, unknown, never>));
  if (Exit.isSuccess(exit)) {
    throw new Error('expected program to fail, but it succeeded');
  }
  const cause = exit.cause as { _tag: string; error?: unknown };
  if (cause._tag === 'Fail' && cause.error !== undefined) {
    return cause.error;
  }
  throw new Error(`unexpected failure cause: ${cause._tag}`);
}

describe('createAlbumUploadIntentProgram', () => {
  it('inserts a pending row and returns a uuid mediaId + deterministic presigned PUT', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);

    const result = await run(ctx.provide(createAlbumUploadIntentProgram(USER_A, validIntent())));

    expect(result.mediaId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.expiresInSec).toBe(3600);
    expect(result.uploadUrl).toMatch(/^https:\/\//);
    expect(result.uploadUrl).toContain('X-Amz-Signature');
    expect(result.headers?.['Content-Type']).toBe('application/octet-stream');
    // A conditional create, and the condition is signed: dropping or altering
    // the header fails the request's signature rather than skipping the check.
    expect(result.headers?.['If-None-Match']).toBe('*');
    const signedHeaders = new URL(result.uploadUrl).searchParams.get('X-Amz-SignedHeaders') ?? '';
    expect(signedHeaders).toContain('if-none-match');
    // The exact-size contract stays signed.
    expect(signedHeaders).toContain('content-length');
    // Presigning must not invent a checksum for the empty body: the device
    // uploads real bytes, so an empty-body CRC32 could never match.
    const url = new URL(result.uploadUrl);
    expect(url.searchParams.get('x-amz-checksum-crc32')).toBeNull();
    expect(url.searchParams.get('x-amz-sdk-checksum-algorithm')).toBeNull();

    const expectedKey = albumMediaKey(SPACE_1, result.mediaId);
    const row = ctx.harness.d1.rawDb
      .prepare('select storage_key, upload_state, wrapped_key_nonce from album_media where id = ?')
      .get(result.mediaId) as { storage_key: string; upload_state: string; wrapped_key_nonce: string };
    expect(row.storage_key).toBe(expectedKey);
    expect(row.upload_state).toBe('pending');
    expect(row.wrapped_key_nonce).toBe(ALT);
  });

  it('rejects when the caller has no active space', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    const err = await failureOf(ctx.provide(createAlbumUploadIntentProgram(USER_A, validIntent())));
    expect(err).toBeInstanceOf(BadRequestError);
  });

  it('rejects an oversized byteLength', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    const err = await failureOf(
      ctx.provide(createAlbumUploadIntentProgram(USER_A, validIntent({ byteLength: 100 * 1024 * 1024 + 1 })))
    );
    expect(err).toBeInstanceOf(BadRequestError);
  });

  it('rejects a malformed wrappedKey', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    const err = await failureOf(
      ctx.provide(
        createAlbumUploadIntentProgram(USER_A, validIntent({ wrappedKey: { nonce: '', ciphertext: '' } }))
      )
    );
    expect(err).toBeInstanceOf(BadRequestError);
  });
});

describe('completeAlbumUploadProgram', () => {
  const idFor = (suffix: string) => `00000000-0000-4000-8000-0000000000${suffix}`;

  function setup(bytes: Uint8Array, declared?: number) {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    const mediaId = idFor('a1');
    const key = insertAlbumMedia(ctx.harness.d1, mediaId, SPACE_1, USER_A, {
      byteLength: declared ?? bytes.length,
    });
    if (bytes.length > 0) {
      ctx.harness.r2.putSync(key, bytes, 'application/octet-stream');
    }
    return { ctx, mediaId, key };
  }

  const rowFor = (ctx: ReturnType<typeof makeCtx>, mediaId: string) =>
    ctx.harness.d1.rawDb
      .prepare(
        'select upload_state, completed_at, completed_etag, completed_size from album_media where id = ?'
      )
      .get(mediaId) as {
      upload_state: string;
      completed_at: number | null;
      completed_etag: string | null;
      completed_size: number | null;
    };

  it('head-verifies the exact size and pins the object identity', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const { ctx, mediaId } = setup(bytes);

    expect(await run(ctx.provide(completeAlbumUploadProgram(USER_A, mediaId)))).toEqual({ ok: true });

    const row = rowFor(ctx, mediaId);
    expect(row.upload_state).toBe('complete');
    expect(row.completed_at).toBe(T0);
    // The pinned identity is what lets the serve path notice a replayed PUT.
    expect(row.completed_size).toBe(bytes.length);
    expect(row.completed_etag).toBeTruthy();
  });

  it('refuses a truncated object', async () => {
    // Four bytes reserved and one stored. This used to pass: the old check only
    // had an upper bound, so a short object looked like a complete upload.
    const { ctx, mediaId } = setup(new Uint8Array([1]), 4);

    const err = await failureOf(ctx.provide(completeAlbumUploadProgram(USER_A, mediaId)));
    expect(err).toBeInstanceOf(BadRequestError);
    expect(rowFor(ctx, mediaId).upload_state).toBe('failed');
  });

  it('refuses an oversized object', async () => {
    const { ctx, mediaId } = setup(new Uint8Array(64 * 1024), 8);

    const err = await failureOf(ctx.provide(completeAlbumUploadProgram(USER_A, mediaId)));
    expect(err).toBeInstanceOf(BadRequestError);
    expect(rowFor(ctx, mediaId).upload_state).toBe('failed');
  });

  it('refuses a missing object', async () => {
    const { ctx, mediaId } = setup(new Uint8Array(0));

    const err = await failureOf(ctx.provide(completeAlbumUploadProgram(USER_A, mediaId)));
    expect(err).toBeInstanceOf(BadRequestError);
    expect(rowFor(ctx, mediaId).upload_state).toBe('failed');
  });

  it('400s when the upload is already complete', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    const mediaId = idFor('a3');
    insertAlbumMedia(ctx.harness.d1, mediaId, SPACE_1, USER_A, { state: 'complete' });

    const err = await failureOf(ctx.provide(completeAlbumUploadProgram(USER_A, mediaId)));
    expect(err).toBeInstanceOf(BadRequestError);
  });

  it('404s for unknown media and 403s for another user\u2019s upload', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');

    const missing = await failureOf(
      ctx.provide(completeAlbumUploadProgram(USER_A, '00000000-0000-4000-8000-0000000000ff'))
    );
    expect(missing).toBeInstanceOf(NotFoundError);

    const key = insertAlbumMedia(ctx.harness.d1, idFor('a2'), SPACE_1, USER_A, { byteLength: 1 });
    ctx.harness.r2.putSync(key, new Uint8Array([1]), 'application/octet-stream');
    const other = await failureOf(ctx.provide(completeAlbumUploadProgram(USER_B, idFor('a2'))));
    expect(other).toBeInstanceOf(ForbiddenError);
  });

  it('refuses to finalise once the uploader has left the Space', async () => {
    const { ctx, mediaId } = setup(new Uint8Array([1, 2, 3, 4]));
    ctx.harness.d1.runSync(
      "update space_members set state = 'left' where space_id = ? and user_id = ?",
      SPACE_1,
      USER_A
    );

    const err = await failureOf(ctx.provide(completeAlbumUploadProgram(USER_A, mediaId)));
    expect(err).toBeInstanceOf(ForbiddenError);
    // Nothing was finalised, so the object cannot become archive media.
    expect(rowFor(ctx, mediaId).upload_state).toBe('pending');
  });

  it('refuses when membership is removed between the check and the write', async () => {
    const { ctx, mediaId } = setup(new Uint8Array([1, 2, 3, 4]));

    // The membership check happens before the storage read, so removing the
    // member from inside that read is exactly the window a concurrent removal
    // would land in. The condition on the write is what has to catch it.
    const realHead = ctx.harness.r2.head.bind(ctx.harness.r2);
    (ctx.harness.r2 as { head: typeof realHead }).head = async (key: string) => {
      ctx.harness.d1.runSync(
        "update space_members set state = 'left' where space_id = ? and user_id = ?",
        SPACE_1,
        USER_A
      );
      return realHead(key);
    };

    const err = await failureOf(ctx.provide(completeAlbumUploadProgram(USER_A, mediaId)));
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(rowFor(ctx, mediaId).upload_state).toBe('pending');
  });
});

describe('listAlbumMediaProgram', () => {
  it('returns only complete, non-deleted rows, newest first, matching the shared record', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);

    const oldest = '00000000-0000-4000-8000-0000000000b1';
    const newest = '00000000-0000-4000-8000-0000000000b2';
    insertAlbumMedia(ctx.harness.d1, oldest, SPACE_1, USER_A, { state: 'complete', createdAt: T0 });
    insertAlbumMedia(ctx.harness.d1, newest, SPACE_1, USER_A, { state: 'complete', createdAt: T0 + 1000 });
    insertAlbumMedia(ctx.harness.d1, '00000000-0000-4000-8000-0000000000b3', SPACE_1, USER_A, { state: 'pending' });
    insertAlbumMedia(ctx.harness.d1, '00000000-0000-4000-8000-0000000000b4', SPACE_1, USER_A, {
      state: 'complete',
      deletedAt: T0 + 2000,
    });

    const result = await run(ctx.provide(listAlbumMediaProgram(USER_A)));
    expect(result.media.map((m) => m.id)).toEqual([newest, oldest]);

    const record = albumMediaRecordSchema.parse(result.media[0]);
    expect(record).toMatchObject({
      id: newest,
      wrappedKey: { nonce: ALT, ciphertext: ALT },
      sealedNonce: ALT,
      byteLength: 4096,
      mimeType: 'image/jpeg',
      width: 1024,
      height: 768,
      personTag: 'you',
      createdByUserId: USER_A,
    });
    expect(record.createdAt).toBe(new Date(T0 + 1000).toISOString());
  });

  it('returns an empty list when the caller has no active space', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    const result = await run(ctx.provide(listAlbumMediaProgram(USER_A)));
    expect(result).toEqual({ media: [] });
  });
});

describe('serveAlbumObjectProgram', () => {
  it('refuses an object that was replaced after finalisation', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    const mediaId = '00000000-0000-4000-8000-0000000000c5';
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const key = insertAlbumMedia(ctx.harness.d1, mediaId, SPACE_1, USER_A, { byteLength: bytes.length });
    ctx.harness.r2.putSync(key, bytes, 'application/octet-stream');
    await run(ctx.provide(completeAlbumUploadProgram(USER_A, mediaId)));

    // A replayed presigned PUT: same length, different bytes. The pinned etag is
    // what turns that from a silent swap into a refusal.
    ctx.harness.r2.putSync(key, new Uint8Array([5, 6, 7, 8]), 'application/octet-stream');

    const err = await failureOf(ctx.provide(serveAlbumObjectProgram(USER_A, mediaId)));
    expect(err).toBeInstanceOf(ConflictError);
  });

  it('returns the sealed bytes for a member with privacy-safe headers', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');
    const mediaId = '00000000-0000-4000-8000-0000000000c1';
    const key = insertAlbumMedia(ctx.harness.d1, mediaId, SPACE_1, USER_A, { state: 'complete' });
    ctx.harness.r2.putSync(key, new Uint8Array([9, 8, 7]), 'application/octet-stream');

    const output = await run(ctx.provide(serveAlbumObjectProgram(USER_B, mediaId)));
    expect(output.status).toBe(200);
    expect(output.headers['Content-Type']).toBe('application/octet-stream');
    expect(output.headers['Cache-Control']).toBe('private, max-age=86400');
    expect(output.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(output.headers['Content-Length']).toBe('3');
    const body = new Uint8Array(await new Response(output.body).arrayBuffer());
    expect([...body]).toEqual([9, 8, 7]);
  });

  it('403s for a non-member', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_C, 'c@example.com', 'Carol');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    const mediaId = '00000000-0000-4000-8000-0000000000c2';
    insertAlbumMedia(ctx.harness.d1, mediaId, SPACE_1, USER_A, { state: 'complete' });

    const err = await failureOf(ctx.provide(serveAlbumObjectProgram(USER_C, mediaId)));
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it('404s for missing, deleted, and pending rows', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    const deleted = '00000000-0000-4000-8000-0000000000c3';
    const pending = '00000000-0000-4000-8000-0000000000c4';
    insertAlbumMedia(ctx.harness.d1, deleted, SPACE_1, USER_A, { state: 'complete', deletedAt: T0 });
    insertAlbumMedia(ctx.harness.d1, pending, SPACE_1, USER_A, { state: 'pending' });

    for (const id of [deleted, pending, '00000000-0000-4000-8000-0000000000ff']) {
      const err = await failureOf(ctx.provide(serveAlbumObjectProgram(USER_A, id)));
      expect(err).toBeInstanceOf(NotFoundError);
    }
  });
});

describe('deleteAlbumMediaProgram', () => {
  it('lets any active member soft-delete; the row disappears from the list', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');
    const mediaId = '00000000-0000-4000-8000-0000000000d1';
    const key = insertAlbumMedia(ctx.harness.d1, mediaId, SPACE_1, USER_A, { state: 'complete' });
    ctx.harness.r2.putSync(key, new Uint8Array([1]), 'application/octet-stream');

    const result = await run(ctx.provide(deleteAlbumMediaProgram(USER_B, mediaId)));
    expect(result).toEqual({ ok: true });

    const row = ctx.harness.d1.rawDb
      .prepare('select deleted_at from album_media where id = ?')
      .get(mediaId) as { deleted_at: number | null };
    expect(row.deleted_at).toBeTypeOf('number');
    expect(ctx.harness.r2.objects.has(key)).toBe(false);

    const list = await run(ctx.provide(listAlbumMediaProgram(USER_A)));
    expect(list.media).toHaveLength(0);
  });

  it('best-effort R2 delete: a storage failure still returns ok', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    const mediaId = '00000000-0000-4000-8000-0000000000d2';
    insertAlbumMedia(ctx.harness.d1, mediaId, SPACE_1, USER_A, { state: 'complete' });

    const originalDelete = ctx.harness.r2.delete.bind(ctx.harness.r2);
    ctx.harness.r2.delete = async () => {
      throw new Error('r2 down');
    };
    try {
      const result = await run(ctx.provide(deleteAlbumMediaProgram(USER_A, mediaId)));
      expect(result).toEqual({ ok: true });
    } finally {
      ctx.harness.r2.delete = originalDelete;
    }
  });
});

describe('album backup', () => {
  const backup: SpaceBackup = {
    identities: [
      { deviceId: 'device-a', signingPublicKey: 'spk', agreementPublicKey: 'apk', createdAt: '2026-01-15T00:00:00.000Z' },
    ],
    deviceKeys: [
      { deviceId: 'device-a', agreementPublicKey: 'apk', signature: 'sig', signedBy: 'device-a' },
    ],
    envelopes: [
      {
        deviceId: 'device-a',
        sealed: { nonce: ALT, ciphertext: ALT },
        authorisedBy: 'device-a',
        signature: 'sig',
        createdAt: '2026-01-15T00:00:00.000Z',
      },
    ],
  };

  it('GET returns the empty default when none exists', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    const result = await run(ctx.provide(getAlbumBackupProgram(USER_A)));
    expect(result).toEqual({ identities: [], deviceKeys: [], envelopes: [] });
  });

  it('PUT then GET round-trips the exact payload', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);

    const stored = await run(ctx.provide(putAlbumBackupProgram(USER_A, backup)));
    expect(stored).toEqual(backup);

    const read = await run(ctx.provide(getAlbumBackupProgram(USER_A)));
    expect(read).toEqual(backup);
  });

  it('merges a stale PUT instead of erasing the other device', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);

    await run(ctx.provide(putAlbumBackupProgram(USER_A, backup)));

    // A device that read an empty backup (or a stale one) and PUT only its
    // own entry. What device-a published must survive: a stale read is not a
    // delete, and losing the envelope would strand a replaced phone forever.
    const stalePut: SpaceBackup = {
      identities: [
        {
          deviceId: 'device-b',
          signingPublicKey: 'spk-b',
          agreementPublicKey: 'apk-b',
          createdAt: '2026-01-16T00:00:00.000Z',
        },
      ],
      deviceKeys: [],
      envelopes: [],
    };
    await run(ctx.provide(putAlbumBackupProgram(USER_A, stalePut)));

    const read = await run(ctx.provide(getAlbumBackupProgram(USER_A)));
    expect(read.identities.map((entry) => entry.deviceId).sort()).toEqual(['device-a', 'device-b']);
    expect(read.deviceKeys.map((entry) => entry.deviceId)).toEqual(['device-a']);
    expect(read.envelopes.map((entry) => entry.deviceId)).toEqual(['device-a']);
  });

  it('PUT rejects a malformed backup', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    const err = await failureOf(
      ctx.provide(
        putAlbumBackupProgram(USER_A, { identities: 'nope' } as unknown as SpaceBackup)
      )
    );
    expect(err).toBeInstanceOf(BadRequestError);
  });

  it('PUT requires an active space', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    const err = await failureOf(ctx.provide(putAlbumBackupProgram(USER_A, backup)));
    expect(err).toBeInstanceOf(BadRequestError);
  });
});

// ── Signed media: reserve → finalise ──────────────────────────────────────

const MEDIA_1 = '00000000-0000-4000-8000-000000000101';
const MEDIA_2 = '00000000-0000-4000-8000-000000000102';
const MIB = 1024 * 1024;

/** The reservation program reads device ownership straight from the record. */
function enrolDevice(d1: ShimD1, spaceId: string, deviceId: string, userId: string): void {
  d1.runSync(
    `insert into album_device_records (space_id, device_id, owner_user_id, revision, payload, updated_at)
     values (?, ?, ?, 1, '{}', ?)`,
    spaceId,
    deviceId,
    userId,
    T0
  );
}

function couple() {
  const ctx = makeCtx();
  insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
  insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
  insertSpace(ctx.harness.d1, SPACE_1, USER_A);
  insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');
  return ctx;
}

const reservation = (overrides: Record<string, unknown> = {}) => ({
  mediaId: MEDIA_1,
  generation: 1,
  uploaderDeviceId: 'device-a',
  byteLength: 3,
  ...overrides,
});

function seedSealed(ctx: ReturnType<typeof couple>, mediaId: string, size: number): void {
  ctx.harness.r2.putSync(
    albumMediaKey(SPACE_1, mediaId),
    new Uint8Array(size).fill(9),
    'application/octet-stream'
  );
}

function reservationState(ctx: ReturnType<typeof couple>): string {
  const row = ctx.harness.d1.rawDb
    .prepare('select state from album_media_reservations where media_id = ?')
    .get(MEDIA_1) as { state: string };
  return row.state;
}

describe('reserving signed media', () => {
  it('reserves, then finalises, an exact-size upload', async () => {
    const ctx = couple();
    enrolDevice(ctx.harness.d1, SPACE_1, 'device-a', USER_A);

    const reserved = await run(ctx.provide(reserveAlbumMediaProgram(USER_A, reservation())));
    expect(reserved.mediaId).toBe(MEDIA_1);
    expect(reserved.generation).toBe(1);
    expect(reserved.uploadUrl).toContain('X-Amz-Signature');
    expect(reserved.headers?.['If-None-Match']).toBe('*');

    seedSealed(ctx, MEDIA_1, 3);
    expect(await run(ctx.provide(finalizeAlbumMediaProgram(USER_A, MEDIA_1)))).toEqual({
      ok: true,
    });

    const row = ctx.harness.d1.rawDb
      .prepare('select state, completed_size from album_media_reservations where media_id = ?')
      .get(MEDIA_1) as { state: string; completed_size: number };
    expect(row.state).toBe('complete');
    expect(row.completed_size).toBe(3);
  });

  it('rejects a malformed id and an unsupported generation', async () => {
    const ctx = couple();
    enrolDevice(ctx.harness.d1, SPACE_1, 'device-a', USER_A);
    expect(
      await failureOf(
        ctx.provide(reserveAlbumMediaProgram(USER_A, reservation({ mediaId: 'media-1' })))
      )
    ).toBeInstanceOf(BadRequestError);
    expect(
      await failureOf(
        ctx.provide(reserveAlbumMediaProgram(USER_A, reservation({ generation: 2 })))
      )
    ).toBeInstanceOf(BadRequestError);
  });

  it('refuses a device the caller does not own, or one that is not registered', async () => {
    const ctx = couple();
    enrolDevice(ctx.harness.d1, SPACE_1, 'device-b', USER_B);
    expect(
      await failureOf(
        ctx.provide(reserveAlbumMediaProgram(USER_A, reservation({ uploaderDeviceId: 'device-b' })))
      )
    ).toBeInstanceOf(ForbiddenError);
    expect(
      await failureOf(
        ctx.provide(
          reserveAlbumMediaProgram(USER_A, reservation({ uploaderDeviceId: 'device-ghost' }))
        )
      )
    ).toBeInstanceOf(BadRequestError);
  });

  it('is retryable while pending, conflicts on a different request, and never re-authorises a used id', async () => {
    const ctx = couple();
    enrolDevice(ctx.harness.d1, SPACE_1, 'device-a', USER_A);
    await run(ctx.provide(reserveAlbumMediaProgram(USER_A, reservation())));
    // Identical retry: same id, another short-lived URL.
    expect(
      (await run(ctx.provide(reserveAlbumMediaProgram(USER_A, reservation())))).mediaId
    ).toBe(MEDIA_1);
    // A different request for the same id is a conflict, not an overwrite.
    expect(
      await failureOf(
        ctx.provide(reserveAlbumMediaProgram(USER_A, reservation({ byteLength: 4 })))
      )
    ).toBeInstanceOf(ConflictError);

    seedSealed(ctx, MEDIA_1, 3);
    await run(ctx.provide(finalizeAlbumMediaProgram(USER_A, MEDIA_1)));
    // Completed: never mint a fresh authorisation.
    expect(
      await failureOf(ctx.provide(reserveAlbumMediaProgram(USER_A, reservation())))
    ).toBeInstanceOf(ConflictError);
  });

  it('refuses an id a legacy album row already owns', async () => {
    const ctx = couple();
    enrolDevice(ctx.harness.d1, SPACE_1, 'device-a', USER_A);
    insertAlbumMedia(ctx.harness.d1, MEDIA_1, SPACE_1, USER_A);
    expect(
      await failureOf(ctx.provide(reserveAlbumMediaProgram(USER_A, reservation())))
    ).toBeInstanceOf(ConflictError);
  });

  it('never re-authorises an abandoned reservation', async () => {
    const ctx = couple();
    enrolDevice(ctx.harness.d1, SPACE_1, 'device-a', USER_A);
    await run(ctx.provide(reserveAlbumMediaProgram(USER_A, reservation())));
    ctx.harness.d1.runSync(
      `update album_media_reservations set state = 'failed' where space_id = ? and media_id = ?`,
      SPACE_1,
      MEDIA_1
    );
    // Same guard as the completed case: anything that is no longer `pending`
    // is refused rather than handed a fresh authorization.
    expect(
      await failureOf(ctx.provide(reserveAlbumMediaProgram(USER_A, reservation())))
    ).toBeInstanceOf(ConflictError);
  });

  it('draws on the same budget as ordinary media and the legacy album', async () => {
    const ctx = couple();
    enrolDevice(ctx.harness.d1, SPACE_1, 'device-a', USER_A);
    // A legacy album row at the Free ceiling leaves no room for a reservation.
    insertAlbumMedia(ctx.harness.d1, 'legacy-1', SPACE_1, USER_A, { byteLength: 250 * MIB });
    expect(
      await failureOf(
        ctx.provide(reserveAlbumMediaProgram(USER_A, reservation({ byteLength: MIB })))
      )
    ).toBeInstanceOf(LimitExceededError);
  });
});

describe('finalising signed media', () => {
  it('refuses a size that is not the reserved one, and releases the reservation', async () => {
    const ctx = couple();
    enrolDevice(ctx.harness.d1, SPACE_1, 'device-a', USER_A);
    await run(ctx.provide(reserveAlbumMediaProgram(USER_A, reservation({ byteLength: 3 }))));
    seedSealed(ctx, MEDIA_1, 4);
    expect(await failureOf(ctx.provide(finalizeAlbumMediaProgram(USER_A, MEDIA_1)))).toBeInstanceOf(
      BadRequestError
    );
    expect(reservationState(ctx)).toBe('failed');
    expect(ctx.harness.r2.objects.has(albumMediaKey(SPACE_1, MEDIA_1))).toBe(false);
  });

  it('leaves the reservation pending when nothing has been uploaded', async () => {
    const ctx = couple();
    enrolDevice(ctx.harness.d1, SPACE_1, 'device-a', USER_A);
    await run(ctx.provide(reserveAlbumMediaProgram(USER_A, reservation())));
    expect(await failureOf(ctx.provide(finalizeAlbumMediaProgram(USER_A, MEDIA_1)))).toBeInstanceOf(
      BadRequestError
    );
    expect(reservationState(ctx)).toBe('pending');
  });

  it('is idempotent, and refuses a caller who does not own the reservation', async () => {
    const ctx = couple();
    enrolDevice(ctx.harness.d1, SPACE_1, 'device-a', USER_A);
    await run(ctx.provide(reserveAlbumMediaProgram(USER_A, reservation())));
    seedSealed(ctx, MEDIA_1, 3);
    await run(ctx.provide(finalizeAlbumMediaProgram(USER_A, MEDIA_1)));
    expect(await run(ctx.provide(finalizeAlbumMediaProgram(USER_A, MEDIA_1)))).toEqual({
      ok: true,
    });
    expect(await failureOf(ctx.provide(finalizeAlbumMediaProgram(USER_B, MEDIA_1)))).toBeInstanceOf(
      ForbiddenError
    );
  });

  it('refuses a member who has been removed', async () => {
    const ctx = couple();
    enrolDevice(ctx.harness.d1, SPACE_1, 'device-a', USER_A);
    await run(ctx.provide(reserveAlbumMediaProgram(USER_A, reservation())));
    seedSealed(ctx, MEDIA_1, 3);
    ctx.harness.d1.runSync(
      `update space_members set state = 'left' where space_id = ? and user_id = ?`,
      SPACE_1,
      USER_A
    );
    // The caller has no active Space, so the scoped lookup finds nothing to
    // finalise — the same refusal as any other spaceless caller.
    expect(await failureOf(ctx.provide(finalizeAlbumMediaProgram(USER_A, MEDIA_1)))).toBeInstanceOf(
      BadRequestError
    );
  });
});

describe('signed media isolation and quota transitions', () => {
  it('cannot be reached by the legacy album delete', async () => {
    const ctx = couple();
    enrolDevice(ctx.harness.d1, SPACE_1, 'device-a', USER_A);
    await run(ctx.provide(reserveAlbumMediaProgram(USER_A, reservation())));
    seedSealed(ctx, MEDIA_1, 3);
    await run(ctx.provide(finalizeAlbumMediaProgram(USER_A, MEDIA_1)));

    // The legacy delete reads `album_media`, which signed media never touches.
    expect(await failureOf(ctx.provide(deleteAlbumMediaProgram(USER_A, MEDIA_1)))).toBeInstanceOf(
      NotFoundError
    );
    expect(ctx.harness.r2.objects.has(albumMediaKey(SPACE_1, MEDIA_1))).toBe(true);
  });

  it('refuses a second reservation once the first has spent the room', async () => {
    const ctx = couple();
    enrolDevice(ctx.harness.d1, SPACE_1, 'device-a', USER_A);
    insertAlbumMedia(ctx.harness.d1, 'legacy-1', SPACE_1, USER_A, { byteLength: 249 * MIB });
    await run(
      ctx.provide(reserveAlbumMediaProgram(USER_A, reservation({ mediaId: MEDIA_1, byteLength: MIB })))
    );
    expect(
      await failureOf(
        ctx.provide(
          reserveAlbumMediaProgram(USER_A, reservation({ mediaId: MEDIA_2, byteLength: MIB }))
        )
      )
    ).toBeInstanceOf(LimitExceededError);
  });

  it('lets a Free→Plus upgrade admit a reservation the Free limit refused', async () => {
    const ctx = couple();
    enrolDevice(ctx.harness.d1, SPACE_1, 'device-a', USER_A);
    insertAlbumMedia(ctx.harness.d1, 'legacy-1', SPACE_1, USER_A, { byteLength: 250 * MIB });
    expect(
      await failureOf(ctx.provide(reserveAlbumMediaProgram(USER_A, reservation({ byteLength: MIB }))))
    ).toBeInstanceOf(LimitExceededError);

    ctx.harness.d1.runSync(
      `insert into space_plus_entitlements
         (space_id, purchaser_user_id, provider, entitlement_id, product_id, expires_at,
          status, last_event_id, last_event_at_ms, created_at, updated_at)
       values (?, ?, 'revenuecat', 'plus', null, null, 'active', 'e1', ?, ?, ?)`,
      SPACE_1,
      USER_A,
      T0,
      T0,
      T0
    );
    const reserved = await run(
      ctx.provide(reserveAlbumMediaProgram(USER_A, reservation({ byteLength: MIB })))
    );
    expect(reserved.mediaId).toBe(MEDIA_1);
  });

  it('cannot be read through the legacy object route either', async () => {
    const ctx = couple();
    enrolDevice(ctx.harness.d1, SPACE_1, 'device-a', USER_A);
    await run(ctx.provide(reserveAlbumMediaProgram(USER_A, reservation())));
    seedSealed(ctx, MEDIA_1, 3);
    await run(ctx.provide(finalizeAlbumMediaProgram(USER_A, MEDIA_1)));

    expect(
      await failureOf(ctx.provide(serveAlbumObjectProgram(USER_A, MEDIA_1)))
    ).toBeInstanceOf(NotFoundError);
  });
});

describe('the cleanup and finalisation race', () => {
  it('refuses to finalise once cleanup has claimed the reservation', async () => {
    const ctx = couple();
    enrolDevice(ctx.harness.d1, SPACE_1, 'device-a', USER_A);
    await run(ctx.provide(reserveAlbumMediaProgram(USER_A, reservation())));
    seedSealed(ctx, MEDIA_1, 3);

    // The sweep's claim. Whoever moves the row first owns it, so the old
    // interleaving — finalise, then delete the just-finalised object — cannot
    // happen: finalisation now finds `expiring`, not `pending`, and does
    // nothing. (The claim cannot even be expressed before the fix, because the
    // state did not exist.)
    ctx.harness.d1.runSync(
      `update album_media_reservations set state = 'expiring' where space_id = ? and media_id = ?`,
      SPACE_1,
      MEDIA_1
    );

    expect(await failureOf(ctx.provide(finalizeAlbumMediaProgram(USER_A, MEDIA_1)))).toBeInstanceOf(
      BadRequestError
    );
    // It did not sneak through: the row is still cleanup's.
    expect(reservationState(ctx)).toBe('expiring');
  });

  it('never reclaims a completed reservation, even past its expiry', async () => {
    const ctx = couple();
    enrolDevice(ctx.harness.d1, SPACE_1, 'device-a', USER_A);
    await run(ctx.provide(reserveAlbumMediaProgram(USER_A, reservation())));
    seedSealed(ctx, MEDIA_1, 3);
    await run(ctx.provide(finalizeAlbumMediaProgram(USER_A, MEDIA_1)));

    // Completed is not a cleanup candidate, so its object survives an expiry
    // that would otherwise make it eligible.
    ctx.harness.d1.runSync(
      `update album_media_reservations set expires_at = 0 where space_id = ? and media_id = ?`,
      SPACE_1,
      MEDIA_1
    );
    await run(Effect.provide(mediaPurgeProgram, ctx.harness.layer));

    expect(reservationState(ctx)).toBe('complete');
    expect(ctx.harness.r2.objects.has(albumMediaKey(SPACE_1, MEDIA_1))).toBe(true);
  });

  it('retries a reservation a previous sweep claimed but could not finish', async () => {
    const ctx = couple();
    enrolDevice(ctx.harness.d1, SPACE_1, 'device-a', USER_A);
    await run(ctx.provide(reserveAlbumMediaProgram(USER_A, reservation())));
    seedSealed(ctx, MEDIA_1, 3);
    ctx.harness.d1.runSync(
      `update album_media_reservations set state = 'expiring', expires_at = 0
        where space_id = ? and media_id = ?`,
      SPACE_1,
      MEDIA_1
    );

    await run(Effect.provide(mediaPurgeProgram, ctx.harness.layer));

    expect(reservationState(ctx)).toBe('failed');
    expect(ctx.harness.r2.objects.has(albumMediaKey(SPACE_1, MEDIA_1))).toBe(false);
  });

  it('never destroys an object that finalisation completed during the sweep', async () => {
    const ctx = couple();
    enrolDevice(ctx.harness.d1, SPACE_1, 'device-a', USER_A);
    const t0 = ctx.harness.clock.value();
    await run(ctx.provide(reserveAlbumMediaProgram(USER_A, reservation())));
    seedSealed(ctx, MEDIA_1, 3);
    // Expired, so the sweep is entitled to reclaim it.
    ctx.harness.clock.set(t0 + 24 * 60 * 60 * 1000);

    // The interleaving, made deterministic: finalisation lands exactly between
    // the sweep's read and its storage delete. The storage seam is the pause.
    const originalDelete = ctx.harness.r2.delete.bind(ctx.harness.r2);
    ctx.harness.r2.delete = async (key: string) => {
      await run(ctx.provide(finalizeAlbumMediaProgram(USER_A, MEDIA_1))).catch(() => undefined);
      return originalDelete(key);
    };

    await run(Effect.provide(mediaPurgeProgram, ctx.harness.layer));

    // The invariant the old ordering broke: a `complete` record pointing at
    // destroyed ciphertext. The claim makes the row cleanup's before the delete,
    // so finalisation cannot complete it — it lands on `failed` instead. On the
    // pre-fix code this row reads `complete` with no object, and this test fails.
    const row = ctx.harness.d1.rawDb
      .prepare('select state from album_media_reservations where media_id = ?')
      .get(MEDIA_1) as { state: string };
    expect(row.state).toBe('failed');
    expect(ctx.harness.r2.objects.has(albumMediaKey(SPACE_1, MEDIA_1))).toBe(false);
  });
});

describe('reservation expiry and retries', () => {
  it('extends a retried reservation so a fresh URL never outlives it', async () => {
    const ctx = couple();
    enrolDevice(ctx.harness.d1, SPACE_1, 'device-a', USER_A);
    const t0 = ctx.harness.clock.value();
    await run(ctx.provide(reserveAlbumMediaProgram(USER_A, reservation())));

    // A retry near the original expiry issues a fresh URL, so the reservation
    // has to move with it — otherwise the URL could authorize an upload after
    // cleanup had already reclaimed the object.
    const nearExpiry = t0 + ALBUM_RESERVATION_TTL_MS - 60_000;
    ctx.harness.clock.set(nearExpiry);
    await run(ctx.provide(reserveAlbumMediaProgram(USER_A, reservation())));

    const row = ctx.harness.d1.rawDb
      .prepare('select expires_at from album_media_reservations where media_id = ?')
      .get(MEDIA_1) as { expires_at: number };
    expect(row.expires_at).toBe(nearExpiry + ALBUM_RESERVATION_TTL_MS);

    // The object is safe past the ORIGINAL expiry, because eligibility follows
    // the extended value.
    ctx.harness.clock.set(t0 + ALBUM_RESERVATION_TTL_MS + 1);
    seedSealed(ctx, MEDIA_1, 3);
    await run(Effect.provide(mediaPurgeProgram, ctx.harness.layer));
    expect(ctx.harness.r2.objects.has(albumMediaKey(SPACE_1, MEDIA_1))).toBe(true);
  });

  it('bounds how far retries can extend a reservation', async () => {
    const ctx = couple();
    enrolDevice(ctx.harness.d1, SPACE_1, 'device-a', USER_A);
    const t0 = ctx.harness.clock.value();
    await run(ctx.provide(reserveAlbumMediaProgram(USER_A, reservation())));

    // Retry past the hard bound: the expiry stops at created + MAX rather than
    // following the fresh URL, so an authorization cannot be renewed forever.
    ctx.harness.clock.set(t0 + ALBUM_RESERVATION_MAX_LIFETIME_MS + 60_000);
    await run(ctx.provide(reserveAlbumMediaProgram(USER_A, reservation())));

    const row = ctx.harness.d1.rawDb
      .prepare('select expires_at from album_media_reservations where media_id = ?')
      .get(MEDIA_1) as { expires_at: number };
    expect(row.expires_at).toBe(t0 + ALBUM_RESERVATION_MAX_LIFETIME_MS);

    seedSealed(ctx, MEDIA_1, 3);
    await run(Effect.provide(mediaPurgeProgram, ctx.harness.layer));
    expect(ctx.harness.r2.objects.has(albumMediaKey(SPACE_1, MEDIA_1))).toBe(false);
    expect(reservationState(ctx)).toBe('failed');
  });

  it('refuses to finalise an expired reservation', async () => {
    const ctx = couple();
    enrolDevice(ctx.harness.d1, SPACE_1, 'device-a', USER_A);
    const t0 = ctx.harness.clock.value();
    await run(ctx.provide(reserveAlbumMediaProgram(USER_A, reservation())));
    seedSealed(ctx, MEDIA_1, 3);
    ctx.harness.clock.set(t0 + ALBUM_RESERVATION_TTL_MS + 1);

    expect(await failureOf(ctx.provide(finalizeAlbumMediaProgram(USER_A, MEDIA_1)))).toBeInstanceOf(
      BadRequestError
    );
    expect(reservationState(ctx)).toBe('pending');
  });
});

describe('the legacy album shares the one budget', () => {
  it('blocks a signed upload once the legacy album has spent the room', async () => {
    const ctx = couple();
    enrolDevice(ctx.harness.d1, SPACE_1, 'device-a', USER_A);
    insertAlbumMedia(ctx.harness.d1, 'legacy-1', SPACE_1, USER_A, { byteLength: 250 * MIB });
    expect(
      await failureOf(
        ctx.provide(reserveAlbumMediaProgram(USER_A, reservation({ byteLength: MIB })))
      )
    ).toBeInstanceOf(LimitExceededError);
  });

  it('blocks a legacy upload once signed media has spent the room', async () => {
    const ctx = couple();
    enrolDevice(ctx.harness.d1, SPACE_1, 'device-a', USER_A);
    // One reservation is capped at 100 MiB, so the 250 MiB Free budget is spent
    // across three ids.
    for (const [index, mebibytes] of [99, 99, 52].entries()) {
      await run(
        ctx.provide(
          reserveAlbumMediaProgram(USER_A, {
            mediaId: `00000000-0000-4000-8000-00000000020${index}`,
            generation: 1,
            uploaderDeviceId: 'device-a',
            byteLength: mebibytes * MIB,
          })
        )
      );
    }
    expect(
      await failureOf(
        ctx.provide(createAlbumUploadIntentProgram(USER_A, validIntent({ byteLength: MIB })))
      )
    ).toBeInstanceOf(LimitExceededError);
  });

  it('fails when ordinary media has spent the room', async () => {
    const ctx = couple();
    ctx.harness.d1.runSync(
      `insert into media_objects
         (id, space_id, created_by_user_id, filename, mime_type, size_bytes, storage_key, upload_state, created_at)
       values ('m-1', ?, ?, 'a.jpg', 'image/jpeg', ?, 'media/m-1/original.jpg', 'pending', ?)`,
      SPACE_1,
      USER_A,
      250 * MIB,
      T0
    );
    expect(
      await failureOf(
        ctx.provide(createAlbumUploadIntentProgram(USER_A, validIntent({ byteLength: MIB })))
      )
    ).toBeInstanceOf(LimitExceededError);
  });

  it('lets two paths compete for the last bytes, and only one wins', async () => {
    const ctx = couple();
    enrolDevice(ctx.harness.d1, SPACE_1, 'device-a', USER_A);
    insertAlbumMedia(ctx.harness.d1, 'legacy-1', SPACE_1, USER_A, { byteLength: 249 * MIB });
    await run(ctx.provide(reserveAlbumMediaProgram(USER_A, reservation({ byteLength: MIB }))));
    expect(
      await failureOf(
        ctx.provide(createAlbumUploadIntentProgram(USER_A, validIntent({ byteLength: MIB })))
      )
    ).toBeInstanceOf(LimitExceededError);
  });

  it('keeps quota held while a failed legacy upload still has its object', async () => {
    const ctx = couple();
    // The object does not match the reservation, so completion wants to mark it
    // failed — but `failed` releases quota, so the object must go first.
    const key = insertAlbumMedia(ctx.harness.d1, 'legacy-1', SPACE_1, USER_A, { byteLength: 3 });
    ctx.harness.r2.putSync(key, new Uint8Array(4).fill(9), 'application/octet-stream');
    ctx.harness.r2.delete = async () => {
      throw new Error('r2 down');
    };

    expect(
      await failureOf(ctx.provide(completeAlbumUploadProgram(USER_A, 'legacy-1')))
    ).toBeInstanceOf(BadRequestError);

    const row = ctx.harness.d1.rawDb
      .prepare('select upload_state from album_media where id = ?')
      .get('legacy-1') as { upload_state: string };
    // Still pending, so the mismatched object stays counted.
    expect(row.upload_state).toBe('pending');
  });
});

describe('finalisation is scoped to the active Space', () => {
  it('does not finalise the same media id reserved in another Space', async () => {
    const ctx = couple();
    enrolDevice(ctx.harness.d1, SPACE_1, 'device-a', USER_A);

    // A second Space, whose member reserves the SAME uuid.
    insertUser(ctx.harness.d1, USER_C, 'c@example.com', 'Cara');
    insertSpace(ctx.harness.d1, OTHER_SPACE, USER_C);
    enrolDevice(ctx.harness.d1, OTHER_SPACE, 'device-c', USER_C);
    await run(
      ctx.provide(
        reserveAlbumMediaProgram(USER_C, {
          mediaId: MEDIA_1,
          generation: 1,
          uploaderDeviceId: 'device-c',
          byteLength: 3,
        })
      )
    );

    await run(ctx.provide(reserveAlbumMediaProgram(USER_A, reservation())));
    seedSealed(ctx, MEDIA_1, 3);
    await run(ctx.provide(finalizeAlbumMediaProgram(USER_A, MEDIA_1)));

    const stateIn = (spaceId: string) =>
      (
        ctx.harness.d1.rawDb
          .prepare('select state from album_media_reservations where space_id = ? and media_id = ?')
          .get(spaceId, MEDIA_1) as { state: string }
      ).state;
    expect(stateIn(SPACE_1)).toBe('complete');
    expect(stateIn(OTHER_SPACE)).toBe('pending');
  });
});
