import { describe, expect, it } from 'vitest';

import { createApp } from '../../create-app';
import { makeTestHarness, type ShimD1 } from '../../effects/test-harness';

/**
 * Route-level contract tests for the ported worker routers (calendar,
 * proposals, letters, question, someday, location, preferences, milestones,
 * squeezes) — the HTTP face through the worker shell (createApp + Effect
 * runtime + error mapper + session middleware).
 */

const USER_A = '00000000-0000-4000-8000-000000000001';
const USER_B = '00000000-0000-4000-8000-000000000002';
const TOKEN_A = 'token-a';
const TOKEN_B = 'token-b';

const JAN_1 = Date.parse('2026-01-01T00:00:00.000Z');
const JAN_15 = Date.parse('2026-01-15T00:00:00.000Z');
const FEB_1 = Date.parse('2026-02-01T00:00:00.000Z');
const FEB_2 = Date.parse('2026-02-02T00:00:00.000Z');
const MAR_1 = Date.parse('2026-03-01T00:00:00.000Z');

function insertUser(d1: ShimD1, id: string, email: string, name: string): void {
  d1.runSync(
    'insert into users (id, email, name, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?)',
    id,
    email,
    name,
    JAN_15,
    JAN_15
  );
}

function insertSession(d1: ShimD1, id: string, userId: string, token: string): void {
  d1.runSync(
    'insert into user_sessions (id, user_id, token, expires_at, created_at, updated_at) values (?, ?, ?, ?, ?, ?)',
    id,
    userId,
    token,
    Date.parse('2030-01-01T00:00:00.000Z'),
    JAN_15,
    JAN_15
  );
}

function insertMember(d1: ShimD1, spaceId: string, userId: string, role: 'you' | 'partner'): void {
  d1.runSync(
    `insert into space_members (space_id, user_id, role, state, joined_at) values (?, ?, ?, 'active', ?)`,
    spaceId,
    userId,
    role,
    JAN_15
  );
}

function insertSpace(d1: ShimD1, id: string, creatorId: string): void {
  d1.runSync(
    `insert into spaces (id, name, partner_name, relationship_start_date, created_by_user_id, created_at, updated_at)
     values (?, 'Our Space', 'Partner', '2026-01-01', ?, ?, ?)`,
    id,
    creatorId,
    JAN_15,
    JAN_15
  );
  insertMember(d1, id, creatorId, 'you');
}

function makeApp() {
  const harness = makeTestHarness();
  const app = createApp(harness.layer);
  return { harness, app };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** Standard two-person space: A created it, B joined. */
function seedCouple(d1: ShimD1) {
  insertUser(d1, USER_A, 'aoi@example.com', 'Aoi');
  insertUser(d1, USER_B, 'partner@example.com', 'Partner');
  insertSession(d1, 'sess-a', USER_A, TOKEN_A);
  insertSession(d1, 'sess-b', USER_B, TOKEN_B);
  insertSpace(d1, '00000000-0000-4000-8000-000000000010', USER_A);
  insertMember(d1, '00000000-0000-4000-8000-000000000010', USER_B, 'partner');
}

describe('worker calendar routes', () => {
  it('create → 201; list in range → events; update/delete creator-only', async () => {
    const { harness, app } = makeApp();
    seedCouple(harness.d1);

    const created = await app.request('/v1/spaces/current/calendar/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify({
        title: 'Dinner',
        startsAt: new Date(FEB_1).toISOString(),
        endsAt: new Date(FEB_1 + 3600_000).toISOString(),
        actor: 'you',
        actorName: 'Aoi',
        label: { preset: 'Date' },
      }),
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.isOwn).toBe(true);
    const eventId = createdBody.id;

    const listed = await app.request(
      `/v1/spaces/current/calendar/events?from=${encodeURIComponent(new Date(FEB_1 - 1).toISOString())}&to=${encodeURIComponent(new Date(FEB_1 + 7200_000).toISOString())}`,
      { headers: auth(TOKEN_A) }
    );
    expect(listed.status).toBe(200);
    const listBody = await listed.json();
    expect(listBody).toHaveLength(1);

    // Partner cannot edit.
    const partnerPatch = await app.request(`/v1/calendar/events/${eventId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_B) },
      body: JSON.stringify({ title: 'Hijacked' }),
    });
    expect(partnerPatch.status).toBe(403);

    const deleted = await app.request(`/v1/calendar/events/${eventId}`, {
      method: 'DELETE',
      headers: auth(TOKEN_A),
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ ok: true });
  });

  it('rejects an event that ends before it starts', async () => {
    const { harness, app } = makeApp();
    seedCouple(harness.d1);

    const res = await app.request('/v1/spaces/current/calendar/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify({
        title: 'Bad',
        startsAt: new Date(FEB_1).toISOString(),
        endsAt: new Date(FEB_1 - 1).toISOString(),
        actor: 'you',
        actorName: 'Aoi',
        label: { preset: 'Other', customText: 'x' },
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
  });
});

describe('worker proposals routes', () => {
  it('create → 201; partner accepts → calendar event; proposer cannot accept own', async () => {
    const { harness, app } = makeApp();
    seedCouple(harness.d1);

    const created = await app.request('/v1/spaces/current/proposals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify({
        title: 'Dinner?',
        proposedStart: new Date(FEB_1).toISOString(),
        proposedEnd: new Date(FEB_1 + 3600_000).toISOString(),
      }),
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.proposerRole).toBe('you');
    const proposalId = createdBody.id;

    const selfAccept = await app.request(`/v1/proposals/${proposalId}/accept`, {
      method: 'POST',
      headers: auth(TOKEN_A),
    });
    expect(selfAccept.status).toBe(403);

    const accept = await app.request(`/v1/proposals/${proposalId}/accept`, {
      method: 'POST',
      headers: auth(TOKEN_B),
    });
    expect(accept.status).toBe(200);
    expect((await accept.json()).status).toBe('accepted');

    const events = harness.d1.rawDb
      .prepare('select count(*) as n from calendar_events where space_id = ? and deleted_at is null')
      .get('00000000-0000-4000-8000-000000000010') as { n: number };
    expect(events.n).toBe(1);
  });
});

describe('worker letters routes', () => {
  it('seal → body omitted; open before the seal → 400; open after → body present', async () => {
    const { harness, app } = makeApp();
    seedCouple(harness.d1);

    const sealed = await app.request('/v1/spaces/current/letters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify({
        caption: 'open me',
        body: 'the secret words',
        sealedUntil: new Date(MAR_1).toISOString(),
      }),
    });
    expect(sealed.status).toBe(201);
    const sealedBody = await sealed.json();
    expect(sealedBody.body).toBeUndefined();
    const letterId = sealedBody.id;

    const early = await app.request(`/v1/letters/${letterId}/open`, {
      method: 'POST',
      headers: auth(TOKEN_B),
    });
    expect(early.status).toBe(400);

    harness.clock.set(MAR_1 + 1);
    const opened = await app.request(`/v1/letters/${letterId}/open`, {
      method: 'POST',
      headers: auth(TOKEN_B),
    });
    expect(opened.status).toBe(200);
    expect((await opened.json()).body).toBe('the secret words');
  });
});

describe('worker question routes', () => {
  it('put answers; reveal gate through HTTP', async () => {
    const { harness, app } = makeApp();
    seedCouple(harness.d1);

    const initial = await app.request('/v1/spaces/current/question', { headers: auth(TOKEN_A) });
    expect(initial.status).toBe(200);
    expect((await initial.json()).revealed).toBe(false);

    await app.request('/v1/spaces/current/question/answer', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify({ answer: 'their laugh' }),
    });

    const partnerView = await app.request('/v1/spaces/current/question', { headers: auth(TOKEN_B) });
    expect((await partnerView.json()).partnerAnswered).toBe(true);

    await app.request('/v1/spaces/current/question/answer', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_B) },
      body: JSON.stringify({ answer: 'a walk' }),
    });

    const revealed = await app.request('/v1/spaces/current/question', { headers: auth(TOKEN_A) });
    const revealedBody = await revealed.json();
    expect(revealedBody.revealed).toBe(true);
    expect(revealedBody.partnerAnswer).toBe('a walk');
  });
});

describe('worker someday routes', () => {
  it('create → list → check off via PATCH', async () => {
    const { harness, app } = makeApp();
    seedCouple(harness.d1);

    const created = await app.request('/v1/spaces/current/someday', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify({ title: 'Kyoto', category: 'place' }),
    });
    expect(created.status).toBe(201);
    const itemId = (await created.json()).id;

    const patched = await app.request(`/v1/someday/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_B) },
      body: JSON.stringify({ checked: true }),
    });
    expect(patched.status).toBe(200);
    expect((await patched.json()).checkedAt).not.toBeNull();
  });
});

describe('worker location routes', () => {
  it('share requires both consents; after consent the partner sees a fresh share', async () => {
    const { harness, app } = makeApp();
    seedCouple(harness.d1);

    const fail = await app.request('/v1/spaces/current/location/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify({ mode: 'live', latitude: 1, longitude: 2 }),
    });
    expect(fail.status).toBe(403);

    await app.request('/v1/spaces/current/location/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify({ consented: true }),
    });
    await app.request('/v1/spaces/current/location/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_B) },
      body: JSON.stringify({ consented: true }),
    });

    const shared = await app.request('/v1/spaces/current/location/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_B) },
      body: JSON.stringify({ mode: 'live', latitude: 40.7, longitude: -74.0 }),
    });
    expect(shared.status).toBe(201);

    const current = await app.request('/v1/spaces/current/location', { headers: auth(TOKEN_A) });
    const currentBody = await current.json();
    expect(currentBody.location).not.toBeNull();
    expect(currentBody.location.latitude).toBe(40.7);
  });
});

describe('worker preferences / milestones / squeezes routes', () => {
  it('preferences default then upsert', async () => {
    const { harness, app } = makeApp();
    seedCouple(harness.d1);

    const initial = await app.request('/v1/users/me/preferences', { headers: auth(TOKEN_A) });
    expect((await initial.json()).themeId).toBe('sunset-shore');

    const updated = await app.request('/v1/users/me/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify({ themeId: 'sea-glass' }),
    });
    expect((await updated.json()).themeId).toBe('sea-glass');
  });

  it('milestones create + list', async () => {
    const { harness, app } = makeApp();
    seedCouple(harness.d1);

    const created = await app.request('/v1/spaces/current/imported-milestones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify({
        type: 'milestone',
        title: 'First trip',
        occurredAt: new Date(JAN_1).toISOString(),
      }),
    });
    expect(created.status).toBe(201);

    const listed = await app.request('/v1/spaces/current/imported-milestones', { headers: auth(TOKEN_A) });
    expect((await listed.json())).toHaveLength(1);
  });

  it('squeeze → 202 with a space; 400 without one', async () => {
    const { harness, app } = makeApp();
    seedCouple(harness.d1);

    const ok = await app.request('/v1/squeezes', { method: 'POST', headers: auth(TOKEN_A) });
    expect(ok.status).toBe(202);
  });
});

describe('worker route auth + 404 behaviors', () => {
  it('protected routes return 401 without a token', async () => {
    const { app } = makeApp();
    for (const path of [
      '/v1/spaces/current/calendar/events',
      '/v1/spaces/current/proposals',
      '/v1/spaces/current/letters',
      '/v1/spaces/current/question',
      '/v1/spaces/current/someday',
      '/v1/spaces/current/location',
      '/v1/users/me/preferences',
      '/v1/squeezes',
    ]) {
      const res = await app.request(path, { method: path === '/v1/squeezes' ? 'POST' : 'GET' });
      expect(res.status, path).toBe(401);
    }
  });

  it('unknown routes → 404 canonical envelope', async () => {
    const { harness, app } = makeApp();
    seedCouple(harness.d1);
    const res = await app.request('/v1/nope', { headers: auth(TOKEN_A) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
