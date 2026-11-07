import { describe, expect, it } from 'vitest';

import { createApp } from '../../create-app';
import { makeTestHarness, type ShimD1 } from '../../effects/test-harness';

/**
 * Adversarial pairing-isolation integration tests (Astra's sequence).
 *
 * A creates Space → B joins → B creates history → B leaves → A invites C
 * → C attempts to join. The Worker must enforce, at the domain layer, that
 * C can never occupy B's slot nor read B's history — no UI hiding, no
 * expiry reliance, no resurrectable invites.
 */

const USER_A = '00000000-0000-4000-8000-000000000001';
const USER_B = '00000000-0000-4000-8000-000000000002';
const USER_C = '00000000-0000-4000-8000-000000000003';
const USER_D = '00000000-0000-4000-8000-000000000004';
const TOKEN_A = 'token-a';
const TOKEN_B = 'token-b';
const TOKEN_C = 'token-c';
const TOKEN_D = 'token-d';
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

function insertSession(d1: ShimD1, id: string, userId: string, token: string): void {
  d1.runSync(
    'insert into user_sessions (id, user_id, token, expires_at, created_at, updated_at) values (?, ?, ?, ?, ?, ?)',
    id,
    userId,
    token,
    T0 + 30 * 24 * 60 * 60 * 1000,
    T0,
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

function json(token: string, body: unknown, method = 'POST') {
  return {
    method,
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    body: JSON.stringify(body),
  };
}

interface Scenario {
  spaceId: string;
  code1: string;
  code2: string;
  noteId: string;
  mediaId: string;
  eventId: string;
}

/**
 * Plays the full adversarial prefix through real HTTP + real domain code:
 * A creates, B joins, B writes history across every surface, B leaves, A
 * rotates the invite. Returns ids for the read-denial assertions.
 */
async function setupAdversarialHistory(
  app: ReturnType<typeof makeApp>['app'],
  harness: ReturnType<typeof makeApp>['harness']
): Promise<Scenario> {
  insertUser(harness.d1, USER_A, 'a@example.com', 'Aoi');
  insertUser(harness.d1, USER_B, 'b@example.com', 'Blake');
  insertUser(harness.d1, USER_C, 'c@example.com', 'Casey');
  insertSession(harness.d1, 'sess-a', USER_A, TOKEN_A);
  insertSession(harness.d1, 'sess-b', USER_B, TOKEN_B);
  insertSession(harness.d1, 'sess-c', USER_C, TOKEN_C);

  const created = await app.request('/v1/spaces', json(TOKEN_A, { name: 'Our Space', partnerName: 'Partner' }));
  expect(created.status).toBe(201);
  const createdBody = (await created.json()) as { space: { id: string }; inviteCode: string };
  const spaceId = createdBody.space.id;
  const code1 = createdBody.inviteCode;

  // 1. First partner joins normally.
  const joined = await app.request('/v1/spaces/join', json(TOKEN_B, { inviteCode: code1 }));
  expect(joined.status).toBe(200);

  // B writes history on every surface.
  const note = await app.request(
    '/v1/spaces/current/moments',
    json(TOKEN_B, { type: 'note', title: 'Blake note', body: 'Blake was here' })
  );
  expect(note.status).toBe(201);
  const noteId = ((await note.json()) as { id: string }).id;

  const intent = await app.request(
    '/v1/media/upload-url',
    json(TOKEN_B, { filename: 'blake.jpg', mimeType: 'image/jpeg', sizeBytes: 4, kind: 'image' })
  );
  expect(intent.status).toBe(201);
  const { mediaId } = (await intent.json()) as { mediaId: string };
  // Storage key is server-deterministic: media/<id>/original.<ext>.
  const storageKey = `media/${mediaId}/original.jpg`;
  harness.r2.putSync(storageKey, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg');
  const complete = await app.request(`/v1/media/${mediaId}/complete`, {
    method: 'POST',
    headers: auth(TOKEN_B),
  });
  expect(complete.status).toBe(200);

  // B answers the weekly reflection + imports a goal milestone.
  const answer = await app.request(
    '/v1/spaces/current/question/answer',
    json(TOKEN_B, { answer: 'Blake weekly words' }, 'PUT')
  );
  expect(answer.status).toBe(200);

  // Plans surfaces via direct inserts (B-authored rows in B's space; the
  // read-denial paths under test are identical to HTTP-created rows).
  const eventId = '00000000-0000-4000-8000-0000000000e1';
  harness.d1.runSync(
    `insert into calendar_events (id, space_id, created_by_user_id, actor, actor_name, title,
       starts_at, ends_at, label_preset, created_at, updated_at)
     values (?, ?, ?, 'partner', 'Blake', 'Blake anniversary dinner', ?, ?, 'Date', ?, ?)`,
    eventId,
    spaceId,
    USER_B,
    T0 + 10 * 24 * 60 * 60 * 1000,
    T0 + 10 * 24 * 60 * 60 * 1000 + 3600000,
    T0,
    T0
  );
  harness.d1.runSync(
    `insert into someday_items (id, space_id, created_by_user_id, title, category, created_at)
     values ('00000000-0000-4000-8000-0000000000e3', ?, ?, 'Blake someday dream', 'place', ?)`,
    spaceId,
    USER_B,
    T0
  );
  harness.d1.runSync(
    `insert into moments (id, space_id, created_by_user_id, author_role, author_name,
       type, title, body, occurred_at, target_at, media_preview, audio_uri,
       media_id, client_id, created_at, updated_at)
     values ('00000000-0000-4000-8000-0000000000e4', ?, ?, 'partner', 'Blake',
       'goal', 'Blake summit goal', '', ?, null, null, null, null, 'client-goal-1', ?, ?)`,
    spaceId,
    USER_B,
    T0,
    T0,
    T0
  );

  // 2. B leaves.
  const left = await app.request('/v1/spaces/leave', { method: 'POST', headers: auth(TOKEN_B) });
  expect(left.status).toBe(200);

  // A rotates the invite (simulating "attempts to invite C").
  const rotated = await app.request('/v1/spaces/current/invite', {
    method: 'POST',
    headers: auth(TOKEN_A),
  });
  expect(rotated.status).toBe(201);
  const code2 = ((await rotated.json()) as { inviteCode: string }).inviteCode;
  expect(code2).not.toBe(code1);

  return { spaceId, code1, code2, noteId, mediaId, eventId };
}


