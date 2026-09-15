import { describe, expect, it } from 'vitest';

import { createApp } from '../../create-app';
import { makeTestHarness, type ShimD1 } from '../../effects/test-harness';

/**
 * Route-level contract tests for the worker spaces router
 * (`routes/session-spaces.ts`) — the HTTP face of exactly-two membership.
 * Storage-level enforcement is pinned in d1-constraints.test.ts and the
 * guarded atomic transitions in domains/spaces.test.ts; here we pin status
 * codes, the canonical error envelope, and response shapes through the
 * worker shell (createApp + Effect runtime + error mapper).
 */

const USER_A = '00000000-0000-4000-8000-000000000001';
const USER_B = '00000000-0000-4000-8000-000000000002';
const TOKEN_A = 'token-a';
const TOKEN_B = 'token-b';

function insertUser(d1: ShimD1, id: string, email: string, name: string): void {
  d1.runSync(
    'insert into users (id, email, name, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?)',
    id,
    email,
    name,
    Date.parse('2026-01-15T00:00:00.000Z'),
    Date.parse('2026-01-15T00:00:00.000Z')
  );
}

function insertSession(d1: ShimD1, id: string, userId: string, token: string): void {
  d1.runSync(
    'insert into user_sessions (id, user_id, token, expires_at, created_at, updated_at) values (?, ?, ?, ?, ?, ?)',
    id,
    userId,
    token,
    Date.parse('2026-02-01T00:00:00.000Z'),
    Date.parse('2026-01-15T00:00:00.000Z'),
    Date.parse('2026-01-15T00:00:00.000Z')
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

const CREATE_BODY = {
  name: 'Our Space',
  partnerName: 'Partner',
  relationshipStartDate: '2026-01-15',
};

describe('worker spaces routes (exactly-two membership over HTTP)', () => {
  it('GET /v1/spaces/current → 401 without a token', async () => {
    const { app } = makeApp();
    const res = await app.request('/v1/spaces/current');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('POST /v1/spaces → 201 + invite; GET /v1/spaces/current returns the space', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'aoi@example.com', 'Aoi');
    insertSession(harness.d1, 'sess-a', USER_A, TOKEN_A);

    const created = await app.request('/v1/spaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify(CREATE_BODY),
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.space.name).toBe('Our Space');
    expect(createdBody.space.partnerName).toBe('Partner');
    expect(createdBody.space.relationshipStartDate).toBe('2026-01-15');
    expect(createdBody.space.createdByUserId).toBe(USER_A);
    expect(createdBody.inviteCode.length).toBeGreaterThan(0);

    const current = await app.request('/v1/spaces/current', { headers: auth(TOKEN_A) });
    expect(current.status).toBe(200);
    const currentBody = await current.json();
    expect(currentBody.space.id).toBe(createdBody.space.id);
    expect(currentBody.space.inviteCode).toBe(createdBody.inviteCode);
  });

  it('rejects a date in ISO format with a 400 (contract requires YYYY-MM-DD)', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'aoi@example.com', 'Aoi');
    insertSession(harness.d1, 'sess-a', USER_A, TOKEN_A);

    const res = await app.request('/v1/spaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify({ ...CREATE_BODY, relationshipStartDate: '2026-01-15T00:00:00.000Z' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('second create from the same user → 409 (partial unique enforcement)', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'aoi@example.com', 'Aoi');
    insertSession(harness.d1, 'sess-a', USER_A, TOKEN_A);

    const first = await app.request('/v1/spaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify(CREATE_BODY),
    });
    expect(first.status).toBe(201);

    const second = await app.request('/v1/spaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify(CREATE_BODY),
    });
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.error.code).toBe('CONFLICT');
  });

  it('join redeems the invite once; a second partner gets 409 (partner slot)', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'aoi@example.com', 'Aoi');
    insertUser(harness.d1, USER_B, 'partner@example.com', 'Partner');
    insertSession(harness.d1, 'sess-a', USER_A, TOKEN_A);
    insertSession(harness.d1, 'sess-b', USER_B, TOKEN_B);

    const created = await app.request('/v1/spaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify(CREATE_BODY),
    });
    const { inviteCode } = await created.json();

    const join = await app.request('/v1/spaces/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_B) },
      body: JSON.stringify({ inviteCode }),
    });
    expect(join.status).toBe(200);
    const joinBody = await join.json();
    expect(joinBody.space.partnerName).toBe('Partner');

    // A third user (none exists) — the partner slot is full; simulate a
    // third member via a second join attempt by another user.
    const USER_C = '00000000-0000-4000-8000-000000000003';
    insertUser(harness.d1, USER_C, 'third@example.com', 'Third');
    insertSession(harness.d1, 'sess-c', USER_C, 'token-c');
    const again = await app.request('/v1/spaces/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth('token-c') },
      body: JSON.stringify({ inviteCode }),
    });
    expect(again.status).toBe(400); // invite already redeemed (guarded redeem)
    const body = await again.json();
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('leave frees the active slot so the user can create a new space', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'aoi@example.com', 'Aoi');
    insertSession(harness.d1, 'sess-a', USER_A, TOKEN_A);

    await app.request('/v1/spaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify(CREATE_BODY),
    });

    const leave = await app.request('/v1/spaces/leave', {
      method: 'POST',
      headers: auth(TOKEN_A),
    });
    expect(leave.status).toBe(200);
    expect(await leave.json()).toEqual({ ok: true });

    const current = await app.request('/v1/spaces/current', { headers: auth(TOKEN_A) });
    expect((await current.json()).space).toBeNull();

    const recreate = await app.request('/v1/spaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify({ ...CREATE_BODY, name: 'Second Space' }),
    });
    expect(recreate.status).toBe(201);
  });

  it('PATCH /v1/spaces/current is creator-only (partner → 403)', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'aoi@example.com', 'Aoi');
    insertUser(harness.d1, USER_B, 'partner@example.com', 'Partner');
    insertSession(harness.d1, 'sess-a', USER_A, TOKEN_A);
    insertSession(harness.d1, 'sess-b', USER_B, TOKEN_B);

    const created = await app.request('/v1/spaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify(CREATE_BODY),
    });
    const { inviteCode } = await created.json();
    await app.request('/v1/spaces/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_B) },
      body: JSON.stringify({ inviteCode }),
    });

    const partnerPatch = await app.request('/v1/spaces/current', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_B) },
      body: JSON.stringify({ name: 'Hijacked' }),
    });
    expect(partnerPatch.status).toBe(403);
    const body = await partnerPatch.json();
    expect(body.error.code).toBe('FORBIDDEN');

    const creatorPatch = await app.request('/v1/spaces/current', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify({ name: 'Renamed' }),
    });
    expect(creatorPatch.status).toBe(200);
    expect((await creatorPatch.json()).space.name).toBe('Renamed');
  });
});

describe('optional partner name / start date (P3 nullable contract)', () => {
  type TestApp = ReturnType<typeof makeApp>['app'];
  function postSpace(app: TestApp, token: string, body: unknown) {
    return app.request('/v1/spaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(token) },
      body: JSON.stringify(body),
    });
  }

  it('creates with neither partner name nor start date; absence stays null', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'aoi@example.com', 'Aoi');
    insertSession(harness.d1, 'sess-a', USER_A, TOKEN_A);

    const res = await postSpace(app, TOKEN_A, { name: 'Our Space' });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.space.partnerName).toBeNull();
    expect(body.space.relationshipStartDate).toBeNull();
    expect(body.space.name).toBe('Our Space');

    // Persisted + re-readable without null crashes.
    const current = await app.request('/v1/spaces/current', { headers: auth(TOKEN_A) });
    expect(current.status).toBe(200);
    const currentBody = await current.json();
    expect(currentBody.space.partnerName).toBeNull();
    expect(currentBody.space.relationshipStartDate).toBeNull();

    const row = harness.d1.rawDb
      .prepare('select partner_name, relationship_start_date from spaces where id = ?')
      .get(body.space.id) as { partner_name: unknown; relationship_start_date: unknown };
    expect(row.partner_name).toBeNull();
    expect(row.relationship_start_date).toBeNull();
  });

  it('creates with a partner name but no start date', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'aoi@example.com', 'Aoi');
    insertSession(harness.d1, 'sess-a', USER_A, TOKEN_A);

    const res = await postSpace(app, TOKEN_A, { name: 'Our Space', partnerName: 'Partner' });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.space.partnerName).toBe('Partner');
    expect(body.space.relationshipStartDate).toBeNull();
  });

  it('creates with a start date but no partner name', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'aoi@example.com', 'Aoi');
    insertSession(harness.d1, 'sess-a', USER_A, TOKEN_A);

    const res = await postSpace(app, TOKEN_A, { name: 'Our Space', relationshipStartDate: '2024-06-01' });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.space.partnerName).toBeNull();
    expect(body.space.relationshipStartDate).toBe('2024-06-01');
  });

  it('still rejects empty-string sentinels and malformed dates', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'aoi@example.com', 'Aoi');
    insertSession(harness.d1, 'sess-a', USER_A, TOKEN_A);

    const emptyPartner = await postSpace(app, TOKEN_A, { name: 'Our Space', partnerName: '' });
    expect(emptyPartner.status).toBe(400);

    const emptyDate = await postSpace(app, TOKEN_A, { name: 'Our Space', relationshipStartDate: '' });
    expect(emptyDate.status).toBe(400);
  });

  it('join after a partnerless create fills the partner name from the account', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'aoi@example.com', 'Aoi');
    insertUser(harness.d1, USER_B, 'partner@example.com', 'Partner');
    insertSession(harness.d1, 'sess-a', USER_A, TOKEN_A);
    insertSession(harness.d1, 'sess-b', USER_B, TOKEN_B);

    const created = await postSpace(app, TOKEN_A, { name: 'Our Space' });
    expect(created.status).toBe(201);
    const { inviteCode } = await created.json();

    const join = await app.request('/v1/spaces/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_B) },
      body: JSON.stringify({ inviteCode }),
    });
    expect(join.status).toBe(200);
    const joinBody = await join.json();
    expect(joinBody.space.partnerName).toBe('Partner');
    expect(joinBody.space.relationshipStartDate).toBeNull();
  });
});
