import { describe, expect, it } from 'vitest';

import { createApp } from '../../create-app';
import { makeTestHarness, type ShimD1 } from '../../effects/test-harness';

/**
 * Route-level contract tests for the worker collections router — the HTTP
 * face through the worker shell (createApp + Effect runtime + error mapper +
 * session middleware). Covers create/list/patch/soft-delete for shelves and
 * items, membership gating (non-member 404), cross-space isolation, and the
 * frozen schema validation.
 */

const USER_A = '00000000-0000-4000-8000-000000000001';
const USER_B = '00000000-0000-4000-8000-000000000002';
const USER_C = '00000000-0000-4000-8000-000000000003';
const SPACE_1 = '00000000-0000-4000-8000-000000000010';
const SPACE_2 = '00000000-0000-4000-8000-000000000020';
const TOKEN_A = 'token-a';
const TOKEN_B = 'token-b';
const TOKEN_C = 'token-c';

const JAN_15 = Date.parse('2026-01-15T00:00:00.000Z');

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

function seedThree(d1: ShimD1): void {
  insertUser(d1, USER_A, 'aoi@example.com', 'Aoi');
  insertUser(d1, USER_B, 'partner@example.com', 'Partner');
  insertUser(d1, USER_C, 'other@example.com', 'Other');
  insertSession(d1, 'sess-a', USER_A, TOKEN_A);
  insertSession(d1, 'sess-b', USER_B, TOKEN_B);
  insertSession(d1, 'sess-c', USER_C, TOKEN_C);
  insertSpace(d1, SPACE_1, USER_A);
  insertMember(d1, SPACE_1, USER_B, 'partner');
  insertSpace(d1, SPACE_2, USER_C);
}

async function createShelf(app: ReturnType<typeof createApp>, token: string, body: unknown) {
  return app.request('/v1/spaces/current/collections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    body: JSON.stringify(body),
  });
}

describe('worker collections routes — shelves', () => {
  it('requires auth', async () => {
    const { app } = makeApp();
    const res = await app.request('/v1/spaces/current/collections');
    expect(res.status).toBe(401);
  });

  it('creates a shelf → 201 and lists it with an item count', async () => {
    const { harness, app } = makeApp();
    seedThree(harness.d1);

    const created = await createShelf(app, TOKEN_A, { name: 'Cafés we love', emoji: '☕' });
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.collection).toMatchObject({
      name: 'Cafés we love',
      emoji: '☕',
      position: 0,
      itemCount: 0,
      createdByUserId: USER_A,
    });
    const shelfId = createdBody.collection.id;

    await app.request(`/v1/collections/${shelfId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_B) },
      body: JSON.stringify({ title: 'Blue Bottle' }),
    });

    // Both partners see the shared shelf.
    const listed = await app.request('/v1/spaces/current/collections', { headers: auth(TOKEN_A) });
    expect(listed.status).toBe(200);
    const listBody = await listed.json();
    expect(listBody.collections).toHaveLength(1);
    expect(listBody.collections[0]).toMatchObject({ id: shelfId, itemCount: 1 });
  });

  it('patches a shelf', async () => {
    const { harness, app } = makeApp();
    seedThree(harness.d1);
    const shelfId = (await (await createShelf(app, TOKEN_A, { name: 'Cafés' })).json()).collection.id;

    const patched = await app.request(`/v1/collections/${shelfId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_B) },
      body: JSON.stringify({ name: 'Coffee', position: 3 }),
    });
    expect(patched.status).toBe(200);
    expect((await patched.json()).collection).toMatchObject({ name: 'Coffee', position: 3 });
  });

  it('soft-deletes a shelf and its items', async () => {
    const { harness, app } = makeApp();
    seedThree(harness.d1);
    const shelfId = (await (await createShelf(app, TOKEN_A, { name: 'Cafés' })).json()).collection.id;
    await app.request(`/v1/collections/${shelfId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify({ title: 'Blue Bottle' }),
    });

    const deleted = await app.request(`/v1/collections/${shelfId}`, {
      method: 'DELETE',
      headers: auth(TOKEN_B),
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ ok: true });

    const listed = await app.request('/v1/spaces/current/collections', { headers: auth(TOKEN_A) });
    expect((await listed.json()).collections).toEqual([]);

    // The shelf is gone, so its items are a 404 too.
    const items = await app.request(`/v1/collections/${shelfId}/items`, { headers: auth(TOKEN_A) });
    expect(items.status).toBe(404);
  });

  it('validates the shelf body and params', async () => {
    const { harness, app } = makeApp();
    seedThree(harness.d1);

    expect((await createShelf(app, TOKEN_A, { name: '   ' })).status).toBe(400);
    expect((await createShelf(app, TOKEN_A, { name: 'a'.repeat(61) })).status).toBe(400);

    const badParam = await app.request('/v1/collections/not-a-uuid', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify({ name: 'Coffee' }),
    });
    expect(badParam.status).toBe(400);
  });
});

describe('worker collections routes — items', () => {
  it('creates, lists, patches and deletes items', async () => {
    const { harness, app } = makeApp();
    seedThree(harness.d1);
    const shelfId = (await (await createShelf(app, TOKEN_A, { name: 'Cafés' })).json()).collection.id;

    const created = await app.request(`/v1/collections/${shelfId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_B) },
      body: JSON.stringify({ title: 'Blue Bottle', note: 'The mint one', link: 'https://example.com' }),
    });
    expect(created.status).toBe(201);
    const item = (await created.json()).item;
    expect(item).toMatchObject({
      collectionId: shelfId,
      title: 'Blue Bottle',
      note: 'The mint one',
      link: 'https://example.com',
      position: 0,
    });

    const listed = await app.request(`/v1/collections/${shelfId}/items`, { headers: auth(TOKEN_A) });
    expect(listed.status).toBe(200);
    expect((await listed.json()).items).toHaveLength(1);

    const patched = await app.request(`/v1/collection-items/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify({ title: 'Blue Bottle Coffee', note: '' }),
    });
    expect(patched.status).toBe(200);
    expect((await patched.json()).item).toMatchObject({ title: 'Blue Bottle Coffee' });

    const deleted = await app.request(`/v1/collection-items/${item.id}`, {
      method: 'DELETE',
      headers: auth(TOKEN_B),
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ ok: true });

    const after = await app.request(`/v1/collections/${shelfId}/items`, { headers: auth(TOKEN_A) });
    expect((await after.json()).items).toEqual([]);
  });

  it('validates the item body', async () => {
    const { harness, app } = makeApp();
    seedThree(harness.d1);
    const shelfId = (await (await createShelf(app, TOKEN_A, { name: 'Cafés' })).json()).collection.id;

    const blank = await app.request(`/v1/collections/${shelfId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify({ title: '   ' }),
    });
    expect(blank.status).toBe(400);

    const tooLong = await app.request(`/v1/collections/${shelfId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify({ title: 'a'.repeat(121) }),
    });
    expect(tooLong.status).toBe(400);
  });
});

describe('worker collections routes — membership + isolation', () => {
  it("a non-member gets 404 on another space's shelf and item (no existence leak)", async () => {
    const { harness, app } = makeApp();
    seedThree(harness.d1);
    const shelfId = (await (await createShelf(app, TOKEN_A, { name: 'Cafés' })).json()).collection.id;
    const item = await app.request(`/v1/collections/${shelfId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify({ title: 'Blue Bottle' }),
    });
    const itemId = (await item.json()).item.id;

    const patchShelf = await app.request(`/v1/collections/${shelfId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_C) },
      body: JSON.stringify({ name: 'Hijacked' }),
    });
    expect(patchShelf.status).toBe(404);

    const listItems = await app.request(`/v1/collections/${shelfId}/items`, { headers: auth(TOKEN_C) });
    expect(listItems.status).toBe(404);

    const patchItem = await app.request(`/v1/collection-items/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_C) },
      body: JSON.stringify({ title: 'Hijacked' }),
    });
    expect(patchItem.status).toBe(404);
  });

  it('isolates listings per space', async () => {
    const { harness, app } = makeApp();
    seedThree(harness.d1);
    await createShelf(app, TOKEN_A, { name: 'Ours' });
    await createShelf(app, TOKEN_C, { name: 'Theirs' });

    const ours = await app.request('/v1/spaces/current/collections', { headers: auth(TOKEN_A) });
    expect((await ours.json()).collections.map((c: { name: string }) => c.name)).toEqual(['Ours']);

    const theirs = await app.request('/v1/spaces/current/collections', { headers: auth(TOKEN_C) });
    expect((await theirs.json()).collections.map((c: { name: string }) => c.name)).toEqual(['Theirs']);
  });

  it('404s a missing shelf (before any membership decision)', async () => {
    const { harness, app } = makeApp();
    seedThree(harness.d1);
    const res = await app.request('/v1/collections/00000000-0000-4000-8000-0000000000ff', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify({ name: 'Coffee' }),
    });
    expect(res.status).toBe(404);
  });
});
