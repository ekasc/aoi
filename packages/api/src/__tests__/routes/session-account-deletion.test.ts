import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';

import { createApp } from '../../create-app';
import { makeTestHarness, type ShimD1 } from '../../effects/test-harness';
import { deleteAccountProgram } from '../../domains/auth';

/**
 * Account deletion contract (Astra finding #4): "permanently delete
 * account" must be truthful.
 *
 * PURGED (personal identity/data): email, avatar, display name, provider
 * linkage + tokens (auth_accounts), sessions (all devices), push tokens,
 * preferences, precise location shares.
 * RETAINED (shared relationship content for the remaining partner):
 * moments, letters, calendar, proposals, someday, weekly answers, media
 * rows + bytes, spaces/invites/activity rows, the Plus row (partner's paid
 * period), and the membership row itself (flipped to left).
 * The user row survives as an unlinked tombstone (id + deleted_at only)
 * so content FKs stay valid; snapshots keep the names the partner saw,
 * live joins resolve the tombstone as "Deleted member".
 */

const USER_A = '00000000-0000-4000-8000-000000000001';
const USER_B = '00000000-0000-4000-8000-000000000002';
const USER_C = '00000000-0000-4000-8000-000000000003';
const TOKEN_A = 'token-a';
const TOKEN_B = 'token-b';
const TOKEN_C = 'token-c';
const NOW = Date.parse('2026-01-15T00:00:00.000Z');
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const WEBHOOK_SECRET = 'test-revenuecat-webhook-secret';

function insertUser(d1: ShimD1, id: string, email: string, name: string): void {
  d1.runSync(
    'insert into users (id, email, name, image, email_verified, created_at, updated_at) values (?, ?, ?, ?, 1, ?, ?)',
    id,
    email,
    name,
    `https://cdn.example.com/${id}.png`,
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

async function setupPaired(
  app: ReturnType<typeof makeApp>['app'],
  harness: ReturnType<typeof makeApp>['harness']
): Promise<string> {
  insertUser(harness.d1, USER_A, 'aoi@example.com', 'Aoi');
  insertUser(harness.d1, USER_B, 'partner@example.com', 'Partner');
  insertSession(harness.d1, 'sess-a', USER_A, TOKEN_A);
  insertSession(harness.d1, 'sess-b', USER_B, TOKEN_B);
  // Personal identity/data attached to A beyond the base account.
  harness.d1.runSync(
    "insert into auth_accounts (id, user_id, account_id, provider_id, access_token, refresh_token) values ('acc-a', ?, 'apple-sub-123', 'apple', 'at-secret', 'rt-secret')",
    USER_A
  );
  harness.d1.runSync('insert into user_preferences (user_id, theme_id) values (?, ?)', USER_A, 'sea-glass');
  harness.d1.runSync(
    "insert into push_tokens (id, user_id, expo_push_token) values ('push-a', ?, 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]')",
    USER_A
  );

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

  // Precise location share for A (sensitive: must not survive deletion).
  harness.d1.runSync(
    `insert into location_shares (id, user_id, space_id, mode, latitude, longitude, reported_at)
     values ('loc-a', ?, ?, 'live', 37.7749, -122.4194, ?)`,
    USER_A,
    space.id,
    NOW
  );
  // Shared content authored by A.
  harness.d1.runSync(
    `insert into moments (id, space_id, created_by_user_id, author_role, author_name,
       type, title, body, occurred_at, client_id, created_at, updated_at)
     values ('m-a1', ?, ?, 'you', 'Aoi', 'note', 'A memory', 'held', ?, 'client-m-a1', ?, ?)`,
    space.id,
    USER_A,
    NOW,
    NOW,
    NOW
  );
  harness.d1.runSync(
    `insert into letters (id, space_id, author_user_id, caption, body, sealed_until, created_at)
     values ('l-a1', ?, ?, 'For you', 'sealed words', ?, ?)`,
    space.id,
    USER_A,
    NOW + YEAR_MS,
    NOW
  );
  harness.d1.runSync(
    `insert into weekly_answers (id, space_id, user_id, week_key, question_id, answer, created_at, updated_at)
     values ('w-a1', ?, ?, '2026-W03', 7, 'our song', ?, ?)`,
    space.id,
    USER_A,
    NOW,
    NOW
  );
  return space.id;
}

function count(
  harness: ReturnType<typeof makeApp>['harness'],
  sql: string,
  ...params: unknown[]
): number {
  return (harness.d1.rawDb.prepare(sql).get(...params) as { n: number }).n;
}

describe('personal identity purge', () => {
  it('erases email/avatar/name linkage, provider accounts, sessions, push, prefs, location', async () => {
    const { harness, app } = makeApp();
    const spaceId = await setupPaired(app, harness);

    const deleted = await app.request('/v1/auth/account', { method: 'DELETE', headers: auth(TOKEN_A) });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ ok: true });

    // Tombstone: id + deleted_at only. No email (unique freed), no avatar,
    // no verified flag, display name scrubbed.
    const user = harness.d1.rawDb
      .prepare('select email, name, image, email_verified, deleted_at from users where id = ?')
      .get(USER_A) as Record<string, unknown>;
    expect(user.deleted_at).toBeTypeOf('number');
    expect(user.email).toBeNull();
    expect(user.image).toBeNull();
    expect(user.email_verified).toBe(0);
    expect(user.name).toBe('Deleted member');

    // Provider linkage + tokens gone (re-login cannot resurrect: no account
    // row to link, no email to match).
    expect(count(harness, 'select count(*) as n from auth_accounts where user_id = ?', USER_A)).toBe(0);
    // All sessions revoked (every device), push gone, prefs gone, precise
    // location gone.
    expect(count(harness, 'select count(*) as n from user_sessions where user_id = ?', USER_A)).toBe(0);
    expect(count(harness, 'select count(*) as n from push_tokens where user_id = ?', USER_A)).toBe(0);
    expect(count(harness, 'select count(*) as n from user_preferences where user_id = ?', USER_A)).toBe(0);
    expect(count(harness, 'select count(*) as n from location_shares where user_id = ?', USER_A)).toBe(0);

    // Membership flipped to left with consent withdrawn.
    const member = harness.d1.rawDb
      .prepare('select state, location_consent_at from space_members where user_id = ? and space_id = ?')
      .get(USER_A, spaceId) as { state: string; location_consent_at: number | null };
    expect(member.state).toBe('left');
    expect(member.location_consent_at).toBeNull();

    // Deleted token is dead everywhere.
    expect((await app.request('/v1/spaces/current', { headers: auth(TOKEN_A) })).status).toBe(401);
  });

  it('the same email can register again (unique freed, no link to the tombstone)', async () => {
    const { harness, app } = makeApp();
    await setupPaired(app, harness);
    await app.request('/v1/auth/account', { method: 'DELETE', headers: auth(TOKEN_A) });

    // A fresh signup with the same email creates an unlinked account.
    insertUser(harness.d1, USER_C, 'aoi@example.com', 'Aoi Again');
    insertSession(harness.d1, 'sess-c', USER_C, TOKEN_C);
    const me = await app.request('/v1/spaces/current', { headers: auth(TOKEN_C) });
    expect(me.status).toBe(200);
    const tombstones = harness.d1.rawDb
      .prepare('select count(*) as n from users where email is null and deleted_at is not null')
      .get() as { n: number };
    expect(tombstones.n).toBe(1);
  });
});

describe('shared history preservation + attribution', () => {
  it('partner keeps every memory; snapshots keep names, live joins show Deleted member', async () => {
    const { harness, app } = makeApp();
    const spaceId = await setupPaired(app, harness);
    await app.request('/v1/auth/account', { method: 'DELETE', headers: auth(TOKEN_A) });

    // Rows retained.
    expect(count(harness, 'select count(*) as n from moments where id = ?', 'm-a1')).toBe(1);
    expect(count(harness, 'select count(*) as n from letters where id = ?', 'l-a1')).toBe(1);
    expect(count(harness, 'select count(*) as n from weekly_answers where id = ?', 'w-a1')).toBe(1);
    expect(count(harness, 'select count(*) as n from spaces where id = ?', spaceId)).toBe(1);

    // Moment snapshot columns keep what the partner saw (raw history);
    // the live API resolves the tombstone as Deleted member.
    const rawMoment = harness.d1.rawDb
      .prepare('select author_name, created_by_user_id from moments where id = ?')
      .get('m-a1') as { author_name: string; created_by_user_id: string };
    expect(rawMoment).toEqual({ author_name: 'Aoi', created_by_user_id: USER_A });
    const moments = await app.request('/v1/spaces/current/moments?limit=50', { headers: auth(TOKEN_B) });
    expect(moments.status).toBe(200);
    const items = ((await moments.json()) as { moments: { authorName: string; authorId: string }[] }).moments;
    expect(items.map((m) => m.authorName)).toContain('Deleted member');
    expect(items.map((m) => m.authorId)).toContain(USER_A);

    // Live user join resolves the tombstone without leaking identity.
    const shelf = await app.request('/v1/spaces/current/letters', { headers: auth(TOKEN_B) });
    expect(shelf.status).toBe(200);
    const letters = (await shelf.json()) as { letters: { authorName: string }[] };
    expect(letters.letters.map((l) => l.authorName)).toContain('Deleted member');

    // Space itself is untouched (not archived: partner remains).
    const archived = harness.d1.rawDb
      .prepare('select archived_at from spaces where id = ?')
      .get(spaceId) as { archived_at: number | null };
    expect(archived.archived_at).toBeNull();
  });

  it("purchaser purge keeps the partner's paid period (Plus row retained, unlinked)", async () => {
    const { harness, app } = makeApp();
    await setupPaired(app, harness);
    const grant = await app.request('/v1/billing/revenuecat/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${WEBHOOK_SECRET}` },
      body: JSON.stringify({
        api_version: '1.0',
        event: {
          id: 'evt-plus-1',
          type: 'INITIAL_PURCHASE',
          app_user_id: USER_A,
          event_timestamp_ms: NOW,
          entitlement_id: 'plus',
          entitlement_ids: ['plus'],
          product_id: 'aoi_plus_monthly',
          expiration_at_ms: NOW + YEAR_MS,
        },
      }),
    });
    expect(grant.status).toBe(200);

    await app.request('/v1/auth/account', { method: 'DELETE', headers: auth(TOKEN_A) });

    const plus = await app.request('/v1/spaces/current/plus', { headers: auth(TOKEN_B) });
    expect(plus.status).toBe(200);
    expect((await plus.json()) as { isPlus: boolean }).toMatchObject({ isPlus: true });
    expect(count(harness, 'select count(*) as n from space_plus_entitlements')).toBe(1);
  });
});

describe('purge lifecycle + retry', () => {
  function failArchiveOnce(harness: ReturnType<typeof makeApp>['harness']): () => void {
    const d1 = harness.d1 as unknown as { prepare(sql: string): unknown };
    const origPrepare = d1.prepare.bind(d1);
    let armed = true;
    d1.prepare = (sql: string) => {
      const stmt = origPrepare(sql) as unknown as { runSync(): unknown; run(): Promise<unknown> };
      if (armed && /update spaces set archived_at/i.test(sql)) {
        const origRunSync = stmt.runSync.bind(stmt);
        stmt.runSync = () => {
          if (armed) {
            armed = false;
            throw new Error('injected archive failure');
          }
          return origRunSync();
        };
      }
      return stmt;
    };
    return () => {
      d1.prepare = origPrepare;
    };
  }

  it('archive failure fails the whole deletion: nothing half-done, retry converges', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'solo@example.com', 'Solo');
    insertSession(harness.d1, 'sess-a', USER_A, TOKEN_A);
    const created = await app.request('/v1/spaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify({ name: 'Solo Space' }),
    });
    expect(created.status).toBe(201);
    const { space } = (await created.json()) as { space: { id: string } };

    const restore = failArchiveOnce(harness);
    const failed = await app.request('/v1/auth/account', { method: 'DELETE', headers: auth(TOKEN_A) });
    expect(failed.status).toBe(500);
    // Atomic: sessions intact, user untouched, space open — the same token
    // retries cleanly.
    expect(count(harness, 'select count(*) as n from user_sessions where user_id = ?', USER_A)).toBe(1);
    const user = harness.d1.rawDb
      .prepare('select email, deleted_at from users where id = ?')
      .get(USER_A) as { email: string | null; deleted_at: number | null };
    expect(user.deleted_at).toBeNull();
    expect(user.email).toBe('solo@example.com');

    restore();
    const retry = await app.request('/v1/auth/account', { method: 'DELETE', headers: auth(TOKEN_A) });
    expect(retry.status).toBe(200);
    const archived = harness.d1.rawDb
      .prepare('select archived_at from spaces where id = ?')
      .get(space.id) as { archived_at: number | null };
    expect(archived.archived_at).toBeTypeOf('number');
    expect(count(harness, 'select count(*) as n from user_sessions where user_id = ?', USER_A)).toBe(0);
  });

  it('repeat deletion is idempotent at the domain level; dead tokens stay dead at HTTP', async () => {
    const { harness, app } = makeApp();
    await setupPaired(app, harness);
    const first = await app.request('/v1/auth/account', { method: 'DELETE', headers: auth(TOKEN_A) });
    expect(first.status).toBe(200);

    // The revoked credential cannot delete (or do) anything again.
    const again = await app.request('/v1/auth/account', { method: 'DELETE', headers: auth(TOKEN_A) });
    expect(again.status).toBe(401);

    // Domain re-run converges to the same state (safe crash-retry shape).
    const rerun = await Effect.runPromise(Effect.provide(deleteAccountProgram(USER_A), harness.layer));
    expect(rerun).toEqual({ ok: true });
    const user = harness.d1.rawDb
      .prepare('select email, deleted_at from users where id = ?')
      .get(USER_A) as { email: string | null; deleted_at: number | null };
    expect(user.email).toBeNull();
    expect(user.deleted_at).toBeTypeOf('number');
  });

  it('last-member solo delete archives in the same step and the invite dies', async () => {
    const { harness, app } = makeApp();
    insertUser(harness.d1, USER_A, 'solo@example.com', 'Solo');
    insertUser(harness.d1, USER_C, 'c@example.com', 'Cee');
    insertSession(harness.d1, 'sess-a', USER_A, TOKEN_A);
    insertSession(harness.d1, 'sess-c', USER_C, TOKEN_C);
    const created = await app.request('/v1/spaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify({ name: 'Solo Space' }),
    });
    const { space, inviteCode } = (await created.json()) as { space: { id: string }; inviteCode: string };

    const deleted = await app.request('/v1/auth/account', { method: 'DELETE', headers: auth(TOKEN_A) });
    expect(deleted.status).toBe(200);
    const archived = harness.d1.rawDb
      .prepare('select archived_at from spaces where id = ?')
      .get(space.id) as { archived_at: number | null };
    expect(archived.archived_at).toBeTypeOf('number');

    const join = await app.request('/v1/spaces/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_C) },
      body: JSON.stringify({ inviteCode }),
    });
    expect(join.status).toBe(404);
  });
});
