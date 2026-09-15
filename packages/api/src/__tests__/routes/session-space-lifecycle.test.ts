import { describe, expect, it } from 'vitest';

import { createApp } from '../../create-app';
import { makeTestHarness, type ShimD1 } from '../../effects/test-harness';

/**
 * Lifecycle contracts for spaces + account deletion through the worker
 * shell (createApp + Effect runtime + error mapper):
 * - waiting vs joined is explicit (partnerJoined), never inferred;
 * - expired invites are never presented as active;
 * - leaving preserves shared history; last-member leave archives;
 * - deleting an account revokes sessions, preserves the partner's history,
 *   archives only abandoned spaces, and kills authenticated access.
 * Shared memories are NEVER hard-deleted by any path here.
 */

const USER_A = '00000000-0000-4000-8000-000000000001';
const USER_B = '00000000-0000-4000-8000-000000000002';
const USER_C = '00000000-0000-4000-8000-000000000003';
const TOKEN_A = 'token-a';
const TOKEN_B = 'token-b';
const TOKEN_C = 'token-c';
const NOW = Date.parse('2026-01-15T00:00:00.000Z');

function insertUser(d1: ShimD1, id: string, email: string, name: string): void {
  d1.runSync(
    'insert into users (id, email, name, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?)',
    id,
    email,
    name,
    NOW,
    NOW
  );
}

function insertSession(d1: ShimD1, id: string, userId: string, token: string): void {
  d1.runSync(
    'insert into user_sessions (id, user_id, token, expires_at, created_at, updated_at) values (?, ?, ?, ?, ?, ?)',
    id,
    userId,
    token,
    Date.parse('2027-02-01T00:00:00.000Z'),
    NOW,
    NOW
  );
}

function insertMoment(d1: ShimD1, id: string, spaceId: string, userId: string, occurredAt: number): void {
  d1.runSync(
    `insert into moments (id, space_id, created_by_user_id, author_role, author_name,
       type, title, body, occurred_at, target_at, media_preview, audio_uri,
       media_id, client_id, created_at, updated_at)
     values (?, ?, ?, 'you', 'Aoi', 'note', 'A memory', '', ?, null, null, null, null, ?, ?, ?)`,
    id,
    spaceId,
    userId,
    occurredAt,
    `client-${id}`,
    occurredAt,
    occurredAt
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

function json(headers: Record<string, string>, body: unknown) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  };
}

async function createSpace(app: ReturnType<typeof makeApp>['app'], token: string, body: unknown) {
  const res = await app.request('/v1/spaces', json(auth(token), body));
  expect(res.status).toBe(201);
  return res.json() as Promise<{ space: Record<string, unknown>; inviteCode: string }>;
}

async function joinSpace(app: ReturnType<typeof makeApp>['app'], token: string, inviteCode: string) {
  return app.request('/v1/spaces/join', json(auth(token), { inviteCode }));
}

async function currentSpace(app: ReturnType<typeof makeApp>['app'], token: string) {
  const res = await app.request('/v1/spaces/current', { headers: auth(token) });
  expect(res.status).toBe(200);
  return res.json() as Promise<{ space: Record<string, unknown> | null; inviteCode: string | null }>;
}

describe('waiting vs joined space state', () => {
  it('solo space reports waiting: no fake partner, live invite, no expiry guess', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'aoi@example.com', 'Aoi');
    insertSession(harness.d1, 'sess-a', USER_A, TOKEN_A);

    const created = await createSpace(app, TOKEN_A, { name: 'Our Space' });
    expect(created.space.partnerName).toBeNull();
    expect(created.space.partnerJoined).toBe(false);

    const current = await currentSpace(app, TOKEN_A);
    expect(current.space?.partnerJoined).toBe(false);
    expect(current.space?.partnerName).toBeNull();
    expect(typeof current.space?.inviteCode).toBe('string');
    expect((current.space?.inviteCode as string).length).toBeGreaterThan(0);
    expect(typeof current.space?.inviteExpiresAt).toBe('string');
  });

  it('joined space reports partnerJoined with no invite confusion', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'aoi@example.com', 'Aoi');
    insertUser(harness.d1, USER_B, 'partner@example.com', 'Partner');
    insertSession(harness.d1, 'sess-a', USER_A, TOKEN_A);
    insertSession(harness.d1, 'sess-b', USER_B, TOKEN_B);

    const created = await createSpace(app, TOKEN_A, { name: 'Our Space' });
    const joined = await joinSpace(app, TOKEN_B, created.inviteCode);
    expect(joined.status).toBe(200);

    const creatorView = await currentSpace(app, TOKEN_A);
    expect(creatorView.space?.partnerJoined).toBe(true);
    expect(creatorView.space?.partnerName).toBe('Partner');
    // Redeemed invite is gone: no stale share action.
    expect(creatorView.space?.inviteCode).toBe('');
    expect(creatorView.space?.inviteExpiresAt).toBeNull();

    const partnerView = await currentSpace(app, TOKEN_B);
    expect(partnerView.space?.partnerJoined).toBe(true);
  });

  it('expired invites are never presented as active', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'aoi@example.com', 'Aoi');
    insertSession(harness.d1, 'sess-a', USER_A, TOKEN_A);

    const created = await createSpace(app, TOKEN_A, { name: 'Our Space' });
    const spaceId = created.space.id as string;
    harness.d1.runSync('update space_invites set expires_at = ? where space_id = ?', NOW - 1000, spaceId);

    const current = await currentSpace(app, TOKEN_A);
    expect(current.space?.partnerJoined).toBe(false);
    expect(current.space?.inviteCode).toBe('');
    expect(current.space?.inviteExpiresAt).toBeNull();
  });

  it('creator can regenerate an invite; partner cannot', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'aoi@example.com', 'Aoi');
    insertUser(harness.d1, USER_B, 'partner@example.com', 'Partner');
    insertSession(harness.d1, 'sess-a', USER_A, TOKEN_A);
    insertSession(harness.d1, 'sess-b', USER_B, TOKEN_B);

    const created = await createSpace(app, TOKEN_A, { name: 'Our Space' });
    await joinSpace(app, TOKEN_B, created.inviteCode);

    const regen = await app.request('/v1/spaces/current/invite', {
      method: 'POST',
      headers: auth(TOKEN_A),
    });
    expect(regen.status).toBe(201);
    const regenBody = await regen.json();
    expect(regenBody.inviteCode.length).toBeGreaterThan(0);

    const partnerRegen = await app.request('/v1/spaces/current/invite', {
      method: 'POST',
      headers: auth(TOKEN_B),
    });
    expect(partnerRegen.status).toBe(403);
  });
});

describe('leave space contract', () => {
  it('partner leave preserves history, frees the slot, keeps the space live', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'aoi@example.com', 'Aoi');
    insertUser(harness.d1, USER_B, 'partner@example.com', 'Partner');
    insertSession(harness.d1, 'sess-a', USER_A, TOKEN_A);
    insertSession(harness.d1, 'sess-b', USER_B, TOKEN_B);

    const created = await createSpace(app, TOKEN_A, { name: 'Our Space' });
    const spaceId = created.space.id as string;
    await joinSpace(app, TOKEN_B, created.inviteCode);
    insertMoment(harness.d1, 'm1', spaceId, USER_A, NOW);

    const left = await app.request('/v1/spaces/leave', { method: 'POST', headers: auth(TOKEN_B) });
    expect(left.status).toBe(200);

    // Leaver sees no space; creator still does, now waiting again.
    const leaverView = await currentSpace(app, TOKEN_B);
    expect(leaverView.space).toBeNull();
    const creatorView = await currentSpace(app, TOKEN_A);
    expect(creatorView.space?.id).toBe(spaceId);
    expect(creatorView.space?.partnerJoined).toBe(false);

    // Shared history untouched.
    const moment = harness.d1.rawDb.prepare('select id from moments where id = ?').get('m1');
    expect(moment).toBeTruthy();

    // Freed slot: the leaver can immediately create a new space.
    const recreated = await app.request('/v1/spaces', json(auth(TOKEN_B), { name: 'New Space' }));
    expect(recreated.status).toBe(201);
  });

  it('last-member leave archives the space; its invite dies with it', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'aoi@example.com', 'Aoi');
    insertUser(harness.d1, USER_C, 'c@example.com', 'Cee');
    insertSession(harness.d1, 'sess-a', USER_A, TOKEN_A);
    insertSession(harness.d1, 'sess-c', USER_C, TOKEN_C);

    const created = await createSpace(app, TOKEN_A, { name: 'Our Space' });
    const spaceId = created.space.id as string;
    const code = created.inviteCode;

    const left = await app.request('/v1/spaces/leave', { method: 'POST', headers: auth(TOKEN_A) });
    expect(left.status).toBe(200);

    const archived = harness.d1.rawDb
      .prepare('select archived_at from spaces where id = ?')
      .get(spaceId) as { archived_at: number | null };
    expect(archived.archived_at).not.toBeNull();

    // The abandoned invite is dead: joining fails instead of resurrecting.
    const join = await joinSpace(app, TOKEN_C, code);
    expect(join.status).toBe(404);
  });

  it('leave with no active space is a 404', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'aoi@example.com', 'Aoi');
    insertSession(harness.d1, 'sess-a', USER_A, TOKEN_A);

    const res = await app.request('/v1/spaces/leave', { method: 'POST', headers: auth(TOKEN_A) });
    expect(res.status).toBe(404);
  });
});

describe('delete account contract', () => {
  it('revokes sessions, soft-deletes, preserves partner history, kills access', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'aoi@example.com', 'Aoi');
    insertUser(harness.d1, USER_B, 'partner@example.com', 'Partner');
    insertSession(harness.d1, 'sess-a', USER_A, TOKEN_A);
    insertSession(harness.d1, 'sess-b', USER_B, TOKEN_B);

    const created = await createSpace(app, TOKEN_A, { name: 'Our Space' });
    const spaceId = created.space.id as string;
    await joinSpace(app, TOKEN_B, created.inviteCode);
    insertMoment(harness.d1, 'm1', spaceId, USER_A, NOW);

    const deleted = await app.request('/v1/auth/account', {
      method: 'DELETE',
      headers: auth(TOKEN_A),
    });
    expect(deleted.status).toBe(200);

    // Sessions revoked: the deleted token is dead everywhere.
    const sessions = harness.d1.rawDb
      .prepare('select id from user_sessions where user_id = ?')
      .all(USER_A) as unknown[];
    expect(sessions).toHaveLength(0);
    const afterDelete = await app.request('/v1/spaces/current', { headers: auth(TOKEN_A) });
    expect(afterDelete.status).toBe(401);

    // Soft-delete marker, membership flipped.
    const user = harness.d1.rawDb
      .prepare('select deleted_at from users where id = ?')
      .get(USER_A) as { deleted_at: number | null };
    expect(user.deleted_at).not.toBeNull();
    const membership = harness.d1.rawDb
      .prepare("select state from space_members where user_id = ? and space_id = ?")
      .get(USER_A, spaceId) as { state: string };
    expect(membership.state).toBe('left');

    // Partner keeps working with history intact; space NOT archived.
    const partnerView = await currentSpace(app, TOKEN_B);
    expect(partnerView.space?.id).toBe(spaceId);
    expect(partnerView.space?.partnerJoined).toBe(false);
    const moment = harness.d1.rawDb.prepare('select id from moments where id = ?').get('m1');
    expect(moment).toBeTruthy();
    const archived = harness.d1.rawDb
      .prepare('select archived_at from spaces where id = ?')
      .get(spaceId) as { archived_at: number | null };
    expect(archived.archived_at).toBeNull();
  });

  it('solo-creator delete archives the abandoned space instead of stranding it', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'aoi@example.com', 'Aoi');
    insertUser(harness.d1, USER_C, 'c@example.com', 'Cee');
    insertSession(harness.d1, 'sess-a', USER_A, TOKEN_A);
    insertSession(harness.d1, 'sess-c', USER_C, TOKEN_C);

    const created = await createSpace(app, TOKEN_A, { name: 'Our Space' });
    const spaceId = created.space.id as string;
    const code = created.inviteCode;

    const deleted = await app.request('/v1/auth/account', {
      method: 'DELETE',
      headers: auth(TOKEN_A),
    });
    expect(deleted.status).toBe(200);

    const archived = harness.d1.rawDb
      .prepare('select archived_at from spaces where id = ?')
      .get(spaceId) as { archived_at: number | null };
    expect(archived.archived_at).not.toBeNull();

    const join = await joinSpace(app, TOKEN_C, code);
    expect(join.status).toBe(404);
  });
});
