import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { locationShares } from '../../db/schema.js';
import { notifyPartnerInSpace } from '../../lib/push.js';
import {
  app,
  getTestJwt,
  req,
  TEST_USER_ID,
  TEST_OTHER_USER_ID,
  TEST_SPACE_ID,
} from '../helpers/test-app.js';

vi.stubEnv('JWT_SECRET', 'test-jwt-secret-for-testing');
vi.stubEnv('CORS_ORIGIN', '*');

const SHARE_PATH = '/v1/spaces/current/location/share';
const GET_PATH = '/v1/spaces/current/location';
const CONSENT_PATH = '/v1/spaces/current/location/consent';
const REQUEST_PATH = '/v1/spaces/current/location/request';

// Fixed clock: freshness assertions are all relative to it. Only the
// rate-limit test advances time (by just over a window), so the cached
// 15-minute JWT never expires mid-file.
const BASE_NOW = new Date('2026-08-03T12:00:00Z').getTime();
const currentNow = BASE_NOW;

// Query bookkeeping: selects resolve from a FIFO queue (order matters),
// writes resolve from a shared result, and select `from`/`where` calls are
// recorded so tests can prove WHICH rows were addressed.
const mockSelectQueue: Array<Array<Record<string, unknown>>> = [];
let mockWriteResult: Array<Record<string, unknown>> = [];
const selectFromCalls: unknown[] = [];
const selectWhereCalls: Array<{ table: unknown; predicate: unknown }> = [];
const fromStack: unknown[] = [];

function selectChain() {
  const chain: Record<string, unknown> = {
    from: vi.fn((table: unknown) => {
      fromStack.push(table);
      selectFromCalls.push(table);
      return chain;
    }),
    where: vi.fn((predicate: unknown) => {
      selectWhereCalls.push({ table: fromStack[fromStack.length - 1], predicate });
      return chain;
    }),
    limit: vi.fn(() => Promise.resolve(mockSelectQueue.shift() ?? [])),
    then: (resolve: (value: unknown) => void) =>
      resolve(mockSelectQueue.shift() ?? []),
  };
  return chain;
}

function insertChain() {
  const chain: Record<string, unknown> = {
    values: vi.fn(() => chain),
    onConflictDoUpdate: vi.fn(() => chain),
    returning: vi.fn(() => Promise.resolve(mockWriteResult)),
    then: (resolve: (value: unknown) => void) => resolve(mockWriteResult),
  };
  return chain;
}

function updateChain() {
  const chain: Record<string, unknown> = {
    set: vi.fn(() => chain),
    where: vi.fn(() => chain),
    returning: vi.fn(() => Promise.resolve(mockWriteResult)),
    then: (resolve: (value: unknown) => void) => resolve(mockWriteResult),
  };
  return chain;
}

function deleteChain() {
  const chain: Record<string, unknown> = {
    where: vi.fn(() => chain),
    returning: vi.fn(() => Promise.resolve(mockWriteResult)),
    then: (resolve: (value: unknown) => void) => resolve(mockWriteResult),
  };
  return chain;
}

vi.mock('../../db/index.js', () => ({
  db: {
    select: vi.fn(() => selectChain()),
    insert: vi.fn(() => insertChain()),
    update: vi.fn(() => updateChain()),
    delete: vi.fn(() => deleteChain()),
  },
}));

vi.mock('../../lib/push.js', () => ({
  notifyPartnerInSpace: vi.fn(async () => {}),
}));

function membershipRow() {
  return { spaceId: TEST_SPACE_ID, userId: TEST_USER_ID, state: 'active' as const };
}

function spaceRow(overrides: Record<string, unknown> = {}) {
  return { archivedAt: null, ...overrides };
}

function memberConsentRow(
  userId: string,
  locationConsentAt: Date | null
) {
  return { userId, locationConsentAt };
}

function locationShareRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-0000-0000-000000000040',
    userId: TEST_OTHER_USER_ID,
    spaceId: TEST_SPACE_ID,
    mode: 'live',
    destination: null,
    latitude: 35.658,
    longitude: 139.7454,
    accuracyMeters: 25,
    reportedAt: new Date(currentNow - 60_000),
    consumedAt: null,
    createdAt: new Date(currentNow - 120_000),
    updatedAt: new Date(currentNow - 60_000),
    ...overrides,
  };
}

function consentedSpaceMembers() {
  return [
    memberConsentRow(TEST_USER_ID, new Date(currentNow - 3_600_000)),
    memberConsentRow(TEST_OTHER_USER_ID, new Date(currentNow - 3_600_000)),
  ];
}

/** Push the standard GET preamble: membership + space + member consents. */
function pushGetPreamble(
  members = consentedSpaceMembers(),
  space = spaceRow()
) {
  mockSelectQueue.push([membershipRow()], [space], members);
}

function nowIso(offsetMs = 0) {
  return new Date(currentNow + offsetMs).toISOString();
}

beforeEach(() => {
  mockSelectQueue.length = 0;
  mockWriteResult = [];
  selectFromCalls.length = 0;
  selectWhereCalls.length = 0;
  fromStack.length = 0;
  vi.mocked(db.select).mockClear();
  vi.mocked(db.insert).mockClear();
  vi.mocked(db.update).mockClear();
  vi.mocked(db.delete).mockClear();
  vi.mocked(notifyPartnerInSpace).mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(currentNow);
});

afterEach(() => {
  vi.useRealTimers();
});

// ── GET /v1/spaces/current/location ──────────────────────────────────────

describe('GET /v1/spaces/current/location — consent gating matrix', () => {
  it('returns 401 without auth', async () => {
    const res = await app.fetch(req('GET', GET_PATH));
    expect(res.status).toBe(401);
  });

  it('returns location null when the caller has no space', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([]); // no active membership
    const res = await app.fetch(req('GET', GET_PATH, { jwt }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      location: null,
      youConsented: false,
      partnerConsented: false,
    });
  });

  it('is hard-off in an archived space', async () => {
    const jwt = await getTestJwt();
    pushGetPreamble(consentedSpaceMembers(), spaceRow({ archivedAt: new Date(currentNow) }));
    const res = await app.fetch(req('GET', GET_PATH, { jwt }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.location).toBeNull();
  });

  it('returns null when neither partner consented', async () => {
    const jwt = await getTestJwt();
    pushGetPreamble([
      memberConsentRow(TEST_USER_ID, null),
      memberConsentRow(TEST_OTHER_USER_ID, null),
    ]);
    const res = await app.fetch(req('GET', GET_PATH, { jwt }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      location: null,
      youConsented: false,
      partnerConsented: false,
    });
  });

  it('returns null when only the caller consented (one-sided consent)', async () => {
    const jwt = await getTestJwt();
    pushGetPreamble([
      memberConsentRow(TEST_USER_ID, new Date(currentNow)),
      memberConsentRow(TEST_OTHER_USER_ID, null),
    ]);
    // Even a fresh partner row must never be served.
    mockSelectQueue.push([locationShareRow()]);
    const res = await app.fetch(req('GET', GET_PATH, { jwt }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.location).toBeNull();
    expect(body.youConsented).toBe(true);
    expect(body.partnerConsented).toBe(false);
    expect(JSON.stringify(body)).not.toContain('35.658');
  });

  it('returns null when only the partner consented', async () => {
    const jwt = await getTestJwt();
    pushGetPreamble([
      memberConsentRow(TEST_USER_ID, null),
      memberConsentRow(TEST_OTHER_USER_ID, new Date(currentNow)),
    ]);
    const res = await app.fetch(req('GET', GET_PATH, { jwt }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.location).toBeNull();
    expect(body.youConsented).toBe(false);
    expect(body.partnerConsented).toBe(true);
  });

  it('serves the partner fresh live row when both consented', async () => {
    const jwt = await getTestJwt();
    pushGetPreamble();
    mockSelectQueue.push([locationShareRow({ accuracyMeters: 12 })]);
    const res = await app.fetch(req('GET', GET_PATH, { jwt }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.youConsented).toBe(true);
    expect(body.partnerConsented).toBe(true);
    expect(body.location).toEqual({
      mode: 'live',
      latitude: 35.658,
      longitude: 139.7454,
      accuracyMeters: 12,
      reportedAt: nowIso(-60_000),
      destination: null,
    });
  });

  it('queries the share row by the PARTNER id, never the caller id', async () => {
    const jwt = await getTestJwt();
    pushGetPreamble();
    mockSelectQueue.push([locationShareRow()]);
    await app.fetch(req('GET', GET_PATH, { jwt }));

    const shareSelects = selectWhereCalls.filter(
      ({ table }) => table === locationShares
    );
    expect(shareSelects).toHaveLength(1);
    const rendered = new PgDialect().sqlToQuery(shareSelects[0].predicate as SQL);
    expect(rendered.params).toContain(TEST_OTHER_USER_ID);
    expect(rendered.params).not.toContain(TEST_USER_ID);
  });
});

describe('GET /v1/spaces/current/location — freshness + consumption', () => {
  it('withholds and purges a stale live report (over the 15-minute window)', async () => {
    const jwt = await getTestJwt();
    pushGetPreamble();
    mockSelectQueue.push([
      locationShareRow({ reportedAt: new Date(currentNow - 16 * 60_000) }),
    ]);
    const res = await app.fetch(req('GET', GET_PATH, { jwt }));
    expect(res.status).toBe(200);
    expect((await res.json()).location).toBeNull();
    expect(vi.mocked(db.delete)).toHaveBeenCalledTimes(1); // expired row deleted outright
  });

  it('serves a fresh until_arrive report inside the window', async () => {
    const jwt = await getTestJwt();
    pushGetPreamble();
    mockSelectQueue.push([
      locationShareRow({
        mode: 'until_arrive',
        destination: {
          name: 'Home',
          latitude: 35.66,
          longitude: 139.74,
          radiusMeters: 150,
        },
        reportedAt: new Date(currentNow - 14 * 60_000),
      }),
    ]);
    const res = await app.fetch(req('GET', GET_PATH, { jwt }));
    const body = await res.json();
    expect(body.location.mode).toBe('until_arrive');
    expect(body.location.destination).toMatchObject({ name: 'Home' });
    expect(vi.mocked(db.update)).not.toHaveBeenCalled(); // no consumption for live modes
  });

  it('serves a one-time grant exactly once, then marks it consumed', async () => {
    const jwt = await getTestJwt();
    pushGetPreamble();
    mockSelectQueue.push([
      locationShareRow({
        mode: 'on_request_granted',
        reportedAt: new Date(currentNow - 60_000),
      }),
    ]);
    mockWriteResult = [{ id: '00000000-0000-0000-0000-000000000040' }];

    const first = await app.fetch(req('GET', GET_PATH, { jwt }));
    const firstBody = await first.json();
    expect(firstBody.location).not.toBeNull();
    expect(firstBody.location.mode).toBe('on_request_granted');
    expect(vi.mocked(db.update)).toHaveBeenCalledTimes(1); // consumed atomically
  });

  it('never serves an already-consumed grant again', async () => {
    const jwt = await getTestJwt();
    pushGetPreamble();
    mockSelectQueue.push([
      locationShareRow({
        mode: 'on_request_granted',
        consumedAt: new Date(currentNow - 30_000),
      }),
    ]);
    const res = await app.fetch(req('GET', GET_PATH, { jwt }));
    expect((await res.json()).location).toBeNull();
    expect(vi.mocked(db.update)).not.toHaveBeenCalled();
  });

  it('withholds a consumed grant even when a racing read already consumed it', async () => {
    const jwt = await getTestJwt();
    pushGetPreamble();
    mockSelectQueue.push([
      locationShareRow({ mode: 'on_request_granted' }),
    ]);
    mockWriteResult = []; // the scoped UPDATE matched nothing — raced
    const res = await app.fetch(req('GET', GET_PATH, { jwt }));
    expect((await res.json()).location).toBeNull();
  });

  it('withholds a stale grant (over the 5-minute window) and purges it', async () => {
    const jwt = await getTestJwt();
    pushGetPreamble();
    mockSelectQueue.push([
      locationShareRow({
        mode: 'on_request_granted',
        reportedAt: new Date(currentNow - 6 * 60_000),
      }),
    ]);
    const res = await app.fetch(req('GET', GET_PATH, { jwt }));
    expect((await res.json()).location).toBeNull();
    expect(vi.mocked(db.delete)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(db.update)).not.toHaveBeenCalled();
  });

  it('returns null when the partner has no share row at all', async () => {
    const jwt = await getTestJwt();
    pushGetPreamble();
    mockSelectQueue.push([]);
    const res = await app.fetch(req('GET', GET_PATH, { jwt }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      location: null,
      youConsented: true,
      partnerConsented: true,
    });
  });
});

// ── POST /v1/spaces/current/location/share ───────────────────────────────

describe('POST /v1/spaces/current/location/share', () => {
  const validBody = {
    mode: 'live',
    latitude: 35.658,
    longitude: 139.7454,
    accuracyMeters: 20,
  };

  it('returns 401 without auth', async () => {
    const res = await app.fetch(req('POST', SHARE_PATH, { body: validBody }));
    expect(res.status).toBe(401);
  });

  it('upserts when both consented', async () => {
    const jwt = await getTestJwt();
    pushGetPreamble();
    const res = await app.fetch(req('POST', SHARE_PATH, { jwt, body: validBody }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(vi.mocked(db.insert)).toHaveBeenCalledTimes(1);
    expect(notifyPartnerInSpace).not.toHaveBeenCalled();
  });

  it('refuses with 403 when the partner has not consented', async () => {
    const jwt = await getTestJwt();
    pushGetPreamble([
      memberConsentRow(TEST_USER_ID, new Date(currentNow)),
      memberConsentRow(TEST_OTHER_USER_ID, null),
    ]);
    const res = await app.fetch(req('POST', SHARE_PATH, { jwt, body: validBody }));
    expect(res.status).toBe(403);
    expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
  });

  it('refuses with 403 when the caller has not consented', async () => {
    const jwt = await getTestJwt();
    pushGetPreamble([
      memberConsentRow(TEST_USER_ID, null),
      memberConsentRow(TEST_OTHER_USER_ID, new Date(currentNow)),
    ]);
    const res = await app.fetch(req('POST', SHARE_PATH, { jwt, body: validBody }));
    expect(res.status).toBe(403);
    expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
  });

  it('is hard-off (403) in an archived space', async () => {
    const jwt = await getTestJwt();
    pushGetPreamble(consentedSpaceMembers(), spaceRow({ archivedAt: new Date(currentNow) }));
    const res = await app.fetch(req('POST', SHARE_PATH, { jwt, body: validBody }));
    expect(res.status).toBe(403);
    expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
  });

  it('returns 400 when the caller has no space', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([]);
    const res = await app.fetch(req('POST', SHARE_PATH, { jwt, body: validBody }));
    expect(res.status).toBe(400);
  });

  it('notifies the partner with location_granted when a request is approved', async () => {
    const jwt = await getTestJwt();
    pushGetPreamble();
    mockSelectQueue.push([{ displayName: 'Mara' }]);
    const res = await app.fetch(
      req('POST', SHARE_PATH, {
        jwt,
        body: { ...validBody, mode: 'on_request_granted' },
      })
    );
    expect(res.status).toBe(201);
    expect(notifyPartnerInSpace).toHaveBeenCalledTimes(1);
    expect(notifyPartnerInSpace).toHaveBeenCalledWith(
      TEST_SPACE_ID,
      TEST_USER_ID,
      'location_granted',
      {},
      'Mara'
    );
  });

  describe('validation 400s never echo coordinates', () => {
    const invalidBodies: Array<[string, unknown]> = [
      ['latitude out of range', { ...validBody, latitude: 95 }],
      ['latitude negative out of range', { ...validBody, latitude: -90.5 }],
      ['longitude out of range', { ...validBody, longitude: 181 }],
      ['non-numeric latitude', { ...validBody, latitude: 'north' }],
      ['missing latitude', { mode: 'live', longitude: 139.7 }],
      ['zero accuracy', { ...validBody, accuracyMeters: 0 }],
      ['negative accuracy', { ...validBody, accuracyMeters: -4 }],
      ['implausible accuracy', { ...validBody, accuracyMeters: 50_001 }],
      ['unknown mode', { ...validBody, mode: 'always' }],
      ['until_arrive without destination', { ...validBody, mode: 'until_arrive' }],
      ['NaN latitude', { ...validBody, latitude: Number.NaN }],
    ];

    it.each(invalidBodies)('rejects %s with a 400', async (_label, body) => {
      const jwt = await getTestJwt();
      const res = await app.fetch(req('POST', SHARE_PATH, { jwt, body }));
      expect(res.status).toBe(400);
      expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
    });

    it('error messages contain no digits — nothing resembling coordinates', async () => {
      const jwt = await getTestJwt();
      const res = await app.fetch(
        req('POST', SHARE_PATH, { jwt, body: { ...validBody, latitude: 123.456 } })
      );
      expect(res.status).toBe(400);
      const text = JSON.stringify(await res.json());
      const messages = [...text.matchAll(/"message":"([^"]*)"/g)].map((m) => m[1]);
      expect(messages.length).toBeGreaterThan(0);
      for (const message of messages) {
        expect(message).not.toMatch(/\d/);
      }
    });
  });
});

// ── DELETE /v1/spaces/current/location/share ─────────────────────────────

describe('DELETE /v1/spaces/current/location/share', () => {
  it('returns 401 without auth', async () => {
    const res = await app.fetch(req('DELETE', SHARE_PATH));
    expect(res.status).toBe(401);
  });

  it('stops sharing and notifies the partner when a row existed', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([membershipRow()]);
    mockWriteResult = [{ id: '00000000-0000-0000-0000-000000000040' }];
    const res = await app.fetch(req('DELETE', SHARE_PATH, { jwt }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(vi.mocked(db.delete)).toHaveBeenCalledTimes(1);
    expect(notifyPartnerInSpace).toHaveBeenCalledWith(
      TEST_SPACE_ID,
      TEST_USER_ID,
      'location_stopped'
    );
  });

  it('is idempotent: deleting with no row still returns ok and stays quiet', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([membershipRow()]);
    mockWriteResult = []; // nothing deleted
    const res = await app.fetch(req('DELETE', SHARE_PATH, { jwt }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(notifyPartnerInSpace).not.toHaveBeenCalled();

    // Second stop — identical calm response.
    const again = await app.fetch(req('DELETE', SHARE_PATH, { jwt }));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true });
  });

  it('returns ok even without a space (nothing to stop, no existence leak)', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([]);
    const res = await app.fetch(req('DELETE', SHARE_PATH, { jwt }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(vi.mocked(db.delete)).not.toHaveBeenCalled();
  });
});

// ── POST /v1/spaces/current/location/consent ─────────────────────────────

describe('POST /v1/spaces/current/location/consent', () => {
  it('returns 401 without auth', async () => {
    const res = await app.fetch(req('POST', CONSENT_PATH, { body: { consented: true } }));
    expect(res.status).toBe(401);
  });

  it('opts in and reports both consent flags', async () => {
    const jwt = await getTestJwt();
    pushGetPreamble([
      memberConsentRow(TEST_USER_ID, null),
      memberConsentRow(TEST_OTHER_USER_ID, new Date(currentNow)),
    ]);
    const res = await app.fetch(
      req('POST', CONSENT_PATH, { jwt, body: { consented: true } })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      youConsented: true,
      partnerConsented: true,
    });
    expect(vi.mocked(db.update)).toHaveBeenCalledTimes(1);
    expect(notifyPartnerInSpace).not.toHaveBeenCalled();
  });

  it('opting out deletes any share row and notifies location_stopped', async () => {
    const jwt = await getTestJwt();
    pushGetPreamble();
    mockWriteResult = [{ id: '00000000-0000-0000-0000-000000000040' }];
    const res = await app.fetch(
      req('POST', CONSENT_PATH, { jwt, body: { consented: false } })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      youConsented: false,
      partnerConsented: true,
    });
    expect(vi.mocked(db.delete)).toHaveBeenCalledTimes(1);
    expect(notifyPartnerInSpace).toHaveBeenCalledWith(
      TEST_SPACE_ID,
      TEST_USER_ID,
      'location_stopped'
    );
  });

  it('opting out with nothing shared stays quiet', async () => {
    const jwt = await getTestJwt();
    pushGetPreamble();
    mockWriteResult = [];
    const res = await app.fetch(
      req('POST', CONSENT_PATH, { jwt, body: { consented: false } })
    );
    expect(res.status).toBe(200);
    expect(notifyPartnerInSpace).not.toHaveBeenCalled();
  });

  it('is hard-off (403) in an archived space', async () => {
    const jwt = await getTestJwt();
    pushGetPreamble(consentedSpaceMembers(), spaceRow({ archivedAt: new Date(currentNow) }));
    const res = await app.fetch(
      req('POST', CONSENT_PATH, { jwt, body: { consented: true } })
    );
    expect(res.status).toBe(403);
  });

  it('rejects a malformed body with 400', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(
      req('POST', CONSENT_PATH, { jwt, body: { consented: 'yes' } })
    );
    expect(res.status).toBe(400);
  });
});

// ── POST /v1/spaces/current/location/request ─────────────────────────────

describe('POST /v1/spaces/current/location/request', () => {
  it('returns 401 without auth', async () => {
    const res = await app.fetch(req('POST', REQUEST_PATH, { body: {} }));
    expect(res.status).toBe(401);
  });

  it('sends a location_request push with the sender name and no coordinates', async () => {
    const jwt = await getTestJwt();
    pushGetPreamble();
    mockSelectQueue.push([{ displayName: 'Mara' }]);
    const res = await app.fetch(req('POST', REQUEST_PATH, { jwt, body: {} }));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true });
    expect(notifyPartnerInSpace).toHaveBeenCalledTimes(1);
    const [spaceId, fromUserId, kind, data] = vi.mocked(notifyPartnerInSpace).mock.calls[0];
    expect(spaceId).toBe(TEST_SPACE_ID);
    expect(fromUserId).toBe(TEST_USER_ID);
    expect(kind).toBe('location_request');
    // The data payload is empty by construction — coordinates never ride
    // along in a push.
    expect(data).toEqual({});
    expect(JSON.stringify(vi.mocked(notifyPartnerInSpace).mock.calls[0])).not.toMatch(
      /35\.658|139\.74/
    );
  });

  it('refuses with 403 when the requester has not consented (mutuality)', async () => {
    const jwt = await getTestJwt();
    pushGetPreamble([
      memberConsentRow(TEST_USER_ID, null),
      memberConsentRow(TEST_OTHER_USER_ID, new Date(currentNow)),
    ]);
    const res = await app.fetch(req('POST', REQUEST_PATH, { jwt, body: {} }));
    expect(res.status).toBe(403);
    expect(notifyPartnerInSpace).not.toHaveBeenCalled();
  });

  it('is hard-off (403) in an archived space', async () => {
    const jwt = await getTestJwt();
    pushGetPreamble(consentedSpaceMembers(), spaceRow({ archivedAt: new Date(currentNow) }));
    const res = await app.fetch(req('POST', REQUEST_PATH, { jwt, body: {} }));
    expect(res.status).toBe(403);
  });

  it('rate-limits to 3 requests per minute per sender', async () => {
    const jwt = await getTestJwt();

    // Earlier tests in this block spent part of the budget — roll the
    // window forward so this test measures a clean 3 + 1.
    vi.advanceTimersByTime(61_000);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      pushGetPreamble();
      mockSelectQueue.push([{ displayName: 'Mara' }]);
      const ok = await app.fetch(req('POST', REQUEST_PATH, { jwt, body: {} }));
      expect(ok.status).toBe(202);
    }

    pushGetPreamble();
    mockSelectQueue.push([{ displayName: 'Mara' }]);
    const blocked = await app.fetch(req('POST', REQUEST_PATH, { jwt, body: {} }));
    expect(blocked.status).toBe(429);
    expect(notifyPartnerInSpace).toHaveBeenCalledTimes(3);
  });
});
