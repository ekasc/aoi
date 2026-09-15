import { describe, expect, it } from 'vitest';

import { createApp } from '../../create-app';
import { makeTestHarness, type ShimD1 } from '../../effects/test-harness';

/**
 * P8A backend entitlement authority through the worker shell
 * (createApp + Effect runtime + error mapper):
 * - verified webhook activates Plus on the purchaser's current Space;
 * - both members observe the identical row; unrelated Spaces stay free;
 * - duplicates are idempotent, stale events never regress;
 * - expiry/revocation removes Plus; bad auth/malformed payloads fail safe;
 * - leave/join/delete follow the documented sticky ownership rule;
 * - no client-writable path to Plus exists.
 */

const SECRET = 'test-revenuecat-webhook-secret';

const USER_A = '00000000-0000-4000-8000-000000000001';
const USER_B = '00000000-0000-4000-8000-000000000002';
const USER_C = '00000000-0000-4000-8000-000000000003';
const USER_D = '00000000-0000-4000-8000-000000000004';
const TOKEN_A = 'token-a';
const TOKEN_B = 'token-b';
const TOKEN_C = 'token-c';
const TOKEN_D = 'token-d';

const T0 = Date.parse('2026-09-01T00:00:00.000Z');
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

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
    T0 + YEAR_MS,
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

const CREATE_BODY = {
  name: 'Our Space',
  partnerName: 'Partner',
  relationshipStartDate: '2026-01-15',
};

async function setupPairedSpace(
  app: ReturnType<typeof makeApp>['app'],
  harness: ReturnType<typeof makeApp>['harness']
) {
  insertUser(harness.d1, USER_A, 'aoi@example.com', 'Aoi');
  insertUser(harness.d1, USER_B, 'partner@example.com', 'Partner');
  insertSession(harness.d1, 'sess-a', USER_A, TOKEN_A);
  insertSession(harness.d1, 'sess-b', USER_B, TOKEN_B);

  const created = await app.request('/v1/spaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
    body: JSON.stringify(CREATE_BODY),
  });
  expect(created.status).toBe(201);
  const { inviteCode } = (await created.json()) as { inviteCode: string };
  const join = await app.request('/v1/spaces/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(TOKEN_B) },
    body: JSON.stringify({ inviteCode }),
  });
  expect(join.status).toBe(200);
}

function rcEvent(overrides: Record<string, unknown> = {}) {
  return {
    api_version: '1.0',
    event: {
      id: 'evt-1',
      type: 'INITIAL_PURCHASE',
      app_user_id: USER_A,
      event_timestamp_ms: T0,
      entitlement_id: 'plus',
      entitlement_ids: ['plus'],
      product_id: 'aoi_plus_monthly',
      expiration_at_ms: T0 + YEAR_MS,
      store: 'app_store',
      environment: 'PRODUCTION',
      ...overrides,
    },
  };
}

function postWebhook(
  app: ReturnType<typeof makeApp>['app'],
  body: unknown,
  secret: string | null = SECRET
) {
  return app.request('/v1/billing/revenuecat/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret === null ? {} : { Authorization: `Bearer ${secret}` }),
    },
    body: JSON.stringify(body),
  });
}

async function readPlus(app: ReturnType<typeof makeApp>['app'], token: string) {
  const res = await app.request('/v1/spaces/current/plus', { headers: auth(token) });
  expect(res.status).toBe(200);
  return (await res.json()) as { isPlus: boolean; status: string; expiresAt: string | null };
}

function entitlementRows(harness: ReturnType<typeof makeApp>['harness']) {
  return harness.d1.rawDb
    .prepare('select * from space_plus_entitlements')
    .all() as unknown as Record<string, unknown>[];
}

describe('webhook activation and shared read', () => {
  it('valid webhook activates Plus for the purchaser Space; partner reads the same state', async () => {
    const { harness, app } = makeApp();
    await setupPairedSpace(app, harness);

    const res = await postWebhook(app, rcEvent());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ applied: true, spaceId: expect.any(String) });

    const asPurchaser = await readPlus(app, TOKEN_A);
    expect(asPurchaser.isPlus).toBe(true);
    expect(asPurchaser.status).toBe('active');
    expect(asPurchaser.expiresAt).toBe(new Date(T0 + YEAR_MS).toISOString());

    const asPartner = await readPlus(app, TOKEN_B);
    expect(asPartner).toEqual(asPurchaser);
  });

  it('unrelated Space remains free', async () => {
    const { harness, app } = makeApp();
    await setupPairedSpace(app, harness);
    insertUser(harness.d1, USER_C, 'third@example.com', 'Third');
    insertSession(harness.d1, 'sess-c', USER_C, TOKEN_C);
    const created = await app.request('/v1/spaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_C) },
      body: JSON.stringify({ name: 'Other Space' }),
    });
    expect(created.status).toBe(201);

    await postWebhook(app, rcEvent());
    expect(await readPlus(app, TOKEN_C)).toMatchObject({
      isPlus: false,
      status: 'inactive',
      expiresAt: null,
    });
  });

  it('duplicate delivery is idempotent', async () => {
    const { harness, app } = makeApp();
    await setupPairedSpace(app, harness);

    const first = await postWebhook(app, rcEvent());
    expect(first.status).toBe(200);
    const second = await postWebhook(app, rcEvent());
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ applied: false, reason: 'duplicate' });

    const rows = entitlementRows(harness);
    expect(rows).toHaveLength(1);
    expect(await readPlus(app, TOKEN_A)).toMatchObject({ isPlus: true });
  });

  it('older event cannot overwrite newer state', async () => {
    const { harness, app } = makeApp();
    await setupPairedSpace(app, harness);

    const renewal = await postWebhook(
      app,
      rcEvent({ id: 'evt-2', type: 'RENEWAL', event_timestamp_ms: T0 + 1000, expiration_at_ms: T0 + 2 * YEAR_MS })
    );
    expect(renewal.status).toBe(200);

    const stale = await postWebhook(
      app,
      rcEvent({ id: 'evt-1', type: 'INITIAL_PURCHASE', event_timestamp_ms: T0, expiration_at_ms: T0 + YEAR_MS })
    );
    expect(stale.status).toBe(200);
    expect(await stale.json()).toEqual({ applied: false, reason: 'stale' });

    const plus = await readPlus(app, TOKEN_A);
    expect(plus.expiresAt).toBe(new Date(T0 + 2 * YEAR_MS).toISOString());
  });

  it('expiration removes Plus; cancellation keeps the paid period to expiry', async () => {
    const { harness, app } = makeApp();
    await setupPairedSpace(app, harness);
    await postWebhook(app, rcEvent());

    const cancelled = await postWebhook(
      app,
      rcEvent({
        id: 'evt-cancel',
        type: 'CANCELLATION',
        event_timestamp_ms: T0 + 2000,
        expiration_at_ms: T0 + YEAR_MS,
      })
    );
    expect(cancelled.status).toBe(200);
    expect(await readPlus(app, TOKEN_A)).toMatchObject({ isPlus: true });

    const expired = await postWebhook(
      app,
      rcEvent({ id: 'evt-expire', type: 'EXPIRATION', event_timestamp_ms: T0 + YEAR_MS })
    );
    expect(expired.status).toBe(200);
    // Expired rows report when they lapsed (pre-existing read contract).
    expect(await readPlus(app, TOKEN_A)).toMatchObject({
      isPlus: false,
      status: 'inactive',
    });
    expect(await readPlus(app, TOKEN_B)).toMatchObject({
      isPlus: false,
      status: 'inactive',
    });
  });
});

describe('webhook authentication and payload safety', () => {
  it('rejects a wrong or missing secret with 401 and no state change', async () => {
    const { harness, app } = makeApp();
    await setupPairedSpace(app, harness);

    const wrong = await postWebhook(app, rcEvent(), 'wrong-secret');
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).error.code).toBe('UNAUTHORIZED');

    const missing = await postWebhook(app, rcEvent(), null);
    expect(missing.status).toBe(401);

    expect(entitlementRows(harness)).toHaveLength(0);
    expect(await readPlus(app, TOKEN_A)).toMatchObject({ isPlus: false });
  });

  it('accepts the raw secret form as well as Bearer', async () => {
    const { harness, app } = makeApp();
    await setupPairedSpace(app, harness);

    const res = await app.request('/v1/billing/revenuecat/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: SECRET },
      body: JSON.stringify(rcEvent()),
    });
    expect(res.status).toBe(200);
    expect(await readPlus(app, TOKEN_A)).toMatchObject({ isPlus: true });
  });

  it('unknown event types are acknowledged without state change', async () => {
    const { harness, app } = makeApp();
    await setupPairedSpace(app, harness);

    const res = await postWebhook(app, rcEvent({ id: 'evt-x', type: 'SOME_FUTURE_TYPE' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ applied: false, reason: 'ignored' });
    expect(entitlementRows(harness)).toHaveLength(0);
  });

  it('malformed payloads fail safely with 400 and no state change', async () => {
    const { harness, app } = makeApp();
    await setupPairedSpace(app, harness);

    const res = await postWebhook(app, { api_version: '1.0', event: { type: 'RENEWAL' } });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('BAD_REQUEST');
    expect(entitlementRows(harness)).toHaveLength(0);
  });

  it('events for other entitlements or unknown users grant nothing', async () => {
    const { harness, app } = makeApp();
    await setupPairedSpace(app, harness);

    const otherEntitlement = await postWebhook(
      app,
      rcEvent({ id: 'evt-other', entitlement_id: 'other_thing', entitlement_ids: ['other_thing'] })
    );
    expect(otherEntitlement.status).toBe(200);
    expect(await otherEntitlement.json()).toEqual({ applied: false, reason: 'ignored' });

    const unknownUser = await postWebhook(
      app,
      rcEvent({ id: 'evt-ghost', app_user_id: '00000000-0000-4000-8000-999999999999' })
    );
    expect(unknownUser.status).toBe(200);
    expect(await unknownUser.json()).toEqual({ applied: false, reason: 'ignored' });

    expect(entitlementRows(harness)).toHaveLength(0);
    expect(await readPlus(app, TOKEN_A)).toMatchObject({ isPlus: false });
  });
});

describe('ownership across leave, join, and delete', () => {
  it('purchaser leaving keeps Plus on the old Space; the new Space stays free', async () => {
    const { harness, app } = makeApp();
    await setupPairedSpace(app, harness);
    await postWebhook(app, rcEvent());

    const leave = await app.request('/v1/spaces/leave', {
      method: 'POST',
      headers: auth(TOKEN_A),
    });
    expect(leave.status).toBe(200);

    // Partner remains Plus; purchaser (spaceless) reads inactive.
    expect(await readPlus(app, TOKEN_B)).toMatchObject({ isPlus: true });
    expect(await readPlus(app, TOKEN_A)).toMatchObject({ isPlus: false });

    // Purchaser creates Space Y: one subscription must not entitle two Spaces.
    const created = await app.request('/v1/spaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify({ name: 'Space Y' }),
    });
    expect(created.status).toBe(201);
    expect(await readPlus(app, TOKEN_A)).toMatchObject({ isPlus: false });
    expect(await readPlus(app, TOKEN_B)).toMatchObject({ isPlus: true });
    expect(entitlementRows(harness)).toHaveLength(1);
  });

  it('account deletion preserves the partner paid period and kills access', async () => {
    const { harness, app } = makeApp();
    await setupPairedSpace(app, harness);
    await postWebhook(app, rcEvent());

    const deleted = await app.request('/v1/auth/account', {
      method: 'DELETE',
      headers: auth(TOKEN_A),
    });
    expect(deleted.status).toBe(200);

    // Partner keeps Plus until provider expiry (documented ownership rule).
    expect(await readPlus(app, TOKEN_B)).toMatchObject({ isPlus: true });

    // Deleted purchaser session is revoked: authenticated reads fail.
    const afterDelete = await app.request('/v1/spaces/current/plus', { headers: auth(TOKEN_A) });
    expect(afterDelete.status).toBe(401);
  });
});

describe('no client-writable Plus path', () => {
  it('unauthenticated reads fail and the read path accepts no writes', async () => {
    const { harness, app } = makeApp();
    await setupPairedSpace(app, harness);

    const unauth = await app.request('/v1/spaces/current/plus');
    expect(unauth.status).toBe(401);

    const post = await app.request('/v1/spaces/current/plus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_A) },
      body: JSON.stringify({ isPlus: true }),
    });
    expect(post.status).toBe(404);
    expect(entitlementRows(harness)).toHaveLength(0);
  });
});

describe('TRANSFER atomicity', () => {
  async function setupTransferStage(
    app: ReturnType<typeof makeApp>['app'],
    harness: ReturnType<typeof makeApp>['harness']
  ) {
    await setupPairedSpace(app, harness);
    insertUser(harness.d1, USER_D, 'dest@example.com', 'Dest');
    insertSession(harness.d1, 'sess-d', USER_D, TOKEN_D);
    const created = await app.request('/v1/spaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_D) },
      body: JSON.stringify({ name: 'Space Y' }),
    });
    expect(created.status).toBe(201);
    // A buys in Space X.
    const grant = await postWebhook(app, rcEvent());
    expect(grant.status).toBe(200);
    expect(await readPlus(app, TOKEN_A)).toMatchObject({ isPlus: true });
  }

  function transferEvent(overrides: Record<string, unknown> = {}) {
    return {
      api_version: '1.0',
      event: {
        id: 'evt-transfer-1',
        type: 'TRANSFER',
        app_user_id: USER_D,
        transferred_from: [USER_A],
        transferred_to: [USER_D],
        event_timestamp_ms: T0 + 5000,
        entitlement_id: 'plus',
        entitlement_ids: ['plus'],
        product_id: 'aoi_plus_monthly',
        expiration_at_ms: T0 + YEAR_MS,
        store: 'app_store',
        environment: 'PRODUCTION',
        ...overrides,
      },
    };
  }

  it('source loses Plus exactly when the destination gains it — never both', async () => {
    const { harness, app } = makeApp();
    await setupTransferStage(app, harness);

    const res = await postWebhook(app, transferEvent());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ applied: true });

    // Source Space X is dark for both former members…
    expect(await readPlus(app, TOKEN_A)).toMatchObject({ isPlus: false });
    expect(await readPlus(app, TOKEN_B)).toMatchObject({ isPlus: false });
    // …and destination Space Y is lit.
    expect(await readPlus(app, TOKEN_D)).toMatchObject({ isPlus: true });
    // Exactly one live row survives the move.
    const live = entitlementRows(harness).filter((row) => row.status === 'active');
    expect(live).toHaveLength(1);
  });

  it('duplicate TRANSFER is idempotent', async () => {
    const { harness, app } = makeApp();
    await setupTransferStage(app, harness);

    const first = await postWebhook(app, transferEvent());
    expect(first.status).toBe(200);
    const second = await postWebhook(app, transferEvent());
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ applied: false, reason: 'duplicate' });

    expect(await readPlus(app, TOKEN_D)).toMatchObject({ isPlus: true });
    expect(await readPlus(app, TOKEN_A)).toMatchObject({ isPlus: false });
  });

  it('ambiguous destination fails closed with the source untouched', async () => {
    const { harness, app } = makeApp();
    await setupTransferStage(app, harness);
    insertUser(harness.d1, USER_C, 'third@example.com', 'Third');
    insertSession(harness.d1, 'sess-c', USER_C, TOKEN_C);

    const res = await postWebhook(
      app,
      transferEvent({ id: 'evt-transfer-2', transferred_to: [USER_D, USER_C] })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ applied: false, reason: 'ignored' });

    // Source keeps Plus; nothing was fabricated anywhere.
    expect(await readPlus(app, TOKEN_A)).toMatchObject({ isPlus: true });
    expect(await readPlus(app, TOKEN_D)).toMatchObject({ isPlus: false });
    expect(entitlementRows(harness)).toHaveLength(1);
  });
});

describe('webhook durability and ordering (Astra audit)', () => {
  /**
   * One-shot transient failure on entitlement writes only: the first
   * mutating runSync against space_plus_entitlements throws, everything
   * else (dedupe insert, reads, retry) behaves normally. Returns a restore
   * fn; the flag disarms itself after firing once so the retry succeeds.
   */
  function failNextEntitlementWrite(harness: ReturnType<typeof makeApp>['harness']): () => void {
    const d1 = harness.d1 as unknown as {
      prepare(sql: string): unknown;
    };
    const origPrepare = d1.prepare.bind(d1);
    let armed = true;
    d1.prepare = (sql: string) => {
      const stmt = origPrepare(sql) as unknown as {
        runSync(): unknown;
      };
      if (armed && /space_plus_entitlements/i.test(sql) && /^\s*(insert|update|delete)/i.test(sql)) {
        const origRunSync = stmt.runSync.bind(stmt);
        stmt.runSync = () => {
          if (armed) {
            armed = false;
            throw new Error('injected transient DB failure');
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

  function processedIds(harness: ReturnType<typeof makeApp>['harness']): string[] {
    return (
      harness.d1.rawDb.prepare('select event_id from processed_webhook_events').all() as unknown as {
        event_id: string;
      }[]
    ).map((row) => row.event_id);
  }

  it('a transient entitlement-write failure is retried, not discarded as duplicate', async () => {
    const { harness, app } = makeApp();
    await setupPairedSpace(app, harness);
    const restore = failNextEntitlementWrite(harness);

    const failed = await postWebhook(app, rcEvent({ id: 'evt-flaky' }));
    expect(failed.status).toBe(500);
    expect(await readPlus(app, TOKEN_A)).toMatchObject({ isPlus: false });
    // Nothing was recorded: the atomic batch rolled back, so the retry
    // is a live delivery, not a discarded "duplicate".
    expect(processedIds(harness)).not.toContain('evt-flaky');

    restore();
    const retry = await postWebhook(app, rcEvent({ id: 'evt-flaky' }));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ applied: true, spaceId: expect.any(String) });
    expect(await readPlus(app, TOKEN_A)).toMatchObject({ isPlus: true });
    expect(entitlementRows(harness)).toHaveLength(1);
  });

  it('an older renewal cannot reactivate after a newer expiration', async () => {
    const { harness, app } = makeApp();
    await setupPairedSpace(app, harness);
    await postWebhook(app, rcEvent({ id: 'evt-grant', event_timestamp_ms: T0 }));
    const expired = await postWebhook(
      app,
      rcEvent({ id: 'evt-expire', type: 'EXPIRATION', event_timestamp_ms: T0 + 1000 })
    );
    expect(expired.status).toBe(200);
    expect(await readPlus(app, TOKEN_A)).toMatchObject({ isPlus: false, status: 'inactive' });

    // Older renewal, fresh id, generous future expiry: must stay dark.
    const staleRenewal = await postWebhook(
      app,
      rcEvent({
        id: 'evt-old-renewal',
        type: 'RENEWAL',
        event_timestamp_ms: T0 + 500,
        expiration_at_ms: T0 + 2 * YEAR_MS,
      })
    );
    expect(staleRenewal.status).toBe(200);
    expect(await staleRenewal.json()).toEqual({ applied: false, reason: 'stale' });
    expect(await readPlus(app, TOKEN_A)).toMatchObject({ isPlus: false, status: 'inactive' });
    expect(entitlementRows(harness)).toHaveLength(1);
  });

  it('an older revoke cannot move the watermark of an inactive entitlement', async () => {
    const { harness, app } = makeApp();
    await setupPairedSpace(app, harness);
    await postWebhook(app, rcEvent({ id: 'evt-grant', event_timestamp_ms: T0 }));
    await postWebhook(app, rcEvent({ id: 'evt-expire', type: 'EXPIRATION', event_timestamp_ms: T0 + 1000 }));

    const older = await postWebhook(
      app,
      rcEvent({ id: 'evt-older-expire', type: 'EXPIRATION', event_timestamp_ms: T0 + 500 })
    );
    expect(older.status).toBe(200);
    expect(await older.json()).toEqual({ applied: false, reason: 'stale' });
    expect(await readPlus(app, TOKEN_A)).toMatchObject({ isPlus: false, status: 'inactive' });

    // A newer revoke still advances the preserved watermark (row stays
    // inactive), so the ordering signal is never lost on ended rows.
    const newer = await postWebhook(
      app,
      rcEvent({ id: 'evt-newer-expire', type: 'EXPIRATION', event_timestamp_ms: T0 + 2000 })
    );
    expect(newer.status).toBe(200);
    expect(await newer.json()).toEqual({ applied: false, reason: 'ignored' });
    const rows = entitlementRows(harness);
    expect(rows).toHaveLength(1);
    expect(rows[0].last_event_id).toBe('evt-newer-expire');
  });

  it('concurrent duplicate deliveries apply exactly once', async () => {
    const { harness, app } = makeApp();
    await setupPairedSpace(app, harness);

    const [first, second] = await Promise.all([postWebhook(app, rcEvent()), postWebhook(app, rcEvent())]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const bodies = [(await first.json()) as unknown, (await second.json()) as unknown];
    expect(bodies).toContainEqual({ applied: true, spaceId: expect.any(String) });
    expect(bodies).toContainEqual({ applied: false, reason: 'duplicate' });

    expect(entitlementRows(harness)).toHaveLength(1);
    expect(await readPlus(app, TOKEN_A)).toMatchObject({ isPlus: true });
  });

  it('concurrent old renewal vs new expiration converges on the newer event', async () => {
    const { harness, app } = makeApp();
    await setupPairedSpace(app, harness);
    await postWebhook(app, rcEvent({ id: 'evt-grant', event_timestamp_ms: T0 }));

    const [expiration, renewal] = await Promise.all([
      postWebhook(app, rcEvent({ id: 'evt-expire', type: 'EXPIRATION', event_timestamp_ms: T0 + 1000 })),
      postWebhook(
        app,
        rcEvent({
          id: 'evt-old-renewal',
          type: 'RENEWAL',
          event_timestamp_ms: T0 + 500,
          expiration_at_ms: T0 + 2 * YEAR_MS,
        })
      ),
    ]);
    expect(expiration.status).toBe(200);
    expect(renewal.status).toBe(200);
    // Whichever order the deliveries executed in, the newer expiration wins.
    expect(await readPlus(app, TOKEN_A)).toMatchObject({ isPlus: false, status: 'inactive' });
  });
});

describe('provider identity resolution', () => {
  it('resolves an Aoi user through original_app_user_id', async () => {
    const { harness, app } = makeApp();
    await setupPairedSpace(app, harness);

    const res = await postWebhook(
      app,
      rcEvent({
        id: 'evt-alias-1',
        app_user_id: '$RCAnonymousID:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        original_app_user_id: USER_A,
      })
    );
    expect(res.status).toBe(200);
    expect(await readPlus(app, TOKEN_A)).toMatchObject({ isPlus: true });
  });

  it('resolves an Aoi user through aliases', async () => {
    const { harness, app } = makeApp();
    await setupPairedSpace(app, harness);

    const res = await postWebhook(
      app,
      rcEvent({
        id: 'evt-alias-2',
        app_user_id: '$RCAnonymousID:ffffffff-0000-1111-2222-333333333333',
        aliases: ['$RCAnonymousID:ffffffff-0000-1111-2222-333333333333', USER_B],
      })
    );
    expect(res.status).toBe(200);
    // B's purchase entitles the shared Space X for both members.
    expect(await readPlus(app, TOKEN_B)).toMatchObject({ isPlus: true });
    expect(await readPlus(app, TOKEN_A)).toMatchObject({ isPlus: true });
  });

  it('aliases spanning two Aoi users cannot grant Plus', async () => {
    const { harness, app } = makeApp();
    await setupPairedSpace(app, harness);

    const res = await postWebhook(
      app,
      rcEvent({
        id: 'evt-alias-3',
        app_user_id: '$RCAnonymousID:99999999-8888-7777-6666-555555555555',
        aliases: [USER_A, USER_B],
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ applied: false, reason: 'ignored' });
    expect(entitlementRows(harness)).toHaveLength(0);
    expect(await readPlus(app, TOKEN_A)).toMatchObject({ isPlus: false });
  });
});

describe('event idempotency and ordering', () => {
  it('same event id with a different body is still a duplicate', async () => {
    const { harness, app } = makeApp();
    await setupPairedSpace(app, harness);

    const first = await postWebhook(app, rcEvent());
    expect(first.status).toBe(200);
    // Redelivery carrying conflicting content must not rewrite the row.
    const redelivery = await postWebhook(
      app,
      rcEvent({ product_id: 'aoi_plus_yearly', expiration_at_ms: T0 + 10 * YEAR_MS })
    );
    expect(redelivery.status).toBe(200);
    expect(await redelivery.json()).toEqual({ applied: false, reason: 'duplicate' });

    const plus = await readPlus(app, TOKEN_A);
    expect(plus.expiresAt).toBe(new Date(T0 + YEAR_MS).toISOString());
  });

  it('older timestamp is stale even with a fresh id', async () => {
    const { harness, app } = makeApp();
    await setupPairedSpace(app, harness);
    await postWebhook(app, rcEvent({ id: 'evt-new', event_timestamp_ms: T0 + 1000 }));

    const stale = await postWebhook(
      app,
      rcEvent({ id: 'evt-old', event_timestamp_ms: T0, expiration_at_ms: T0 + 30 * 24 * 60 * 60 * 1000 })
    );
    expect(stale.status).toBe(200);
    expect(await stale.json()).toEqual({ applied: false, reason: 'stale' });
  });

  it('equal timestamps apply in delivery order, not UUID lexical order', async () => {
    const { harness, app } = makeApp();
    await setupPairedSpace(app, harness);

    // Lexically LARGER id arrives first…
    const first = await postWebhook(
      app,
      rcEvent({ id: 'evt-zz', type: 'INITIAL_PURCHASE', event_timestamp_ms: T0 })
    );
    expect(first.status).toBe(200);
    // …then a lexically SMALLER id at the SAME timestamp still applies.
    const second = await postWebhook(
      app,
      rcEvent({
        id: 'evt-aa',
        type: 'RENEWAL',
        event_timestamp_ms: T0,
        expiration_at_ms: T0 + 2 * YEAR_MS,
      })
    );
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ applied: true });

    const plus = await readPlus(app, TOKEN_A);
    expect(plus.expiresAt).toBe(new Date(T0 + 2 * YEAR_MS).toISOString());
  });

  it('unrelated Spaces stay dark through transfers and renewals', async () => {
    const { harness, app } = makeApp();
    await setupPairedSpace(app, harness);
    insertUser(harness.d1, USER_C, 'third@example.com', 'Third');
    insertSession(harness.d1, 'sess-c', USER_C, TOKEN_C);
    const created = await app.request('/v1/spaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(TOKEN_C) },
      body: JSON.stringify({ name: 'Other Space' }),
    });
    expect(created.status).toBe(201);

    await postWebhook(app, rcEvent());
    await postWebhook(
      app,
      rcEvent({ id: 'evt-r2', type: 'RENEWAL', event_timestamp_ms: T0 + 1000, expiration_at_ms: T0 + 2 * YEAR_MS })
    );
    expect(await readPlus(app, TOKEN_C)).toMatchObject({
      isPlus: false,
      status: 'inactive',
      expiresAt: null,
    });
  });
});
