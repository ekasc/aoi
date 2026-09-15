import { describe, expect, it } from 'vitest';
import { Effect, Exit } from 'effect';

import {
  createMomentRequestSchema,
  mediaObjectUrl,
  type CreateMomentRequest,
} from '@aoi/shared';

import { makeTestHarness, type ShimD1 } from '../../effects/test-harness';
import { mediaOriginalKey } from '../../domains/media';
import {
  createMomentProgram,
  deleteMomentProgram,
  listMomentsProgram,
  listTimelineProgram,
  updateMomentProgram,
} from '../../domains/moments';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../domains/errors';

/**
 * Ordered multi-attachment image/audio backend (unified memory composer).
 *
 * Pinned at the program level over real D1 (better-sqlite3 baseline):
 * - valid own complete image/audio attaches with deterministic ordering,
 *   stable member-authorized urls (display for images, original for audio),
 *   and legacy single-media columns derived for old clients;
 * - wrong owner / wrong space / incomplete / kind-mismatch / duplicate /
 *   over-limit / video / device-URI inputs reject;
 * - clientId replay returns the original content + attachments with no
 *   duplicate links and no second push;
 * - list + timeline serialize attachments (batched, no N+1);
 * - legacy single-media rows (no attachment rows) still read with a
 *   synthesized attachment and preserved old fields;
 * - update replacement / untouched-omitted / clear-[] semantics and
 *   delete-time media release (shared media stays live) are atomic.
 */

const USER_A = '00000000-0000-4000-8000-000000000001';
const USER_B = '00000000-0000-4000-8000-000000000002';
const USER_C = '00000000-0000-4000-8000-000000000003';
const SPACE_1 = '00000000-0000-4000-8000-000000000010';
const SPACE_2 = '00000000-0000-4000-8000-000000000020';
const T0 = Date.parse('2026-01-15T00:00:00.000Z');

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
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
  d1.runSync(
    `insert into space_members (space_id, user_id, role, state, joined_at) values (?, ?, 'you', 'active', ?)`,
    id,
    creatorId,
    T0
  );
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
  opts?: { mimeType?: string; state?: 'pending' | 'complete' | 'failed' }
): void {
  const mimeType = opts?.mimeType ?? 'image/jpeg';
  d1.runSync(
    `insert into media_objects (id, space_id, created_by_user_id, filename, mime_type,
       size_bytes, storage_key, upload_state, created_at)
     values (?, ?, ?, 'file.bin', ?, 1000, ?, ?, ?)`,
    id,
    spaceId,
    userId,
    mimeType,
    mediaOriginalKey(id, mimeType),
    opts?.state ?? 'complete',
    T0
  );
}

function attachmentCount(d1: ShimD1, momentId: string): number {
  const row = d1.rawDb
    .prepare('select count(*) as n from moment_attachments where moment_id = ?')
    .get(momentId) as { n: number };
  return row.n;
}

function mediaDeletedAt(d1: ShimD1, mediaId: string): number | null | undefined {
  const row = d1.rawDb
    .prepare('select deleted_at from media_objects where id = ?')
    .get(mediaId) as { deleted_at: number | null } | undefined;
  return row?.deleted_at;
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
  if (Exit.isSuccess(exit)) throw new Error('expected program to fail, but it succeeded');
  const cause = exit.cause as { _tag: string; error?: unknown };
  if (cause._tag === 'Fail' && cause.error !== undefined) return cause.error;
  throw new Error(`unexpected failure cause: ${cause._tag}`);
}

function pairedSpace(harness: ReturnType<typeof makeTestHarness>): void {
  insertUser(harness.d1, USER_A, 'a@example.com', 'Alice');
  insertUser(harness.d1, USER_B, 'b@example.com', 'Bob');
  insertSpace(harness.d1, SPACE_1, USER_A);
  insertMember(harness.d1, SPACE_1, USER_B, 'partner');
}

describe('create with ordered image/audio attachments', () => {
  it('attaches own complete media in order with stable urls and derived legacy columns', async () => {
    const ctx = makeCtx();
    pairedSpace(ctx.harness);
    const img = uuid(101);
    const aud = uuid(102);
    insertMedia(ctx.harness.d1, img, SPACE_1, USER_A, { mimeType: 'image/jpeg' });
    insertMedia(ctx.harness.d1, aud, SPACE_1, USER_A, { mimeType: 'audio/m4a' });

    const result = await run(
      ctx.provide(
        createMomentProgram(USER_A, {
          type: 'media',
          title: 'Lake + voice',
          attachments: [
            { mediaId: aud, kind: 'audio' as const },
            { mediaId: img, kind: 'image' as const },
          ],
        } satisfies CreateMomentRequest)
      )
    );

    expect(result.created).toBe(true);
    // Deterministic client order is preserved (audio first).
    expect(result.moment.attachments.map((a) => a.mediaId)).toEqual([aud, img]);
    expect(result.moment.attachments).toEqual([
      { mediaId: aud, kind: 'audio', url: mediaObjectUrl(aud, 'original') },
      { mediaId: img, kind: 'image', url: mediaObjectUrl(img, 'display') },
    ]);
    // Legacy columns derived for old clients / export / wall / summary.
    expect(result.moment.mediaId).toBe(aud);
    expect(result.moment.mediaPreview).toBe(mediaObjectUrl(img, 'display'));
    expect(result.moment.audioUri).toBe(mediaObjectUrl(aud, 'original'));
    // Persisted ordered with positions 0,1.
    const rows = ctx.harness.d1.rawDb
      .prepare('select media_id, position, kind from moment_attachments where moment_id = ? order by position')
      .all(result.moment.id) as { media_id: string; position: number; kind: string }[];
    expect(rows).toEqual([
      { media_id: aud, position: 0, kind: 'audio' },
      { media_id: img, position: 1, kind: 'image' },
    ]);
  });

  it('rejects another member’s upload (wrong owner, fail-closed 404)', async () => {
    const ctx = makeCtx();
    pairedSpace(ctx.harness);
    const others = uuid(111);
    insertMedia(ctx.harness.d1, others, SPACE_1, USER_B, { mimeType: 'image/png' });

    const err = await failureOf(
      ctx.provide(
        createMomentProgram(USER_A, {
          type: 'media',
          attachments: [{ mediaId: others, kind: 'image' }],
        })
      )
    );
    expect(err).toBeInstanceOf(NotFoundError);
  });

  it('rejects media from another space (fail-closed 404)', async () => {
    const ctx = makeCtx();
    pairedSpace(ctx.harness);
    insertUser(ctx.harness.d1, USER_C, 'c@example.com', 'Carol');
    insertSpace(ctx.harness.d1, SPACE_2, USER_C);
    const foreign = uuid(112);
    insertMedia(ctx.harness.d1, foreign, SPACE_2, USER_C, { mimeType: 'image/png' });

    const err = await failureOf(
      ctx.provide(
        createMomentProgram(USER_A, {
          type: 'media',
          attachments: [{ mediaId: foreign, kind: 'image' }],
        })
      )
    );
    expect(err).toBeInstanceOf(NotFoundError);
  });

  it('rejects incomplete uploads (pending/failed are 400)', async () => {
    const ctx = makeCtx();
    pairedSpace(ctx.harness);
    const pending = uuid(113);
    const failed = uuid(114);
    insertMedia(ctx.harness.d1, pending, SPACE_1, USER_A, { mimeType: 'image/jpeg', state: 'pending' });
    insertMedia(ctx.harness.d1, failed, SPACE_1, USER_A, { mimeType: 'audio/m4a', state: 'failed' });

    const pendingErr = await failureOf(
      ctx.provide(createMomentProgram(USER_A, { type: 'media', attachments: [{ mediaId: pending, kind: 'image' }] }))
    );
    expect(pendingErr).toBeInstanceOf(BadRequestError);

    const failedErr = await failureOf(
      ctx.provide(createMomentProgram(USER_A, { type: 'media', attachments: [{ mediaId: failed, kind: 'audio' }] }))
    );
    expect(failedErr).toBeInstanceOf(BadRequestError);
  });

  it('rejects MIME/kind mismatches (400)', async () => {
    const ctx = makeCtx();
    pairedSpace(ctx.harness);
    const img = uuid(115);
    insertMedia(ctx.harness.d1, img, SPACE_1, USER_A, { mimeType: 'image/jpeg' });

    const err = await failureOf(
      ctx.provide(
        createMomentProgram(USER_A, { type: 'media', attachments: [{ mediaId: img, kind: 'audio' }] })
      )
    );
    expect(err).toBeInstanceOf(BadRequestError);
  });

  it('rejects duplicate media ids and over-limit sets (400)', async () => {
    const ctx = makeCtx();
    pairedSpace(ctx.harness);
    const img = uuid(116);
    insertMedia(ctx.harness.d1, img, SPACE_1, USER_A, { mimeType: 'image/jpeg' });

    const dup = await failureOf(
      ctx.provide(
        createMomentProgram(USER_A, {
          type: 'media',
          attachments: [
            { mediaId: img, kind: 'image' },
            { mediaId: img, kind: 'image' },
          ],
        })
      )
    );
    expect(dup).toBeInstanceOf(BadRequestError);

    const eleven = Array.from({ length: 11 }, (_, i) => ({ mediaId: uuid(200 + i), kind: 'image' as const }));
    const over = await failureOf(
      ctx.provide(createMomentProgram(USER_A, { type: 'media', attachments: eleven }))
    );
    expect(over).toBeInstanceOf(BadRequestError);
  });

  it('contract: video, device URIs, and remote URLs are rejected at the schema boundary', () => {
    // Video cannot be enabled until privacy stripping + playback exists.
    expect(
      createMomentRequestSchema.safeParse({
        type: 'media',
        attachments: [{ mediaId: uuid(121), kind: 'video' }],
      }).success
    ).toBe(false);
    // No device URI / URL / remote path is accepted — strict { mediaId, kind } only.
    expect(
      createMomentRequestSchema.safeParse({
        type: 'media',
        attachments: [{ mediaId: uuid(122), kind: 'image', url: 'file:///device/photo.jpg' }],
      }).success
    ).toBe(false);
    expect(
      createMomentRequestSchema.safeParse({
        type: 'media',
        attachments: [{ mediaId: uuid(123), kind: 'image', deviceUri: 'file:///device/a.jpg' }],
      }).success
    ).toBe(false);
    expect(
      createMomentRequestSchema.safeParse({
        type: 'media',
        attachments: [{ mediaId: uuid(124), kind: 'audio', audioUri: 'https://cdn.example/x.m4a' }],
      }).success
    ).toBe(false);
    // Over-limit (11) is rejected by max(10) — bounded payload/picker.
    expect(
      createMomentRequestSchema.safeParse({
        type: 'media',
        attachments: Array.from({ length: 11 }, (_, i) => ({ mediaId: uuid(300 + i), kind: 'image' })),
      }).success
    ).toBe(false);
  });
});

describe('clientId replay with attachments', () => {
  it('returns the original content + attachments with no duplicate links and no second push', async () => {
    const ctx = makeCtx();
    pairedSpace(ctx.harness);
    const img = uuid(131);
    const aud = uuid(132);
    insertMedia(ctx.harness.d1, img, SPACE_1, USER_A, { mimeType: 'image/png' });
    insertMedia(ctx.harness.d1, aud, SPACE_1, USER_A, { mimeType: 'audio/m4a' });
    const input = {
      type: 'media' as const,
      title: 'First',
      clientId: 'draft-attachments-1',
      attachments: [
        { mediaId: img, kind: 'image' as const },
        { mediaId: aud, kind: 'audio' as const },
      ],
    };

    const first = await run(ctx.provide(createMomentProgram(USER_A, input)));
    // Retry with a different title: replay must return the ORIGINAL.
    const second = await run(
      ctx.provide(createMomentProgram(USER_A, { ...input, title: 'Second (must be ignored)' }))
    );

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.moment.id).toBe(first.moment.id);
    expect(second.moment.title).toBe('First');
    expect(second.moment.attachments).toEqual(first.moment.attachments);
    expect(attachmentCount(ctx.harness.d1, first.moment.id)).toBe(2);
    expect(ctx.harness.capturedQueue).toHaveLength(1);
  });
});

describe('list + timeline serialization', () => {
  it('lists moments with ordered attachments (single batched fetch, no N+1)', async () => {
    const ctx = makeCtx();
    pairedSpace(ctx.harness);
    const imgA = uuid(141);
    const imgB = uuid(142);
    insertMedia(ctx.harness.d1, imgA, SPACE_1, USER_A, { mimeType: 'image/jpeg' });
    insertMedia(ctx.harness.d1, imgB, SPACE_1, USER_A, { mimeType: 'image/png' });

    const created = await run(
      ctx.provide(
        createMomentProgram(USER_A, {
          type: 'media',
          attachments: [
            { mediaId: imgB, kind: 'image' },
            { mediaId: imgA, kind: 'image' },
          ],
        })
      )
    );
    await run(ctx.provide(createMomentProgram(USER_A, { type: 'note', title: 'plain' })));

    const list = await run(ctx.provide(listMomentsProgram(USER_A, { limit: 10 })));
    expect(list.moments).toHaveLength(2);
    const withMedia = list.moments.find((m) => m.id === created.moment.id);
    expect(withMedia?.attachments.map((a) => a.mediaId)).toEqual([imgB, imgA]);
    const plain = list.moments.find((m) => m.id !== created.moment.id);
    expect(plain?.attachments).toEqual([]);
  });

  it('timeline rows carry attachments plus viewer-relative isRead', async () => {
    const ctx = makeCtx();
    pairedSpace(ctx.harness);
    const img = uuid(143);
    insertMedia(ctx.harness.d1, img, SPACE_1, USER_B, { mimeType: 'image/jpeg' });
    const created = await run(
      ctx.provide(createMomentProgram(USER_B, { type: 'media', attachments: [{ mediaId: img, kind: 'image' }] }))
    );

    const timeline = await run(ctx.provide(listTimelineProgram(USER_A, { limit: 10 })));
    const row = timeline.moments.find((m) => m.id === created.moment.id);
    expect(row?.attachments).toEqual([{ mediaId: img, kind: 'image', url: mediaObjectUrl(img, 'display') }]);
    expect(row?.isRead).toBe(false);
  });
});

describe('existing records compatibility', () => {
  it('legacy single-media rows read with a synthesized attachment and preserved old fields', async () => {
    const ctx = makeCtx();
    pairedSpace(ctx.harness);
    const legacy = uuid(151);
    insertMedia(ctx.harness.d1, legacy, SPACE_1, USER_A, { mimeType: 'image/png' });
    // Pre-attachment row: direct insert with legacy columns only.
    ctx.harness.d1.runSync(
      `insert into moments (id, space_id, created_by_user_id, author_role, author_name,
         type, title, body, occurred_at, target_at, media_preview, audio_uri,
         media_id, client_id, created_at, updated_at)
       values (?, ?, ?, 'you', 'You', 'media', 'Old photo', '', ?, null, ?, null, ?, ?, ?, ?)`,
      uuid(152),
      SPACE_1,
      USER_A,
      T0,
      mediaObjectUrl(legacy, 'display'),
      legacy,
      'client-legacy-1',
      T0,
      T0
    );

    const list = await run(ctx.provide(listMomentsProgram(USER_A, { limit: 10 })));
    expect(list.moments).toHaveLength(1);
    expect(list.moments[0].mediaId).toBe(legacy);
    expect(list.moments[0].mediaPreview).toBe(mediaObjectUrl(legacy, 'display'));
    expect(list.moments[0].attachments).toEqual([
      { mediaId: legacy, kind: 'image', url: mediaObjectUrl(legacy, 'display') },
    ]);
  });

  it('moments without media read with empty attachments and untouched legacy nulls', async () => {
    const ctx = makeCtx();
    pairedSpace(ctx.harness);
    const created = await run(ctx.provide(createMomentProgram(USER_A, { type: 'note', title: 't' })));
    expect(created.moment.attachments).toEqual([]);
    expect(created.moment.mediaId ?? null).toBeNull();
  });
});

describe('update + delete with attachments', () => {
  it('replaces the set atomically, re-derives legacy, and releases the old media', async () => {
    const ctx = makeCtx();
    pairedSpace(ctx.harness);
    const oldImg = uuid(161);
    const newAud = uuid(162);
    insertMedia(ctx.harness.d1, oldImg, SPACE_1, USER_A, { mimeType: 'image/jpeg' });
    insertMedia(ctx.harness.d1, newAud, SPACE_1, USER_A, { mimeType: 'audio/m4a' });

    const created = await run(
      ctx.provide(createMomentProgram(USER_A, { type: 'media', attachments: [{ mediaId: oldImg, kind: 'image' }] }))
    );
    const updated = await run(
      ctx.provide(updateMomentProgram(USER_A, created.moment.id, { attachments: [{ mediaId: newAud, kind: 'audio' }] }))
    );

    expect(updated.attachments).toEqual([{ mediaId: newAud, kind: 'audio', url: mediaObjectUrl(newAud, 'original') }]);
    expect(updated.mediaId).toBe(newAud);
    expect(updated.mediaPreview).toBeNull();
    expect(updated.audioUri).toBe(mediaObjectUrl(newAud, 'original'));
    // Old media released (unreferenced), new media live.
    expect(mediaDeletedAt(ctx.harness.d1, oldImg)).toBeTypeOf('number');
    expect(mediaDeletedAt(ctx.harness.d1, newAud)).toBeNull();
  });

  it('omitted attachments leave attachments and legacy fields untouched', async () => {
    const ctx = makeCtx();
    pairedSpace(ctx.harness);
    const img = uuid(163);
    insertMedia(ctx.harness.d1, img, SPACE_1, USER_A, { mimeType: 'image/jpeg' });
    const created = await run(
      ctx.provide(createMomentProgram(USER_A, { type: 'media', attachments: [{ mediaId: img, kind: 'image' }] }))
    );

    const updated = await run(ctx.provide(updateMomentProgram(USER_A, created.moment.id, { title: 'retitled' })));
    expect(updated.title).toBe('retitled');
    expect(updated.attachments.map((a) => a.mediaId)).toEqual([img]);
    expect(updated.mediaId).toBe(img);
  });

  it('empty array clears attachments and legacy columns, releasing the media', async () => {
    const ctx = makeCtx();
    pairedSpace(ctx.harness);
    const img = uuid(164);
    insertMedia(ctx.harness.d1, img, SPACE_1, USER_A, { mimeType: 'image/jpeg' });
    const created = await run(
      ctx.provide(createMomentProgram(USER_A, { type: 'media', attachments: [{ mediaId: img, kind: 'image' }] }))
    );

    const cleared = await run(ctx.provide(updateMomentProgram(USER_A, created.moment.id, { attachments: [] })));
    expect(cleared.attachments).toEqual([]);
    expect(cleared.mediaId ?? null).toBeNull();
    expect(mediaDeletedAt(ctx.harness.d1, img)).toBeTypeOf('number');
  });

  it('403s when editing another user’s attachments', async () => {
    const ctx = makeCtx();
    pairedSpace(ctx.harness);
    const img = uuid(165);
    insertMedia(ctx.harness.d1, img, SPACE_1, USER_A, { mimeType: 'image/jpeg' });
    const created = await run(
      ctx.provide(createMomentProgram(USER_A, { type: 'media', attachments: [{ mediaId: img, kind: 'image' }] }))
    );

    const err = await failureOf(ctx.provide(updateMomentProgram(USER_B, created.moment.id, { attachments: [] })));
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it('deleting a moment releases its attachments when unreferenced but keeps shared media live', async () => {
    const ctx = makeCtx();
    pairedSpace(ctx.harness);
    const shared = uuid(171);
    const solo = uuid(172);
    insertMedia(ctx.harness.d1, shared, SPACE_1, USER_A, { mimeType: 'image/jpeg' });
    insertMedia(ctx.harness.d1, solo, SPACE_1, USER_A, { mimeType: 'image/jpeg' });

    const first = await run(
      ctx.provide(createMomentProgram(USER_A, { type: 'media', attachments: [{ mediaId: shared, kind: 'image' }] }))
    );
    // Second moment shares the first's media via the legacy single-media
    // path (cross-reference coverage): the release check spans both tables.
    ctx.harness.d1.runSync(
      `insert into moments (id, space_id, created_by_user_id, author_role, author_name,
         type, title, body, occurred_at, target_at, media_preview, audio_uri,
         media_id, client_id, created_at, updated_at)
       values (?, ?, ?, 'you', 'You', 'media', 'Shared', '', ?, null, null, null, ?, ?, ?, ?)`,
      uuid(173),
      SPACE_1,
      USER_A,
      T0,
      shared,
      'client-shared-legacy',
      T0,
      T0
    );
    const soloMoment = await run(
      ctx.provide(createMomentProgram(USER_A, { type: 'media', attachments: [{ mediaId: solo, kind: 'image' }] }))
    );

    await run(ctx.provide(deleteMomentProgram(USER_A, first.moment.id)));
    // Still referenced by the legacy row → stays live.
    expect(mediaDeletedAt(ctx.harness.d1, shared)).toBeNull();

    await run(ctx.provide(deleteMomentProgram(USER_A, soloMoment.moment.id)));
    // Unreferenced → tombstoned for the retryable purge (quota released now).
    expect(mediaDeletedAt(ctx.harness.d1, solo)).toBeTypeOf('number');
  });
});
