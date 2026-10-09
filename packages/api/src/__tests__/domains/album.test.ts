import { describe, expect, it } from 'vitest';
import { Effect, Exit } from 'effect';

import { albumMediaRecordSchema, type SpaceBackup } from '@aoi/shared';

import { makeTestHarness, type ShimD1 } from '../../effects/test-harness';
import {
  albumMediaKey,
  completeAlbumUploadProgram,
  createAlbumUploadIntentProgram,
  deleteAlbumMediaProgram,
  getAlbumBackupProgram,
  listAlbumMediaProgram,
  putAlbumBackupProgram,
  serveAlbumObjectProgram,
} from '../../domains/album';
import {
  BadRequestError,
  ForbiddenError,
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
  it('head-verifies the object and transitions pending→complete with completed_at', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    const mediaId = '00000000-0000-4000-8000-0000000000a1';
    const key = insertAlbumMedia(ctx.harness.d1, mediaId, SPACE_1, USER_A);
    ctx.harness.r2.putSync(key, new Uint8Array([1, 2, 3, 4]), 'application/octet-stream');

    const result = await run(ctx.provide(completeAlbumUploadProgram(USER_A, mediaId)));
    expect(result).toEqual({ ok: true });

    const row = ctx.harness.d1.rawDb
      .prepare('select upload_state, completed_at from album_media where id = ?')
      .get(mediaId) as { upload_state: string; completed_at: number | null };
    expect(row.upload_state).toBe('complete');
    expect(row.completed_at).toBe(T0);
  });

  it('404s for unknown media and 403s for another user’s upload', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');

    const missing = await failureOf(
      ctx.provide(completeAlbumUploadProgram(USER_A, '00000000-0000-4000-8000-0000000000ff'))
    );
    expect(missing).toBeInstanceOf(NotFoundError);

    const key = insertAlbumMedia(ctx.harness.d1, '00000000-0000-4000-8000-0000000000a2', SPACE_1, USER_A);
    ctx.harness.r2.putSync(key, new Uint8Array([1]), 'application/octet-stream');
    const other = await failureOf(
      ctx.provide(completeAlbumUploadProgram(USER_B, '00000000-0000-4000-8000-0000000000a2'))
    );
    expect(other).toBeInstanceOf(ForbiddenError);
  });

  it('400s when the upload is already complete', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    const mediaId = '00000000-0000-4000-8000-0000000000a3';
    insertAlbumMedia(ctx.harness.d1, mediaId, SPACE_1, USER_A, { state: 'complete' });

    const err = await failureOf(ctx.provide(completeAlbumUploadProgram(USER_A, mediaId)));
    expect(err).toBeInstanceOf(BadRequestError);
  });

  it('marks the row failed and 400s on a head-verify size mismatch', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    const mediaId = '00000000-0000-4000-8000-0000000000a4';
    const key = insertAlbumMedia(ctx.harness.d1, mediaId, SPACE_1, USER_A, { byteLength: 8 });
    // Stored object is far larger than the declared reservation.
    ctx.harness.r2.putSync(key, new Uint8Array(64 * 1024), 'application/octet-stream');

    const err = await failureOf(ctx.provide(completeAlbumUploadProgram(USER_A, mediaId)));
    expect(err).toBeInstanceOf(BadRequestError);

    const row = ctx.harness.d1.rawDb
      .prepare('select upload_state from album_media where id = ?')
      .get(mediaId) as { upload_state: string };
    expect(row.upload_state).toBe('failed');
  });

  it('400s when the object never landed', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    const mediaId = '00000000-0000-4000-8000-0000000000a5';
    insertAlbumMedia(ctx.harness.d1, mediaId, SPACE_1, USER_A); // no R2 object

    const err = await failureOf(ctx.provide(completeAlbumUploadProgram(USER_A, mediaId)));
    expect(err).toBeInstanceOf(BadRequestError);
    const row = ctx.harness.d1.rawDb
      .prepare('select upload_state from album_media where id = ?')
      .get(mediaId) as { upload_state: string };
    expect(row.upload_state).toBe('failed');
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
