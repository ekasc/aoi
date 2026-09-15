import { describe, expect, it } from 'vitest';

import { createApp } from '../../create-app';
import { makeTestHarness, type ShimD1 } from '../../effects/test-harness';

/**
 * Read contract the free raw-data export depends on (Astra #12). The
 * exporter uses only these already-authorized endpoints, so the boundary
 * below IS the export authorization boundary:
 * - Free users read every export dataset with no Plus anywhere;
 * - spaceless/archived callers get null current (nothing to export);
 * - sealed bodies are absent until opened, then present;
 * - tombstone authors resolve without erased identity;
 * - original media bytes require active membership.
 */

const USER_A = '00000000-0000-4000-8000-000000000001';
const USER_B = '00000000-0000-4000-8000-000000000002';
const USER_C = '00000000-0000-4000-8000-000000000003';
const TOKEN_A = 'token-a';
const TOKEN_B = 'token-b';
const TOKEN_C = 'token-c';
const NOW = Date.parse('2026-01-15T00:00:00.000Z');
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

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
    NOW + YEAR_MS,
    NOW,
    NOW
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

async function setupPairedSpace(
  app: ReturnType<typeof makeApp>['app'],
  harness: ReturnType<typeof makeApp>['harness']
): Promise<string> {
  insertUser(harness.d1, USER_A, 'aoi@example.com', 'Aoi');
  insertUser(harness.d1, USER_B, 'partner@example.com', 'Partner');
  insertSession(harness.d1, 'sess-a', USER_A, TOKEN_A);
  insertSession(harness.d1, 'sess-b', USER_B, TOKEN_B);
  const created = await app.request('/v1/spaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
    body: JSON.stringify({ name: 'Our Space', partnerName: 'Partner' }),
  });
  expect(created.status).toBe(201);
  const { inviteCode, space } = (await created.json()) as {
    inviteCode: string;
    space: { id: string };
  };
  const join = await app.request('/v1/spaces/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(TOKEN_B) },
    body: JSON.stringify({ inviteCode }),
  });
  expect(join.status).toBe(200);
  return space.id;
}

async function getJson(app: ReturnType<typeof makeApp>['app'], path: string, token: string) {
  const res = await app.request(path, { headers: auth(token) });
  expect(res.status).toBe(200);
  return res.json() as Promise<unknown>;
}

describe('export read boundary', () => {
  it('a Free user reads every export dataset with no Plus anywhere', async () => {
    const { harness, app } = makeApp();
    await setupPairedSpace(app, harness);

    await getJson(app, '/v1/spaces/current', TOKEN_A);
    await getJson(app, '/v1/spaces/current/moments?limit=100', TOKEN_A);
    await getJson(
      app,
      '/v1/spaces/current/calendar/events?from=2000-01-01T00:00:00.000Z&to=2100-01-01T00:00:00.000Z',
      TOKEN_A
    );
    await getJson(app, '/v1/spaces/current/proposals', TOKEN_A);
    await getJson(app, '/v1/spaces/current/someday', TOKEN_A);
    await getJson(app, '/v1/spaces/current/imported-milestones', TOKEN_A);
    await getJson(app, '/v1/spaces/current/question', TOKEN_A);
    await getJson(app, '/v1/spaces/current/letters', TOKEN_A);
    // Free, no entitlement row at all — reads stay 200 regardless.
    const plus = (await getJson(app, '/v1/spaces/current/plus', TOKEN_A)) as { isPlus: boolean };
    expect(plus.isPlus).toBe(false);
  });

  it('spaceless and archived callers have no current Space (nothing to export)', async () => {
    const { harness, app } = makeApp();
    await setupPairedSpace(app, harness);
    insertUser(harness.d1, USER_C, 'c@example.com', 'Cee');
    insertSession(harness.d1, 'sess-c', USER_C, TOKEN_C);

    const spaceless = (await getJson(app, '/v1/spaces/current', TOKEN_C)) as { space: null };
    expect(spaceless.space).toBeNull();

    // Solo space archived by last-member leave is invisible too.
    const created = await app.request('/v1/spaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_C) },
      body: JSON.stringify({ name: 'Solo' }),
    });
    expect(created.status).toBe(201);
    const leave = await app.request('/v1/spaces/leave', { method: 'POST', headers: auth(TOKEN_C) });
    expect(leave.status).toBe(200);
    const archived = (await getJson(app, '/v1/spaces/current', TOKEN_C)) as { space: null };
    expect(archived.space).toBeNull();
  });

  it('sealed bodies stay sealed; opened bodies read (same semantics as export)', async () => {
    const { harness, app } = makeApp();
    const spaceId = await setupPairedSpace(app, harness);
    harness.d1.runSync(
      `insert into letters (id, space_id, author_user_id, caption, body, sealed_until, created_at)
       values ('00000000-0000-4000-8000-000000000011', ?, ?, 'Later', 'not yet', ?, ?)`,
      spaceId,
      USER_A,
      NOW + YEAR_MS,
      NOW
    );
    harness.d1.runSync(
      `insert into letters (id, space_id, author_user_id, caption, body, sealed_until, created_at)
       values ('00000000-0000-4000-8000-000000000012', ?, ?, 'Now', 'opened words', ?, ?)`,
      spaceId,
      USER_A,
      NOW - 1000,
      NOW
    );
    const open = await app.request('/v1/letters/00000000-0000-4000-8000-000000000012/open', {
      method: 'POST',
      headers: auth(TOKEN_B),
    });
    expect(open.status).toBe(200);

    const shelf = (await getJson(app, '/v1/spaces/current/letters', TOKEN_B)) as {
      letters: Record<string, unknown>[];
    };
    const sealed = shelf.letters.find((l) => l.id === '00000000-0000-4000-8000-000000000011');
    const opened = shelf.letters.find((l) => l.id === '00000000-0000-4000-8000-000000000012');
    expect(sealed).toBeDefined();
    expect('body' in (sealed ?? {})).toBe(false);
    expect(opened).toMatchObject({ body: 'opened words' });
  });

  it('tombstone authors resolve without erased email/provider identity', async () => {
    const { harness, app } = makeApp();
    const spaceId = await setupPairedSpace(app, harness);
    harness.d1.runSync(
      `insert into moments (id, space_id, created_by_user_id, author_role, author_name,
         type, title, body, occurred_at, client_id, created_at, updated_at)
       values ('m-a1', ?, ?, 'you', 'Aoi', 'note', 'A memory', '', ?, 'client-m-a1', ?, ?)`,
      spaceId,
      USER_A,
      NOW,
      NOW,
      NOW
    );
    const deleted = await app.request('/v1/auth/account', { method: 'DELETE', headers: auth(TOKEN_A) });
    expect(deleted.status).toBe(200);

    const moments = (await getJson(app, '/v1/spaces/current/moments?limit=100', TOKEN_B)) as {
      moments: Record<string, unknown>[];
    };
    expect(moments.moments.map((m) => m.authorName)).toContain('Deleted member');
    expect(JSON.stringify(moments)).not.toContain('aoi@example.com');
  });

  it('original media bytes require active membership (export-grade retrieval)', async () => {
    const { harness, app } = makeApp();
    const spaceId = await setupPairedSpace(app, harness);
    insertUser(harness.d1, USER_C, 'c@example.com', 'Cee');
    insertSession(harness.d1, 'sess-c', USER_C, TOKEN_C);
    const key = 'media/00000000-0000-4000-8000-000000000021/original.png';
    harness.d1.runSync(
      `insert into media_objects (id, space_id, created_by_user_id, filename, mime_type,
         size_bytes, storage_key, upload_state, created_at)
       values ('00000000-0000-4000-8000-000000000021', ?, ?, 'lake.png', 'image/png', 4, ?, 'complete', ?)`,
      spaceId,
      USER_A,
      key,
      NOW
    );
    harness.r2.putSync(key, new Uint8Array([137, 80, 78, 71]));

    const member = await app.request(
      '/v1/media/00000000-0000-4000-8000-000000000021/object?variant=original',
      { headers: auth(TOKEN_B) }
    );
    expect(member.status).toBe(200);
    expect(new Uint8Array(await member.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));

    const outsider = await app.request(
      '/v1/media/00000000-0000-4000-8000-000000000021/object?variant=original',
      { headers: auth(TOKEN_C) }
    );
    expect([403, 404]).toContain(outsider.status);
  });
});
