import { describe, expect, it } from 'vitest';
import { Effect, Exit } from 'effect';

import { makeTestHarness, type ShimD1 } from '../../effects/test-harness';
import {
  completeUploadProgram,
  createUploadIntentProgram,
  mediaDisplayKey,
  mediaOriginalKey,
  mediaThumbKey,
  parseRangeHeader,
  serveMediaProgram,
} from '../../domains/media';
import { sanitizeMediaJob } from '../../services/media-processing';
import { BadRequestError, ForbiddenError, LimitExceededError, NotFoundError } from '../../domains/errors';

/**
 * Media domain — the private R2 pipeline:
 * - upload intent → presigned PUT with deterministic stable keys,
 * - complete → head-verify + guarded pending→complete|failed transition,
 * - sanitize (queue job) → magic-byte check, EXIF-stripping re-encode,
 *   display/thumb variants, guarded idempotent completion,
 * - serve → membership gate, variant resolution, range support.
 */

const USER_A = '00000000-0000-4000-8000-000000000001';
const USER_B = '00000000-0000-4000-8000-000000000002';
const USER_C = '00000000-0000-4000-8000-000000000003';
const SPACE_1 = '00000000-0000-4000-8000-000000000010';
const T0 = Date.parse('2026-01-15T00:00:00.000Z');

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

function insertMedia(
  d1: ShimD1,
  id: string,
  spaceId: string,
  userId: string,
  opts?: {
    mimeType?: string;
    sizeBytes?: number;
    state?: 'pending' | 'complete' | 'failed';
    contentHash?: string | null;
    variantKeys?: string | null;
  }
): string {
  const mimeType = opts?.mimeType ?? 'image/jpeg';
  const storageKey = mediaOriginalKey(id, mimeType);
  d1.runSync(
    `insert into media_objects (id, space_id, created_by_user_id, filename, mime_type,
       size_bytes, storage_key, upload_state, content_hash, variant_keys, processing_attempts, created_at)
     values (?, ?, ?, 'photo.jpg', ?, ?, ?, ?, ?, ?, 0, ?)`,
    id,
    spaceId,
    userId,
    mimeType,
    opts?.sizeBytes ?? 1000,
    storageKey,
    opts?.state ?? 'pending',
    opts?.contentHash ?? null,
    opts?.variantKeys ?? null,
    T0
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

describe('createUploadIntentProgram', () => {
  it('creates a pending row with a deterministic stable key and a presigned PUT', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);

    const result = await run(
      ctx.provide(
        createUploadIntentProgram(USER_A, {
          filename: 'selfie.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 1024,
          kind: 'image',
        })
      )
    );

    expect(result.mediaId).toBeTruthy();
    expect(result.expiresInSec).toBe(3600);
    expect(result.uploadUrl).toMatch(/^https:\/\//);
    expect(result.uploadUrl).toContain('X-Amz-Signature');
    expect(result.headers?.['Content-Type']).toBe('image/jpeg');

    // Deterministic key: derived from the media id, not a random uuid.
    const expectedKey = mediaOriginalKey(result.mediaId, 'image/jpeg');
    const row = ctx.harness.d1.rawDb
      .prepare('select storage_key, upload_state from media_objects where id = ?')
      .get(result.mediaId) as { storage_key: string; upload_state: string };
    expect(row.storage_key).toBe(expectedKey);
    expect(row.upload_state).toBe('pending');
    // No job enqueued at intent time (sanitize waits for `complete`).
    expect(ctx.harness.capturedQueue).toHaveLength(0);
  });

  it('rejects a kind/mime mismatch and a size over the cap', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);

    const mismatch = await failureOf(
      ctx.provide(
        createUploadIntentProgram(USER_A, { filename: 'x', mimeType: 'image/jpeg', sizeBytes: 10, kind: 'audio' })
      )
    );
    expect(mismatch).toBeInstanceOf(BadRequestError);

    const tooBig = await failureOf(
      ctx.provide(
        createUploadIntentProgram(USER_A, { filename: 'x', mimeType: 'image/jpeg', sizeBytes: 100 * 1024 * 1024 + 1, kind: 'image' })
      )
    );
    expect(tooBig).toBeInstanceOf(BadRequestError);
  });

  it('requires an active space', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    const err = await failureOf(
      ctx.provide(createUploadIntentProgram(USER_A, { filename: 'x', mimeType: 'image/jpeg', sizeBytes: 10, kind: 'image' }))
    );
    expect(err).toBeInstanceOf(BadRequestError);
  });
});

describe('completeUploadProgram', () => {
  it('404s for unknown media and 403s for another users upload', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');

    const missing = await failureOf(ctx.provide(completeUploadProgram(USER_A, '00000000-0000-4000-8000-0000000000ff')));
    expect(missing).toBeInstanceOf(NotFoundError);

    const key = insertMedia(ctx.harness.d1, '00000000-0000-4000-8000-0000000000f1', SPACE_1, USER_A);
    ctx.harness.r2.putSync(key, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg');
    const other = await failureOf(ctx.provide(completeUploadProgram(USER_B, '00000000-0000-4000-8000-0000000000f1')));
    expect(other).toBeInstanceOf(ForbiddenError);
  });

  it('head-verifies the uploaded object, transitions pending→complete, and enqueues media.sanitize', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    const mediaId = '00000000-0000-4000-8000-0000000000f2';
    const key = insertMedia(ctx.harness.d1, mediaId, SPACE_1, USER_A, { sizeBytes: 100 });
    ctx.harness.r2.putSync(key, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg');

    const result = await run(ctx.provide(completeUploadProgram(USER_A, mediaId)));
    expect(result).toEqual({ ok: true });

    const row = ctx.harness.d1.rawDb.prepare('select upload_state from media_objects where id = ?').get(mediaId) as { upload_state: string };
    expect(row.upload_state).toBe('complete');
    expect(ctx.harness.capturedQueue).toEqual([{ type: 'media.sanitize', mediaId }]);
  });

  it('marks the row failed and 400s when the content type lies', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    const mediaId = '00000000-0000-4000-8000-0000000000f3';
    const key = insertMedia(ctx.harness.d1, mediaId, SPACE_1, USER_A, { mimeType: 'image/jpeg' });
    // Object stored with a DIFFERENT content type than declared.
    ctx.harness.r2.putSync(key, new Uint8Array([0x89, 0x50]), 'image/png');

    const err = await failureOf(ctx.provide(completeUploadProgram(USER_A, mediaId)));
    expect(err).toBeInstanceOf(BadRequestError);

    const row = ctx.harness.d1.rawDb.prepare('select upload_state from media_objects where id = ?').get(mediaId) as { upload_state: string };
    expect(row.upload_state).toBe('failed');
    expect(ctx.harness.capturedQueue).toHaveLength(0);
  });

  it('400s when the object never landed', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    const mediaId = '00000000-0000-4000-8000-0000000000f4';
    insertMedia(ctx.harness.d1, mediaId, SPACE_1, USER_A); // no R2 object

    const err = await failureOf(ctx.provide(completeUploadProgram(USER_A, mediaId)));
    expect(err).toBeInstanceOf(BadRequestError);
    const row = ctx.harness.d1.rawDb.prepare('select upload_state from media_objects where id = ?').get(mediaId) as { upload_state: string };
    expect(row.upload_state).toBe('failed');
  });

  it('is idempotent: completing twice is a 400 with a single sanitize enqueue', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    const mediaId = '00000000-0000-4000-8000-0000000000f5';
    const key = insertMedia(ctx.harness.d1, mediaId, SPACE_1, USER_A);
    ctx.harness.r2.putSync(key, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg');

    await run(ctx.provide(completeUploadProgram(USER_A, mediaId)));
    const second = await failureOf(ctx.provide(completeUploadProgram(USER_A, mediaId)));
    expect(second).toBeInstanceOf(BadRequestError);
    expect(ctx.harness.capturedQueue).toHaveLength(1);
  });
});

describe('sanitizeMediaJob (EXIF privacy + variants)', () => {
  it('re-encodes an EXIF-carrying JPEG to clean WebP display/thumb variants', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    const mediaId = '00000000-0000-4000-8000-0000000000s1';
    const key = insertMedia(ctx.harness.d1, mediaId, SPACE_1, USER_A, { state: 'complete' });

    // Build an EXIF-carrying JPEG (the whole EXIF segment is dropped on
    // re-encode — GPS data lives in that segment).
    const { default: sharp } = await import('sharp');
    const source = await sharp({
      create: { width: 320, height: 240, channels: 3, background: { r: 120, g: 200, b: 90 } },
    })
      .jpeg({ quality: 90 })
      .withMetadata({
        exif: {
          IFD0: { Copyright: 'Aoi test', Software: 'aoi-test' },
        },
      })
      .toBuffer();
    ctx.harness.r2.putSync(key, new Uint8Array(source), 'image/jpeg');

    await run(ctx.provide(sanitizeMediaJob(mediaId)));

    // Variants exist at deterministic keys; the original is untouched.
    const displayKey = mediaDisplayKey(mediaId);
    const thumbKey = mediaThumbKey(mediaId);
    expect(ctx.harness.r2.objects.has(displayKey)).toBe(true);
    expect(ctx.harness.r2.objects.has(thumbKey)).toBe(true);
    expect(ctx.harness.r2.objects.has(key)).toBe(true);

    // Row: content hash + variant keys + completed.
    const row = ctx.harness.d1.rawDb
      .prepare('select content_hash, variant_keys, upload_state, processing_attempts from media_objects where id = ?')
      .get(mediaId) as { content_hash: string; variant_keys: string; upload_state: string; processing_attempts: number };
    expect(row.upload_state).toBe('complete');
    expect(row.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(row.variant_keys)).toEqual({ display: displayKey, thumb: thumbKey });
    expect(row.processing_attempts).toBe(1);

    // The display variant is WebP with NO EXIF/GPS metadata.
    const displayBytes = ctx.harness.r2.objects.get(displayKey)!.bytes;
    const displayMeta = await sharp(displayBytes).metadata();
    expect(displayMeta.format).toBe('webp');
    expect(displayMeta.exif).toBeUndefined();

    const thumbBytes = ctx.harness.r2.objects.get(thumbKey)!.bytes;
    const thumbMeta = await sharp(thumbBytes).metadata();
    expect(thumbMeta.format).toBe('webp');
    expect(thumbMeta.width).toBeLessThanOrEqual(512);
    expect(thumbMeta.height).toBeLessThanOrEqual(512);
  });

  it('is a guarded no-op on re-delivery (idempotent)', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    const mediaId = '00000000-0000-4000-8000-0000000000s2';
    const key = insertMedia(ctx.harness.d1, mediaId, SPACE_1, USER_A, { state: 'complete' });
    const { default: sharp } = await import('sharp');
    const source = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toBuffer();
    ctx.harness.r2.putSync(key, new Uint8Array(source), 'image/jpeg');

    await run(ctx.provide(sanitizeMediaJob(mediaId)));
    await run(ctx.provide(sanitizeMediaJob(mediaId))); // re-delivery

    const row = ctx.harness.d1.rawDb
      .prepare('select processing_attempts from media_objects where id = ?')
      .get(mediaId) as { processing_attempts: number };
    expect(row.processing_attempts).toBe(1);
    // Exactly one variant set (second delivery overwrote nothing).
    expect(ctx.harness.r2.puts.filter((p) => p.key === mediaDisplayKey(mediaId))).toHaveLength(1);
  });

  it('skips rows that are not complete (pending/failed) — nothing to sanitize', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    const pendingId = '00000000-0000-4000-8000-0000000000s3';
    const pendingKey = insertMedia(ctx.harness.d1, pendingId, SPACE_1, USER_A, { state: 'pending' });
    ctx.harness.r2.putSync(pendingKey, new Uint8Array([0xff]), 'image/jpeg');

    await run(ctx.provide(sanitizeMediaJob(pendingId)));
    expect(ctx.harness.r2.objects.has(mediaDisplayKey(pendingId))).toBe(false);
  });

  it('marks the row failed on magic-byte mismatch (renamed payload)', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    const mediaId = '00000000-0000-4000-8000-0000000000s4';
    const key = insertMedia(ctx.harness.d1, mediaId, SPACE_1, USER_A, { state: 'complete', mimeType: 'image/jpeg' });
    // PNG bytes declared as JPEG.
    const { default: sharp } = await import('sharp');
    const source = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer();
    ctx.harness.r2.putSync(key, new Uint8Array(source), 'image/jpeg');

    await run(ctx.provide(sanitizeMediaJob(mediaId)));

    const row = ctx.harness.d1.rawDb.prepare('select upload_state from media_objects where id = ?').get(mediaId) as { upload_state: string };
    expect(row.upload_state).toBe('failed');
  });

  it('verifies audio pass-through (magic bytes + hash, no re-encode)', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    const mediaId = '00000000-0000-4000-8000-0000000000s5';
    const key = insertMedia(ctx.harness.d1, mediaId, SPACE_1, USER_A, { state: 'complete', mimeType: 'audio/m4a' });
    // Minimal MP4/M4A container header (ftyp) — file-type detects audio/mp4.
    const header = new Uint8Array([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 0x00, 0x00, 0x00, 0x00,
      0x4d, 0x34, 0x41, 0x20, 0x00, 0x00, 0x00, 0x00,
    ]);
    ctx.harness.r2.putSync(key, header, 'audio/m4a');

    await run(ctx.provide(sanitizeMediaJob(mediaId)));

    const row = ctx.harness.d1.rawDb
      .prepare('select upload_state, content_hash, variant_keys from media_objects where id = ?')
      .get(mediaId) as { upload_state: string; content_hash: string | null; variant_keys: string | null };
    expect(row.upload_state).toBe('complete');
    expect(row.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.variant_keys).toBeNull();
  });

  it('terminally fails after bounded attempts when sharp cannot decode', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    const mediaId = '00000000-0000-4000-8000-0000000000s6';
    const key = insertMedia(ctx.harness.d1, mediaId, SPACE_1, USER_A, { state: 'complete', mimeType: 'image/heic' });
    // Declared HEIC but actually garbage → magicMatches() allows heic (no
    // magic detection), then sharp fails to decode → retry → terminal.
    ctx.harness.r2.putSync(key, new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]), 'image/heic');

    // Attempts 1 and 2 fail (retryable — the job fails, queue retries);
    // attempt 3 marks the row failed terminally.
    const attempt = (program: Effect.Effect<unknown, unknown, never>) =>
      Effect.runPromise(Effect.exit(program));
    await attempt(ctx.provide(sanitizeMediaJob(mediaId)));
    await attempt(ctx.provide(sanitizeMediaJob(mediaId)));
    const third = await attempt(ctx.provide(sanitizeMediaJob(mediaId)));
    expect(Exit.isSuccess(third)).toBe(true);

    const row = ctx.harness.d1.rawDb
      .prepare('select upload_state, processing_attempts from media_objects where id = ?')
      .get(mediaId) as { upload_state: string; processing_attempts: number };
    expect(row.upload_state).toBe('failed');
    expect(row.processing_attempts).toBe(3);
  });
});

describe('serveMediaProgram', () => {
  it('404s for unknown media and 403s for non-members', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_C, 'c@example.com', 'Carol');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    const mediaId = '00000000-0000-4000-8000-0000000000v1';
    insertMedia(ctx.harness.d1, mediaId, SPACE_1, USER_A, { state: 'complete' });

    const missing = await failureOf(ctx.provide(serveMediaProgram(USER_A, '00000000-0000-4000-8000-0000000000ff', 'display', null)));
    expect(missing).toBeInstanceOf(NotFoundError);

    const outsider = await failureOf(ctx.provide(serveMediaProgram(USER_C, mediaId, 'display', null)));
    expect(outsider).toBeInstanceOf(ForbiddenError);
  });

  it('serves the display variant with nosniff and privacy-safe headers', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');
    const mediaId = '00000000-0000-4000-8000-0000000000v2';
    const displayKey = mediaDisplayKey(mediaId);
    const thumbKey = mediaThumbKey(mediaId);
    const originalKey = insertMedia(ctx.harness.d1, mediaId, SPACE_1, USER_A, {
      state: 'complete',
      variantKeys: JSON.stringify({ display: displayKey, thumb: thumbKey }),
    });
    ctx.harness.r2.putSync(originalKey, new Uint8Array([0xde, 0xad]), 'image/jpeg');
    ctx.harness.r2.putSync(displayKey, new Uint8Array([0x01, 0x02, 0x03]), 'image/webp');
    ctx.harness.r2.putSync(thumbKey, new Uint8Array([0x0a]), 'image/webp');

    const output = await run(ctx.provide(serveMediaProgram(USER_A, mediaId, 'display', null)));
    expect(output.status).toBe(200);
    expect(output.headers['Content-Type']).toBe('image/webp');
    expect(output.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(output.headers['Content-Disposition']).toBe('inline; filename="photo.jpg"');
    expect(output.headers['Accept-Ranges']).toBe('bytes');
    expect(output.headers['Content-Length']).toBe('3');
    const body = new Uint8Array(await new Response(output.body).arrayBuffer());
    expect([...body]).toEqual([0x01, 0x02, 0x03]);

    // The partner can also read it (membership gate passes).
    const asPartner = await run(ctx.provide(serveMediaProgram(USER_B, mediaId, 'thumb', null)));
    expect(asPartner.status).toBe(200);
    expect(asPartner.headers['Content-Length']).toBe('1');

    // original serves the raw object with the stored content type.
    const asOriginal = await run(ctx.provide(serveMediaProgram(USER_A, mediaId, 'original', null)));
    expect(asOriginal.headers['Content-Type']).toBe('image/jpeg');
  });

  it('returns a 400 while the image is still processing (no variants yet)', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    const mediaId = '00000000-0000-4000-8000-0000000000v3';
    insertMedia(ctx.harness.d1, mediaId, SPACE_1, USER_A, { state: 'complete' }); // complete but unsanitized

    const err = await failureOf(ctx.provide(serveMediaProgram(USER_A, mediaId, 'display', null)));
    expect(err).toBeInstanceOf(BadRequestError);
  });

  it('serves audio with 206 range responses (Content-Range + Accept-Ranges)', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    const mediaId = '00000000-0000-4000-8000-0000000000v4';
    const key = insertMedia(ctx.harness.d1, mediaId, SPACE_1, USER_A, { state: 'complete', mimeType: 'audio/m4a' });
    const bytes = new Uint8Array(1000).map((_, i) => i % 256);
    ctx.harness.r2.putSync(key, bytes, 'audio/m4a');

    // Range: bytes=100-199 → 206 with the correct slice.
    const partial = await run(ctx.provide(serveMediaProgram(USER_A, mediaId, 'original', 'bytes=100-199')));
    expect(partial.status).toBe(206);
    expect(partial.headers['Content-Range']).toBe('bytes 100-199/1000');
    expect(partial.headers['Content-Length']).toBe('100');
    expect(partial.headers['Content-Type']).toBe('audio/m4a');
    expect(partial.headers['Accept-Ranges']).toBe('bytes');
    const slice = new Uint8Array(await new Response(partial.body).arrayBuffer());
    expect(slice[0]).toBe(100);
    expect(slice[99]).toBe(199);

    // Open-ended + suffix ranges.
    const open = await run(ctx.provide(serveMediaProgram(USER_A, mediaId, 'original', 'bytes=900-')));
    expect(open.status).toBe(206);
    expect(open.headers['Content-Range']).toBe('bytes 900-999/1000');

    const suffix = await run(ctx.provide(serveMediaProgram(USER_A, mediaId, 'original', 'bytes=-50')));
    expect(suffix.status).toBe(206);
    expect(suffix.headers['Content-Range']).toBe('bytes 950-999/1000');

    // No range → full 200.
    const full = await run(ctx.provide(serveMediaProgram(USER_A, mediaId, 'original', null)));
    expect(full.status).toBe(200);
    expect(full.headers['Content-Length']).toBe('1000');
  });
});

describe('parseRangeHeader', () => {
  it('parses single ranges, open ranges, and suffixes; rejects garbage', () => {
    expect(parseRangeHeader(null, 100)).toBeNull();
    expect(parseRangeHeader('bytes=0-9', 100)).toEqual({ offset: 0, length: 10 });
    expect(parseRangeHeader('bytes=10-', 100)).toEqual({ offset: 10, length: 90 });
    expect(parseRangeHeader('bytes=-20', 100)).toEqual({ offset: 80, length: 20 });
    expect(parseRangeHeader('bytes=90-200', 100)).toEqual({ offset: 90, length: 10 });
    expect(parseRangeHeader('bytes=5-2', 100)).toBeNull(); // inverted
    expect(parseRangeHeader('bytes=200-', 100)).toBeNull(); // past the end
    expect(parseRangeHeader('bytes=0-0', 100)).toEqual({ offset: 0, length: 1 });
    expect(parseRangeHeader('chunks=0-9', 100)).toBeNull();
    expect(parseRangeHeader('bytes=0-9,20-29', 100)).toBeNull(); // multi-range unsupported
  });
});

describe('completeUploadProgram quota reconciliation', () => {
  const MIB = 1024 * 1024;
  const FREE_QUOTA = 250 * MIB;

  function insertPlusEntitlement(d1: ShimD1, spaceId: string, userId: string, expiresAt: number): void {
    d1.runSync(
      `insert into space_plus_entitlements
         (space_id, purchaser_user_id, provider, entitlement_id, product_id,
          expires_at, status, last_event_id, last_event_at_ms, created_at, updated_at)
       values (?, ?, 'revenuecat', 'plus', 'aoi_plus_monthly', ?, 'active', 'evt-test', ?, ?, ?)`,
      spaceId,
      userId,
      expiresAt,
      T0,
      T0,
      T0
    );
  }

  function rowState(d1: ShimD1, mediaId: string): { upload_state: string; size_bytes: number } {
    return d1.rawDb
      .prepare('select upload_state, size_bytes from media_objects where id = ?')
      .get(mediaId) as { upload_state: string; size_bytes: number };
  }

  it('declared size == actual size succeeds normally', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    const mediaId = '00000000-0000-4000-8000-0000000000c1';
    const key = insertMedia(ctx.harness.d1, mediaId, SPACE_1, USER_A, { sizeBytes: 4 * MIB });
    ctx.harness.r2.putSync(key, new Uint8Array(4 * MIB), 'image/jpeg');

    const result = await run(ctx.provide(completeUploadProgram(USER_A, mediaId)));
    expect(result).toEqual({ ok: true });
    expect(rowState(ctx.harness.d1, mediaId)).toEqual({ upload_state: 'complete', size_bytes: 4 * MIB });
  });

  it('actual over declared but under quota succeeds and reconciles', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    const mediaId = '00000000-0000-4000-8000-0000000000c2';
    const key = insertMedia(ctx.harness.d1, mediaId, SPACE_1, USER_A, { sizeBytes: 5 * MIB });
    ctx.harness.r2.putSync(key, new Uint8Array(20 * MIB), 'image/jpeg');

    const result = await run(ctx.provide(completeUploadProgram(USER_A, mediaId)));
    expect(result).toEqual({ ok: true });
    expect(rowState(ctx.harness.d1, mediaId)).toEqual({ upload_state: 'complete', size_bytes: 20 * MIB });
  });

  it('actual crossing quota rejects with typed post-adjustment details; object deleted, row failed', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    // 240 MiB existing + 5 MiB reservation = 245 counted; actual 20 lands at 260.
    insertMedia(ctx.harness.d1, '00000000-0000-4000-8000-0000000000c0', SPACE_1, USER_A, {
      sizeBytes: 240 * MIB,
      state: 'complete',
    });
    const mediaId = '00000000-0000-4000-8000-0000000000c3';
    const key = insertMedia(ctx.harness.d1, mediaId, SPACE_1, USER_A, { sizeBytes: 5 * MIB });
    ctx.harness.r2.putSync(key, new Uint8Array(20 * MIB), 'image/jpeg');

    const err = await failureOf(ctx.provide(completeUploadProgram(USER_A, mediaId)));
    expect(err).toBeInstanceOf(LimitExceededError);
    const details = (err as LimitExceededError).details;
    expect(details).toMatchObject({
      kind: 'media_quota',
      usedBytes: 240 * MIB + 20 * MIB,
      limitBytes: FREE_QUOTA,
    });

    // Never complete; object removed; reference retained as terminal failed.
    expect(rowState(ctx.harness.d1, mediaId).upload_state).toBe('failed');
    expect(ctx.harness.r2.objects.has(key)).toBe(false);
    expect(ctx.harness.capturedQueue).toHaveLength(0);
  });

  it('failed R2 cleanup leaves the pending row for the staged purge to retry', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMedia(ctx.harness.d1, '00000000-0000-4000-8000-0000000000c0', SPACE_1, USER_A, {
      sizeBytes: 240 * MIB,
      state: 'complete',
    });
    const mediaId = '00000000-0000-4000-8000-0000000000c4';
    const key = insertMedia(ctx.harness.d1, mediaId, SPACE_1, USER_A, { sizeBytes: 5 * MIB });
    ctx.harness.r2.putSync(key, new Uint8Array(20 * MIB), 'image/jpeg');

    const originalDelete = ctx.harness.r2.delete.bind(ctx.harness.r2);
    ctx.harness.r2.delete = async () => {
      throw new Error('r2 down');
    };
    try {
      const err = await failureOf(ctx.provide(completeUploadProgram(USER_A, mediaId)));
      expect(err).toBeInstanceOf(LimitExceededError);
    } finally {
      ctx.harness.r2.delete = originalDelete;
    }

    // Reservation held in pending (still counted), object reference kept —
    // the staged purge owns storage retry from here, nothing orphaned.
    expect(rowState(ctx.harness.d1, mediaId).upload_state).toBe('pending');
    expect(ctx.harness.r2.objects.has(key)).toBe(true);
    expect(ctx.harness.capturedQueue).toHaveLength(0);
  });

  it('concurrent actual-size reconciliations cannot jointly exceed quota', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMedia(ctx.harness.d1, '00000000-0000-4000-8000-0000000000c0', SPACE_1, USER_A, {
      sizeBytes: 225 * MIB,
      state: 'complete',
    });
    // Each reserves 5 (counted 235); each actually lands 20.
    const idA = '00000000-0000-4000-8000-0000000000c5';
    const idB = '00000000-0000-4000-8000-0000000000c6';
    const keyA = insertMedia(ctx.harness.d1, idA, SPACE_1, USER_A, { sizeBytes: 5 * MIB });
    const keyB = insertMedia(ctx.harness.d1, idB, SPACE_1, USER_A, { sizeBytes: 5 * MIB });
    ctx.harness.r2.putSync(keyA, new Uint8Array(20 * MIB), 'image/jpeg');
    ctx.harness.r2.putSync(keyB, new Uint8Array(20 * MIB), 'image/jpeg');

    const [first, second] = await Promise.all([
      Effect.runPromise(Effect.exit(ctx.provide(completeUploadProgram(USER_A, idA)) as Effect.Effect<unknown, unknown, never>)),
      Effect.runPromise(Effect.exit(ctx.provide(completeUploadProgram(USER_A, idB)) as Effect.Effect<unknown, unknown, never>)),
    ]);
    const okCount = [first, second].filter((exit) => Exit.isSuccess(exit)).length;
    expect(okCount).toBe(1);

    const total = ctx.harness.d1.rawDb
      .prepare(
        `select coalesce(sum(size_bytes), 0) as used from media_objects
         where space_id = ? and deleted_at is null and upload_state in ('pending', 'complete')`
      )
      .get(SPACE_1) as { used: number };
    expect(total.used).toBeLessThanOrEqual(FREE_QUOTA);
  });

  it('Free→Plus mid-upload permits completion under the Plus quota', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMedia(ctx.harness.d1, '00000000-0000-4000-8000-0000000000c0', SPACE_1, USER_A, {
      sizeBytes: 240 * MIB,
      state: 'complete',
    });
    const mediaId = '00000000-0000-4000-8000-0000000000c7';
    const key = insertMedia(ctx.harness.d1, mediaId, SPACE_1, USER_A, { sizeBytes: 5 * MIB });
    ctx.harness.r2.putSync(key, new Uint8Array(20 * MIB), 'image/jpeg');

    insertPlusEntitlement(ctx.harness.d1, SPACE_1, USER_A, T0 + 365 * 24 * 60 * 60 * 1000);
    const result = await run(ctx.provide(completeUploadProgram(USER_A, mediaId)));
    expect(result).toEqual({ ok: true });
    expect(rowState(ctx.harness.d1, mediaId).upload_state).toBe('complete');
  });

  it('Plus→Free before completion obeys Free quota without touching completed media', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMedia(ctx.harness.d1, '00000000-0000-4000-8000-0000000000c0', SPACE_1, USER_A, {
      sizeBytes: 240 * MIB,
      state: 'complete',
    });
    insertPlusEntitlement(ctx.harness.d1, SPACE_1, USER_A, T0 + 365 * 24 * 60 * 60 * 1000);
    const mediaId = '00000000-0000-4000-8000-0000000000c8';
    const key = insertMedia(ctx.harness.d1, mediaId, SPACE_1, USER_A, { sizeBytes: 5 * MIB });
    ctx.harness.r2.putSync(key, new Uint8Array(20 * MIB), 'image/jpeg');

    // Downgrade lands before completion.
    ctx.harness.d1.runSync('delete from space_plus_entitlements where space_id = ?', SPACE_1);
    const err = await failureOf(ctx.provide(completeUploadProgram(USER_A, mediaId)));
    expect(err).toBeInstanceOf(LimitExceededError);

    // Existing completed media is untouched (non-destructive downgrade).
    expect(rowState(ctx.harness.d1, '00000000-0000-4000-8000-0000000000c0')).toEqual({
      upload_state: 'complete',
      size_bytes: 240 * MIB,
    });
  });
});
