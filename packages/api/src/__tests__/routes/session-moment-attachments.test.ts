import { describe, expect, it } from 'vitest';

import { createApp } from '../../create-app';
import { makeTestHarness, type ShimD1 } from '../../effects/test-harness';
import { mediaOriginalKey } from '../../domains/media';

/**
 * HTTP contracts for ordered multi-attachment moments (worker transport over
 * the Effect programs). The export boundary reads these same authorized
 * endpoints, so attachments on list/timeline IS the export contract — no
 * separate export service.
 */

const USER_A = '00000000-0000-4000-8000-000000000001';
const USER_B = '00000000-0000-4000-8000-000000000002';
const TOKEN_A = 'token-a';
const TOKEN_B = 'token-b';
const SPACE_ID = '00000000-0000-4000-8000-000000000010';
const T = (iso: string) => Date.parse(iso);
const T0 = T('2026-01-15T00:00:00.000Z');

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function insertUser(d1: ShimD1, id: string, email: string, name: string, token: string): void {
  d1.runSync(
    'insert into users (id, email, name, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?)',
    id,
    email,
    name,
    T0,
    T0
  );
  d1.runSync(
    'insert into user_sessions (id, user_id, token, expires_at, created_at, updated_at) values (?, ?, ?, ?, ?, ?)',
    `sess-${id.slice(-4)}`,
    id,
    token,
    T('2027-02-01T00:00:00.000Z'),
    T0,
    T0
  );
}

function insertSpace(d1: ShimD1): void {
  d1.runSync(
    'insert into spaces (id, name, partner_name, relationship_start_date, created_by_user_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)',
    SPACE_ID,
    'Our Space',
    'Partner',
    '2024-06-15',
    USER_A,
    T0,
    T0
  );
  d1.runSync(
    "insert into space_members (space_id, user_id, role, state, joined_at) values (?, ?, 'you', 'active', ?)",
    SPACE_ID,
    USER_A,
    T0
  );
  d1.runSync(
    "insert into space_members (space_id, user_id, role, state, joined_at) values (?, ?, 'partner', 'active', ?)",
    SPACE_ID,
    USER_B,
    T0
  );
}

function insertMedia(
  d1: ShimD1,
  id: string,
  userId: string,
  mimeType: string,
  state: 'pending' | 'complete' | 'failed' = 'complete'
): void {
  d1.runSync(
    `insert into media_objects (id, space_id, created_by_user_id, filename, mime_type,
       size_bytes, storage_key, upload_state, created_at)
     values (?, ?, ?, 'file.bin', ?, 1000, ?, ?, ?)`,
    id,
    SPACE_ID,
    userId,
    mimeType,
    mediaOriginalKey(id, mimeType),
    state,
    T0
  );
}

function makeApp() {
  const harness = makeTestHarness();
  const app = createApp(harness.layer);
  return { harness, app };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function setup(): ReturnType<typeof makeApp> {
  const ctx = makeApp();
  insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Aoi', TOKEN_A);
  insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Blake', TOKEN_B);
  insertSpace(ctx.harness.d1);
  return ctx;
}

describe('moment attachments routes', () => {
  it('creates with ordered attachments (201), replays the same clientId as 200 with identical attachments', async () => {
    const { harness: h, app: a } = setup();
    const img = uuid(501);
    const aud = uuid(502);
    insertMedia(h.d1, img, USER_A, 'image/jpeg');
    insertMedia(h.d1, aud, USER_A, 'audio/m4a');

    const body = {
      type: 'media',
      title: 'Lake + voice',
      clientId: 'composer-draft-1',
      attachments: [
        { mediaId: aud, kind: 'audio' },
        { mediaId: img, kind: 'image' },
      ],
    };
    const first = await a.request('/v1/spaces/current/moments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify(body),
    });
    expect(first.status).toBe(201);
    const firstJson = (await first.json()) as { id: string; attachments: { mediaId: string; kind: string; url: string }[]; mediaId: string };
    expect(firstJson.attachments.map((x) => x.mediaId)).toEqual([aud, img]);
    expect(firstJson.attachments[0]).toMatchObject({ kind: 'audio', url: `/v1/media/${aud}/object?variant=original` });
    expect(firstJson.attachments[1]).toMatchObject({ kind: 'image', url: `/v1/media/${img}/object?variant=display` });

    const second = await a.request('/v1/spaces/current/moments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify({ ...body, title: 'ignored' }),
    });
    expect(second.status).toBe(200);
    const secondJson = (await second.json()) as { id: string; title: string; attachments: unknown[] };
    expect(secondJson.id).toBe(firstJson.id);
    expect(secondJson.attachments).toEqual(firstJson.attachments);
  });

  it('validates attachments: duplicates, over-limit, video, device URIs, wrong owner/space, incomplete', async () => {
    const { harness, app } = setup();
    const img = uuid(511);
    const other = uuid(512);
    const pending = uuid(513);
    insertMedia(harness.d1, img, USER_A, 'image/jpeg');
    insertMedia(harness.d1, other, USER_B, 'image/png');
    insertMedia(harness.d1, pending, USER_A, 'image/jpeg', 'pending');

    const post = (payload: unknown) =>
      app.request('/v1/spaces/current/moments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
        body: JSON.stringify(payload),
      });

    // Duplicate ids.
    expect(
      (await post({ type: 'media', attachments: [{ mediaId: img, kind: 'image' }, { mediaId: img, kind: 'image' }] })).status
    ).toBe(400);
    // Over-limit (11).
    expect(
      (
        await post({
          type: 'media',
          attachments: Array.from({ length: 11 }, (_, i) => ({ mediaId: uuid(600 + i), kind: 'image' })),
        })
      ).status
    ).toBe(400);
    // Video is not enabled.
    expect((await post({ type: 'media', attachments: [{ mediaId: img, kind: 'video' }] })).status).toBe(400);
    // Device URI / URL extras are rejected (strict).
    expect(
      (await post({ type: 'media', attachments: [{ mediaId: img, kind: 'image', url: 'file:///x.jpg' }] })).status
    ).toBe(400);
    // Wrong owner (partner's upload) is fail-closed.
    expect((await post({ type: 'media', attachments: [{ mediaId: other, kind: 'image' }] })).status).toBe(404);
    // Incomplete upload.
    expect((await post({ type: 'media', attachments: [{ mediaId: pending, kind: 'image' }] })).status).toBe(400);
    // Kind mismatch.
    expect((await post({ type: 'media', attachments: [{ mediaId: img, kind: 'audio' }] })).status).toBe(400);
  });

  it('list + timeline serialize attachments (the export read contract)', async () => {
    const { harness, app } = setup();
    const img = uuid(521);
    insertMedia(harness.d1, img, USER_A, 'image/jpeg');
    const created = await app.request('/v1/spaces/current/moments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify({ type: 'media', attachments: [{ mediaId: img, kind: 'image' }] }),
    });
    expect(created.status).toBe(201);

    const list = await app.request('/v1/spaces/current/moments?limit=10', { headers: auth(TOKEN_A) });
    expect(list.status).toBe(200);
    const listJson = (await list.json()) as { moments: { id: string; attachments: { mediaId: string }[] }[] };
    expect(listJson.moments).toHaveLength(1);
    expect(listJson.moments[0].attachments.map((a) => a.mediaId)).toEqual([img]);

    const timeline = await app.request('/v1/spaces/current/moments/timeline?limit=10', {
      headers: auth(TOKEN_B),
    });
    expect(timeline.status).toBe(200);
    const timelineJson = (await timeline.json()) as { moments: { attachments: { mediaId: string }[] }[] };
    expect(timelineJson.moments[0].attachments.map((a) => a.mediaId)).toEqual([img]);
  });

  it('PATCH replaces attachments and re-derives legacy columns', async () => {
    const { harness, app } = setup();
    const img = uuid(531);
    const aud = uuid(532);
    insertMedia(harness.d1, img, USER_A, 'image/jpeg');
    insertMedia(harness.d1, aud, USER_A, 'audio/m4a');
    const created = await app.request('/v1/spaces/current/moments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify({ type: 'media', attachments: [{ mediaId: img, kind: 'image' }] }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const patched = await app.request(`/v1/moments/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify({ attachments: [{ mediaId: aud, kind: 'audio' }] }),
    });
    expect(patched.status).toBe(200);
    const patchedJson = (await patched.json()) as {
      attachments: { mediaId: string; kind: string }[];
      mediaId: string;
      mediaPreview: null;
    };
    expect(patchedJson.attachments.map((a) => a.mediaId)).toEqual([aud]);
    expect(patchedJson.mediaId).toBe(aud);
    expect(patchedJson.mediaPreview).toBeNull();
  });
});
