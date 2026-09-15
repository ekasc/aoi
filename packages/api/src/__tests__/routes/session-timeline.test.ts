import { describe, expect, it } from 'vitest';

import { createApp } from '../../create-app';
import { makeTestHarness, type ShimD1 } from '../../effects/test-harness';

/**
 * Route-level contracts for the synced timeline: auth, query/json
 * validation, viewer-relative isRead, and idempotent mark semantics over
 * real HTTP + real domain code. No legacy list regression: timeline lives
 * on its own endpoints.
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

function insertUser(d1: ShimD1, id: string, email: string, name: string, token?: string): void {
  d1.runSync(
    'insert into users (id, email, name, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?)',
    id,
    email,
    name,
    T0,
    T0
  );
  if (token) {
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

function insertMoment(d1: ShimD1, id: string, authorId: string, occurredAtMs: number, type = 'note'): void {
  d1.runSync(
    `insert into moments (id, space_id, created_by_user_id, author_role, author_name,
       type, title, body, occurred_at, target_at, media_preview, audio_uri,
       media_id, client_id, created_at, updated_at)
     values (?, ?, ?, 'you', 'You', ?, '', '', ?, null, null, null, null, ?, ?, ?)`,
    id,
    SPACE_ID,
    authorId,
    type,
    occurredAtMs,
    `client-${id.slice(-4)}`,
    occurredAtMs,
    occurredAtMs
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

describe('timeline routes', () => {
  it('requires auth on both endpoints', async () => {
    const { app } = makeApp();
    const timeline = await app.request('/v1/spaces/current/moments/timeline');
    expect(timeline.status).toBe(401);
    const mark = await app.request('/v1/spaces/current/moments/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ momentIds: [uuid(1)] }),
    });
    expect(mark.status).toBe(401);
  });

  it('returns ascending moments with isRead, firstUnread, and unreadCount', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'a@example.com', 'Aoi', TOKEN_A);
    insertUser(harness.d1, USER_B, 'b@example.com', 'Blake', TOKEN_B);
    insertSpace(harness.d1);
    insertMoment(harness.d1, uuid(1), USER_B, T0);
    insertMoment(harness.d1, uuid(2), USER_A, T0 + 1000);
    insertMoment(harness.d1, uuid(3), USER_B, T0 + 2000, 'goal');

    const res = await app.request('/v1/spaces/current/moments/timeline?limit=100', {
      headers: auth(TOKEN_A),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // Goals excluded; ascending (latest bottom).
    expect(body.moments.map((m: { id: string }) => m.id)).toEqual([uuid(1), uuid(2)]);
    expect(body.moments[0].isRead).toBe(false);
    expect(body.moments[1].isRead).toBe(true);
    expect(body.firstUnread).toEqual({ id: uuid(1), occurredAt: new Date(T0).toISOString() });
    expect(body.unreadCount).toBe(1);
    expect(body.olderCursor).toBeNull();
    expect(body.newerCursor).toBeNull();
  });

  it('marks visible partner moments read idempotently without notifying', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'a@example.com', 'Aoi', TOKEN_A);
    insertUser(harness.d1, USER_B, 'b@example.com', 'Blake', TOKEN_B);
    insertSpace(harness.d1);
    insertMoment(harness.d1, uuid(11), USER_B, T0);

    const mark = await app.request('/v1/spaces/current/moments/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify({ momentIds: [uuid(11)] }),
    });
    expect(mark.status).toBe(200);
    expect(await mark.json()).toEqual({ ok: true });

    const again = await app.request('/v1/spaces/current/moments/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify({ momentIds: [uuid(11)] }),
    });
    expect(again.status).toBe(200);

    const timeline = await app.request('/v1/spaces/current/moments/timeline?limit=100', {
      headers: auth(TOKEN_A),
    });
    const body = await timeline.json();
    expect(body.unreadCount).toBe(0);
    expect(body.firstUnread).toBeNull();
    expect(body.moments[0].isRead).toBe(true);
    // Read emits no partner notification.
    expect(harness.capturedQueue).toEqual([]);
  });

  it('validates cursors, mutual exclusivity, and batch shape', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'a@example.com', 'Aoi', TOKEN_A);
    insertUser(harness.d1, USER_B, 'b@example.com', 'Blake', TOKEN_B);
    insertSpace(harness.d1);

    const both = await app.request(
      `/v1/spaces/current/moments/timeline?before=${encodeURIComponent(`${T0}|${uuid(1)}`)}&after=${encodeURIComponent(`${T0}|${uuid(2)}`)}`,
      { headers: auth(TOKEN_A) }
    );
    expect(both.status).toBe(400);

    const badCursor = await app.request('/v1/spaces/current/moments/timeline?before=nope', {
      headers: auth(TOKEN_A),
    });
    expect(badCursor.status).toBe(400);

    const tooBig = await app.request('/v1/spaces/current/moments/timeline?limit=101', {
      headers: auth(TOKEN_A),
    });
    expect(tooBig.status).toBe(400);

    const empty = await app.request('/v1/spaces/current/moments/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify({ momentIds: [] }),
    });
    expect(empty.status).toBe(400);

    const badUuid = await app.request('/v1/spaces/current/moments/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify({ momentIds: ['not-a-uuid'] }),
    });
    expect(badUuid.status).toBe(400);

    const tooMany = await app.request('/v1/spaces/current/moments/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify({ momentIds: Array.from({ length: 101 }, (_, i) => uuid(5000 + i)) }),
    });
    expect(tooMany.status).toBe(400);
  });

  it('pages older above and newer below with exact cursors', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'a@example.com', 'Aoi', TOKEN_A);
    insertUser(harness.d1, USER_B, 'b@example.com', 'Blake', TOKEN_B);
    insertSpace(harness.d1);
    insertMoment(harness.d1, uuid(21), USER_B, T0);
    insertMoment(harness.d1, uuid(22), USER_B, T0 + 1000);
    insertMoment(harness.d1, uuid(23), USER_B, T0 + 2000);

    const initial = await app.request('/v1/spaces/current/moments/timeline?limit=2', {
      headers: auth(TOKEN_A),
    });
    expect(initial.status).toBe(200);
    const first = await initial.json();
    // Initial centers on FIRST unread: oldest + next.
    expect(first.moments.map((m: { id: string }) => m.id)).toEqual([uuid(21), uuid(22)]);
    expect(first.newerCursor).not.toBeNull();

    const forward = await app.request(
      `/v1/spaces/current/moments/timeline?after=${encodeURIComponent(first.newerCursor)}&limit=2`,
      { headers: auth(TOKEN_A) }
    );
    expect(forward.status).toBe(200);
    const second = await forward.json();
    expect(second.moments.map((m: { id: string }) => m.id)).toEqual([uuid(23)]);

    const back = await app.request(
      `/v1/spaces/current/moments/timeline?before=${encodeURIComponent(second.moments[0].id === uuid(23) ? `${T0 + 2000}|${uuid(23)}` : second.olderCursor)}&limit=2`,
      { headers: auth(TOKEN_A) }
    );
    expect(back.status).toBe(200);
    expect((await back.json()).moments.map((m: { id: string }) => m.id)).toEqual([uuid(21), uuid(22)]);
  });

  it('passes anchor exact and centers the same bounded window', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'a@example.com', 'Aoi', TOKEN_A);
    insertUser(harness.d1, USER_B, 'b@example.com', 'Blake', TOKEN_B);
    insertSpace(harness.d1);
    insertMoment(harness.d1, uuid(31), USER_B, T0);
    insertMoment(harness.d1, uuid(32), USER_B, T0 + 1000);
    insertMoment(harness.d1, uuid(33), USER_B, T0 + 2000);
    insertMoment(harness.d1, uuid(34), USER_B, T0 + 3000);

    const res = await app.request(
      `/v1/spaces/current/moments/timeline?anchor=${uuid(33)}&limit=2`,
      { headers: auth(TOKEN_A) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // limit=2 centers half-before + anchor.
    expect(body.moments.map((m: { id: string }) => m.id)).toEqual([uuid(32), uuid(33)]);
    // Global read UI preserved (FIRST unread still oldest).
    expect(body.firstUnread.id).toBe(uuid(31));
    expect(body.unreadCount).toBe(4);
    expect(body.olderCursor).not.toBeNull();
    expect(body.newerCursor).not.toBeNull();
  });

  it('validates anchor exclusivity and 404s ineligible anchors', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'a@example.com', 'Aoi', TOKEN_A);
    insertUser(harness.d1, USER_B, 'b@example.com', 'Blake', TOKEN_B);
    insertSpace(harness.d1);
    insertMoment(harness.d1, uuid(41), USER_B, T0);
    insertMoment(harness.d1, uuid(42), USER_B, T0 + 1000, 'goal');

    const withBefore = await app.request(
      `/v1/spaces/current/moments/timeline?before=${encodeURIComponent(`${T0}|${uuid(41)}`)}&anchor=${uuid(41)}`,
      { headers: auth(TOKEN_A) }
    );
    expect(withBefore.status).toBe(400);

    const withAfter = await app.request(
      `/v1/spaces/current/moments/timeline?after=${encodeURIComponent(`${T0}|${uuid(41)}`)}&anchor=${uuid(41)}`,
      { headers: auth(TOKEN_A) }
    );
    expect(withAfter.status).toBe(400);

    const badUuid = await app.request('/v1/spaces/current/moments/timeline?anchor=not-a-uuid', {
      headers: auth(TOKEN_A),
    });
    expect(badUuid.status).toBe(400);

    const unknown = await app.request(`/v1/spaces/current/moments/timeline?anchor=${uuid(9999)}`, {
      headers: auth(TOKEN_A),
    });
    expect(unknown.status).toBe(404);

    const goal = await app.request(`/v1/spaces/current/moments/timeline?anchor=${uuid(42)}`, {
      headers: auth(TOKEN_A),
    });
    expect(goal.status).toBe(404);
  });
});
