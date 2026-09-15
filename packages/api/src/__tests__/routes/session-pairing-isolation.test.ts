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
  letterId: string;
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

  const created = await app.request('/v1/spaces', json(TOKEN_A, { name: 'Our Space' }));
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

  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const letter = await app.request(
    '/v1/spaces/current/letters',
    json(TOKEN_B, { caption: 'For Aoi', body: 'Blake secret words', sealedUntil: future })
  );
  expect(letter.status).toBe(201);
  const letterId = ((await letter.json()) as { id: string }).id;

  // B answers the weekly reflection + imports a goal milestone.
  const answer = await app.request(
    '/v1/spaces/current/question/answer',
    json(TOKEN_B, { answer: 'Blake weekly words' }, 'PUT')
  );
  expect(answer.status).toBe(200);
  harness.d1.runSync(
    `insert into imported_milestones (id, space_id, created_by_user_id, type, title, body,
       occurred_at, target_at, created_at)
     values ('00000000-0000-4000-8000-0000000000e5', ?, ?, 'goal', 'Blake imported goal', '', ?, null, ?)`,
    spaceId,
    USER_B,
    T0,
    T0
  );

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
    `insert into event_proposals (id, space_id, proposer_user_id, title, proposed_start, proposed_end, created_at)
     values ('00000000-0000-4000-8000-0000000000e2', ?, ?, 'Blake proposal', ?, ?, ?)`,
    spaceId,
    USER_B,
    T0 + 11 * 24 * 60 * 60 * 1000,
    T0 + 11 * 24 * 60 * 60 * 1000 + 3600000,
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

  return { spaceId, code1, code2, noteId, mediaId, letterId, eventId };
}

describe('adversarial pairing isolation (A/B/C over HTTP)', () => {
  it('C cannot join the same historical Space (403), via fresh or rotated code', async () => {
    const { harness, app } = makeApp();
    const { code1, code2 } = await setupAdversarialHistory(app, harness);

    const fresh = await app.request('/v1/spaces/join', json(TOKEN_C, { inviteCode: code2 }));
    expect(fresh.status).toBe(403);
    expect((await fresh.json()).error.code).toBe('FORBIDDEN');

    const rotated = await app.request('/v1/spaces/join', json(TOKEN_C, { inviteCode: code1 }));
    // code1 was already redeemed by B: the guarded redeem rejects it. Either
    // way C is refused — what matters is the slot never opens for C.
    expect(rotated.status).toBe(400);

    // C holds no membership anywhere near that space.
    const members = harness.d1.rawDb
      .prepare('select count(*) as n from space_members where user_id = ?')
      .get(USER_C) as { n: number };
    expect(members).toEqual({ n: 0 });
  });

  it("C cannot read B's notes (list + direct id)", async () => {
    const { harness, app } = makeApp();
    const { noteId } = await setupAdversarialHistory(app, harness);

    const list = await app.request('/v1/spaces/current/moments', { headers: auth(TOKEN_C) });
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { moments: { id: string; body: string }[] };
    expect(listBody.moments.map((m) => m.id)).not.toContain(noteId);
    expect(JSON.stringify(listBody)).not.toContain('Blake was here');

    const direct = await app.request(`/v1/moments/${noteId}`, { headers: auth(TOKEN_C) });
    expect([403, 404]).toContain(direct.status);
  });

  it("C cannot read B's media object", async () => {
    const { harness, app } = makeApp();
    const { mediaId } = await setupAdversarialHistory(app, harness);

    const res = await app.request(`/v1/media/${mediaId}/object?variant=original`, {
      headers: auth(TOKEN_C),
    });
    expect([403, 404]).toContain(res.status);
  });

  it("C cannot read letters, plans, goals, Someday, chapters, or metadata", async () => {
    const { harness, app } = makeApp();
    const s = await setupAdversarialHistory(app, harness);

    // Letters shelf: C's own (empty) scope only.
    const shelf = await app.request('/v1/spaces/current/letters', { headers: auth(TOKEN_C) });
    expect(shelf.status).toBe(200);
    expect(JSON.stringify(await shelf.json())).not.toContain('Blake secret words');

    // Sealed open attempt: indistinguishable from missing.
    const open = await app.request(`/v1/letters/${s.letterId}/open`, {
      method: 'POST',
      headers: auth(TOKEN_C),
    });
    expect(open.status).toBe(404);

    // Plans surfaces: empty scope, direct ids rejected.
    const events = await app.request(
      '/v1/spaces/current/calendar/events?from=2026-01-01T00:00:00.000Z&to=2027-01-01T00:00:00.000Z',
      {
        headers: auth(TOKEN_C),
      }
    );
    expect(events.status).toBe(200);
    expect(JSON.stringify(await events.json())).not.toContain('Blake anniversary dinner');
    const eventById = await app.request(`/v1/calendar/events/${s.eventId}`, {
      headers: auth(TOKEN_C),
    });
    expect([403, 404]).toContain(eventById.status);

    const proposals = await app.request('/v1/spaces/current/proposals', {
      headers: auth(TOKEN_C),
    });
    expect(proposals.status).toBe(200);
    expect(JSON.stringify(await proposals.json())).not.toContain('Blake proposal');

    const someday = await app.request('/v1/spaces/current/someday', {
      headers: auth(TOKEN_C),
    });
    expect(someday.status).toBe(200);
    expect(JSON.stringify(await someday.json())).not.toContain('Blake someday dream');

    // Goals + chapters/range/summary derive from the same scoped reads.
    const goals = await app.request('/v1/spaces/current/moments?type=goal', {
      headers: auth(TOKEN_C),
    });
    expect(goals.status).toBe(200);
    expect(JSON.stringify(await goals.json())).not.toContain('Blake summit goal');

    const summary = await app.request(
      '/v1/spaces/current/moments/summary?buckets=1767225600000%3A1782777600000',
      {
        headers: auth(TOKEN_C),
      }
    );
    expect(summary.status).toBe(200);
    const summaryBody = (await summary.json()) as { buckets: unknown[]; hasOlder: boolean };
    expect(summaryBody.buckets).toEqual([]);
    expect(summaryBody.hasOlder).toBe(false);

    // Current-space metadata: C belongs nowhere.
    const current = await app.request('/v1/spaces/current', { headers: auth(TOKEN_C) });
    expect(current.status).toBe(200);
    expect((await current.json()).space).toBeNull();
  });

  it('A retains full access to the existing history', async () => {
    const { harness, app } = makeApp();
    const s = await setupAdversarialHistory(app, harness);

    const current = await app.request('/v1/spaces/current', { headers: auth(TOKEN_A) });
    expect(current.status).toBe(200);
    expect(((await current.json()) as { space: { id: string } }).space.id).toBe(s.spaceId);

    const list = await app.request('/v1/spaces/current/moments', { headers: auth(TOKEN_A) });
    const listBody = (await list.json()) as { moments: { id: string }[] };
    expect(listBody.moments.map((m) => m.id)).toContain(s.noteId);

    const media = await app.request(`/v1/media/${s.mediaId}/object?variant=original`, {
      headers: auth(TOKEN_A),
    });
    expect(media.status).toBe(200);

    const eventById = await app.request(`/v1/calendar/events/${s.eventId}`, {
      headers: auth(TOKEN_A),
    });
    expect(eventById.status).toBe(200);
  });
});

describe('invite rotation semantics', () => {
  it('rotation revokes the old code; only the new one works', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'a@example.com', 'Aoi');
    insertUser(harness.d1, USER_B, 'b@example.com', 'Bob');
    insertSession(harness.d1, 'sess-a', USER_A, TOKEN_A);
    insertSession(harness.d1, 'sess-b', USER_B, TOKEN_B);

    const created = await app.request('/v1/spaces', json(TOKEN_A, { name: 'Our Space' }));
    expect(created.status).toBe(201);
    const code1 = ((await created.json()) as { inviteCode: string }).inviteCode;

    const rotated = await app.request('/v1/spaces/current/invite', {
      method: 'POST',
      headers: auth(TOKEN_A),
    });
    expect(rotated.status).toBe(201);
    const code2 = ((await rotated.json()) as { inviteCode: string }).inviteCode;
    expect(code2).not.toBe(code1);

    const revoked = harness.d1.rawDb
      .prepare('select revoked_at from space_invites where code_normalized = ?')
      .get(code1) as { revoked_at: number | null };
    expect(typeof revoked.revoked_at).toBe('number');

    // Old code is dead.
    const stale = await app.request('/v1/spaces/join', json(TOKEN_B, { inviteCode: code1 }));
    expect(stale.status).toBe(404);

    // Only the new code admits the first partner.
    const joined = await app.request('/v1/spaces/join', json(TOKEN_B, { inviteCode: code2 }));
    expect(joined.status).toBe(200);
  });

  it('double rotation leaves exactly one live code', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'a@example.com', 'Aoi');
    insertSession(harness.d1, 'sess-a', USER_A, TOKEN_A);

    const created = await app.request('/v1/spaces', json(TOKEN_A, { name: 'Our Space' }));
    const code1 = ((await created.json()) as { inviteCode: string }).inviteCode;
    const r2 = await app.request('/v1/spaces/current/invite', { method: 'POST', headers: auth(TOKEN_A) });
    const code2 = ((await r2.json()) as { inviteCode: string }).inviteCode;
    const r3 = await app.request('/v1/spaces/current/invite', { method: 'POST', headers: auth(TOKEN_A) });
    const code3 = ((await r3.json()) as { inviteCode: string }).inviteCode;

    const live = harness.d1.rawDb
      .prepare(
        "select code_normalized from space_invites where redeemed_at is null and revoked_at is null"
      )
      .all() as { code_normalized: string }[];
    expect(live.map((row) => row.code_normalized)).toEqual([code3]);
    expect(new Set([code1, code2, code3]).size).toBe(3);
  });

  it('concurrent rotation vs redemption has one deterministic winner, never two members', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'a@example.com', 'Aoi');
    insertUser(harness.d1, USER_B, 'b@example.com', 'Bob');
    insertUser(harness.d1, USER_C, 'c@example.com', 'Casey');
    insertSession(harness.d1, 'sess-a', USER_A, TOKEN_A);
    insertSession(harness.d1, 'sess-b', USER_B, TOKEN_B);
    insertSession(harness.d1, 'sess-c', USER_C, TOKEN_C);

    const created = await app.request('/v1/spaces', json(TOKEN_A, { name: 'Our Space' }));
    const code1 = ((await created.json()) as { inviteCode: string }).inviteCode;

    // Rotation and redemption race on the same code: exactly one wins, and
    // the space never ends up with two partners or a broken invite row.
    const [joinRes, rotateRes] = await Promise.all([
      app.request('/v1/spaces/join', json(TOKEN_B, { inviteCode: code1 })),
      app.request('/v1/spaces/current/invite', { method: 'POST', headers: auth(TOKEN_A) }),
    ]);
    expect(joinRes.status).toBeLessThan(500);
    expect(rotateRes.status).toBe(201);

    const partners = harness.d1.rawDb
      .prepare("select user_id from space_members where role = 'partner' and state = 'active'")
      .all() as { user_id: string }[];
    expect(partners.length).toBeLessThanOrEqual(1);

    if (joinRes.status === 200) {
      // Join won: code2 exists alongside a redeemed code1; slot is filled.
      expect(partners).toEqual([{ user_id: USER_B }]);
    } else {
      // Rotation won: code1 is revoked, join failed closed, slot is empty.
      expect(joinRes.status).toBe(404);
      expect(partners).toEqual([]);
    }
  });

  it('archived spaces cannot be resurrected through any invite', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'a@example.com', 'Aoi');
    insertUser(harness.d1, USER_D, 'd@example.com', 'Dana');
    insertSession(harness.d1, 'sess-a', USER_A, TOKEN_A);
    insertSession(harness.d1, 'sess-d', USER_D, TOKEN_D);

    const created = await app.request('/v1/spaces', json(TOKEN_A, { name: 'Our Space' }));
    const code1 = ((await created.json()) as { inviteCode: string }).inviteCode;

    // Sole member leaves → archive (P7A last-member rule).
    const left = await app.request('/v1/spaces/leave', { method: 'POST', headers: auth(TOKEN_A) });
    expect(left.status).toBe(200);
    const archived = harness.d1.rawDb
      .prepare('select archived_at from spaces')
      .get() as { archived_at: number | null };
    expect(typeof archived.archived_at).toBe('number');

    const join = await app.request('/v1/spaces/join', json(TOKEN_D, { inviteCode: code1 }));
    expect(join.status).toBe(404);
  });
});

describe('pairing isolation closure gaps (findings #1/#5)', () => {
  it("C cannot read B's reflection answers, imported milestones, or activity", async () => {
    const { harness, app } = makeApp();
    await setupAdversarialHistory(app, harness);

    const question = await app.request('/v1/spaces/current/question', { headers: auth(TOKEN_C) });
    expect(question.status).toBe(200);
    expect(JSON.stringify(await question.json())).not.toContain('Blake weekly words');

    const milestones = await app.request('/v1/spaces/current/imported-milestones', {
      headers: auth(TOKEN_C),
    });
    expect(milestones.status).toBe(200);
    expect(JSON.stringify(await milestones.json())).not.toContain('Blake imported goal');

    const activity = await app.request('/v1/spaces/current/activity', { headers: auth(TOKEN_C) });
    expect(activity.status).toBe(200);
    expect((await activity.json()) as { activity: unknown[] }).toEqual({ activity: [] });
  });

  it("C cannot read B's media display variant either", async () => {
    const { harness, app } = makeApp();
    const { mediaId } = await setupAdversarialHistory(app, harness);

    // Display variant does not exist for this object (no sanitize run), but
    // the membership gate fires first either way — never the bytes.
    const res = await app.request(`/v1/media/${mediaId}/object?variant=display`, {
      headers: auth(TOKEN_C),
    });
    expect([400, 403, 404]).toContain(res.status);
  });

  it('C is not globally tainted: a new unbound pairing still works for C', async () => {
    const { harness, app } = makeApp();
    await setupAdversarialHistory(app, harness);
    insertUser(harness.d1, USER_D, 'd@example.com', 'Dana');
    insertSession(harness.d1, 'sess-d', USER_D, TOKEN_D);

    // C creates a fresh space and D joins: unrelated pairing unaffected.
    const created = await app.request('/v1/spaces', json(TOKEN_C, { name: 'C Space' }));
    expect(created.status).toBe(201);
    const freshCode = ((await created.json()) as { inviteCode: string }).inviteCode;
    const joined = await app.request('/v1/spaces/join', json(TOKEN_D, { inviteCode: freshCode }));
    expect(joined.status).toBe(200);
  });

  it('the exact former partner B cannot rejoin via the rotated code either (fail-closed 409)', async () => {
    const { harness, app } = makeApp();
    const { code2 } = await setupAdversarialHistory(app, harness);

    const rejoin = await app.request('/v1/spaces/join', json(TOKEN_B, { inviteCode: code2 }));
    expect(rejoin.status).toBe(409);
    expect((await rejoin.json()).error.code).toBe('CONFLICT');
  });

  it('A retains B-authored answers, milestones, and activity', async () => {
    const { harness, app } = makeApp();
    await setupAdversarialHistory(app, harness);

    // Reveal gate: A answers, then B's answer becomes visible to A.
    const answer = await app.request(
      '/v1/spaces/current/question/answer',
      json(TOKEN_A, { answer: 'Aoi weekly words' }, 'PUT')
    );
    expect(answer.status).toBe(200);
    const question = await app.request('/v1/spaces/current/question', { headers: auth(TOKEN_A) });
    expect(question.status).toBe(200);
    expect(JSON.stringify(await question.json())).toContain('Blake weekly words');

    const milestones = await app.request('/v1/spaces/current/imported-milestones', {
      headers: auth(TOKEN_A),
    });
    expect(milestones.status).toBe(200);
    expect(JSON.stringify(await milestones.json())).toContain('Blake imported goal');
  });
});

describe('pairing isolation mutation sweep (C cannot alter B history)', () => {
  const E2 = '00000000-0000-4000-8000-0000000000e2';
  const E3 = '00000000-0000-4000-8000-0000000000e3';

  it("C's writes against B history fail closed and change nothing", async () => {
    const { harness, app } = makeApp();
    const s = await setupAdversarialHistory(app, harness);

    const patchMoment = await app.request(
      `/v1/moments/${s.noteId}`,
      json(TOKEN_C, { title: 'C was here' }, 'PATCH')
    );
    expect([403, 404]).toContain(patchMoment.status);

    const deleteMoment = await app.request(`/v1/moments/${s.noteId}`, {
      method: 'DELETE',
      headers: auth(TOKEN_C),
    });
    expect([403, 404]).toContain(deleteMoment.status);

    const accept = await app.request(`/v1/proposals/${E2}/accept`, {
      method: 'POST',
      headers: auth(TOKEN_C),
    });
    expect([403, 404]).toContain(accept.status);

    const decline = await app.request(`/v1/proposals/${E2}/decline`, {
      method: 'POST',
      headers: auth(TOKEN_C),
    });
    expect([403, 404]).toContain(decline.status);

    const patchSomeday = await app.request(
      `/v1/someday/${E3}`,
      json(TOKEN_C, { title: 'C was here' }, 'PATCH')
    );
    expect([400, 403, 404]).toContain(patchSomeday.status);

    const patchEvent = await app.request(
      `/v1/calendar/events/${s.eventId}`,
      json(TOKEN_C, { title: 'C was here' }, 'PATCH')
    );
    expect([403, 404]).toContain(patchEvent.status);

    const deleteEvent = await app.request(`/v1/calendar/events/${s.eventId}`, {
      method: 'DELETE',
      headers: auth(TOKEN_C),
    });
    expect([403, 404]).toContain(deleteEvent.status);

    const patchSpace = await app.request(
      '/v1/spaces/current',
      json(TOKEN_C, { name: 'C Space' }, 'PATCH')
    );
    expect([400, 403, 404]).toContain(patchSpace.status);

    const rotate = await app.request('/v1/spaces/current/invite', {
      method: 'POST',
      headers: auth(TOKEN_C),
    });
    expect([400, 403, 404]).toContain(rotate.status);

    const seal = await app.request(
      '/v1/spaces/current/letters',
      json(TOKEN_C, { caption: 'C letter', body: 'C words', sealedUntil: new Date(Date.now() + 86400000).toISOString() })
    );
    expect([400, 403, 404]).toContain(seal.status);

    // Nothing changed: A reads the original titles, pending proposal, space.
    const list = (await (
      await app.request('/v1/spaces/current/moments', { headers: auth(TOKEN_A) })
    ).json()) as { moments: { id: string; title: string }[] };
    expect(list.moments.find((m) => m.id === s.noteId)?.title).toBe('Blake note');

    const proposals = (await (
      await app.request('/v1/spaces/current/proposals', { headers: auth(TOKEN_A) })
    ).json()) as { proposals: { id: string; status: string }[] };
    expect(proposals.proposals.find((p) => p.id === E2)?.status).toBe('pending');

    const someday = (await (
      await app.request('/v1/spaces/current/someday', { headers: auth(TOKEN_A) })
    ).json()) as { items: { id: string; title: string }[] };
    expect(someday.items.find((i) => i.id === E3)?.title).toBe('Blake someday dream');

    const event = await app.request(`/v1/calendar/events/${s.eventId}`, { headers: auth(TOKEN_A) });
    expect(event.status).toBe(200);
    expect(((await event.json()) as { title: string }).title).toBe('Blake anniversary dinner');
  });
});
