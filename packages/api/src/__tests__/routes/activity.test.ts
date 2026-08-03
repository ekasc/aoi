import { vi, describe, it, expect, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { app, getTestJwt, req, TEST_USER_ID, TEST_SPACE_ID } from '../helpers/test-app.js';

vi.stubEnv('JWT_SECRET', 'test-jwt-secret-for-testing');
vi.stubEnv('CORS_ORIGIN', '*');

const mockSelectQueue: any[][] = [];
const deleteCalls: unknown[] = [];
let mockDeleteWhereError: Error | null = null;

function selectChain() {
  return {
    from: vi.fn(() => selectChain()),
    innerJoin: vi.fn(() => selectChain()),
    where: vi.fn(() => selectChain()),
    orderBy: vi.fn(() => selectChain()),
    limit: vi.fn(() => Promise.resolve(mockSelectQueue.shift() ?? [])),
    then: (resolve: Function) => resolve(mockSelectQueue.shift() ?? []),
  };
}

function deleteChain() {
  return {
    where: vi.fn((predicate: unknown) => {
      deleteCalls.push(predicate);
      if (mockDeleteWhereError) {
        return Promise.reject(mockDeleteWhereError);
      }
      return Promise.resolve([]);
    }),
  };
}

vi.mock('../../db/index.js', () => ({
  db: {
    select: vi.fn(() => selectChain()),
    delete: vi.fn(() => deleteChain()),
  },
}));

beforeEach(() => {
  mockSelectQueue.length = 0;
  deleteCalls.length = 0;
  mockDeleteWhereError = null;
});

function spaceMemberRow(overrides: Record<string, unknown> = {}) {
  return { spaceId: TEST_SPACE_ID, userId: TEST_USER_ID, state: 'active' as const, ...overrides };
}

function activityRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-0000-0000-000000000040',
    kind: 'moment_deleted' as const,
    actorName: 'Sam',
    occurredAt: new Date(),
    ...overrides,
  };
}

describe('GET /v1/spaces/current/activity', () => {
  it('returns 401 without auth', async () => {
    const res = await app.fetch(req('GET', '/v1/spaces/current/activity'));
    expect(res.status).toBe(401);
  });

  it('returns empty activity when user has no active space', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([]);
    const res = await app.fetch(req('GET', '/v1/spaces/current/activity', { jwt }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ activity: [] });
  });

  it('returns only fact + actor fields, never moment content', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([spaceMemberRow()], [activityRow()]);
    const res = await app.fetch(req('GET', '/v1/spaces/current/activity', { jwt }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activity).toHaveLength(1);
    // Privacy: the exact key set — no title/body/media/subject payload.
    expect(Object.keys(body.activity[0]).sort()).toEqual(
      ['actorName', 'id', 'kind', 'occurredAt'].sort()
    );
    expect(body.activity[0]).toMatchObject({
      id: '00000000-0000-0000-0000-000000000040',
      kind: 'moment_deleted',
      actorName: 'Sam',
    });
    expect(typeof body.activity[0].occurredAt).toBe('string');
  });

  it('rejects an invalid since param', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(
      req('GET', '/v1/spaces/current/activity?since=not-a-date', { jwt })
    );
    expect(res.status).toBe(400);
  });

  it('excludes rows older than 7 days', async () => {
    const jwt = await getTestJwt();
    const stale = activityRow({
      id: '00000000-0000-0000-0000-000000000041',
      occurredAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    });
    const recent = activityRow({
      id: '00000000-0000-0000-0000-000000000042',
      occurredAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });
    mockSelectQueue.push([spaceMemberRow()], [stale, recent]);
    const res = await app.fetch(req('GET', '/v1/spaces/current/activity', { jwt }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activity).toHaveLength(1);
    expect(body.activity[0].id).toBe('00000000-0000-0000-0000-000000000042');
  });

  it('never widens the window past 7 days even with an older since param', async () => {
    const jwt = await getTestJwt();
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const stale = activityRow({
      id: '00000000-0000-0000-0000-000000000043',
      // Inside the requested `since` window, but outside the 7-day clamp.
      occurredAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    });
    mockSelectQueue.push([spaceMemberRow()], [stale]);
    const res = await app.fetch(
      req('GET', `/v1/spaces/current/activity?since=${tenDaysAgo.toISOString()}`, { jwt })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activity).toEqual([]);
  });

  // Retention purge. The helper DB here is a mock chain (no real rows), so
  // determinism comes from asserting the exact purge statement issued: rows
  // older than the cutoff for this space are deleted on read, which is what
  // removes them from every subsequent call.
  it('purges rows older than the 7-day retention window for the current space', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([spaceMemberRow()], [activityRow()]);
    const res = await app.fetch(req('GET', '/v1/spaces/current/activity', { jwt }));
    expect(res.status).toBe(200);
    expect(deleteCalls).toHaveLength(1);

    const rendered = new PgDialect().sqlToQuery(deleteCalls[0] as SQL);
    expect(rendered.sql).toBe(
      '("space_activity"."space_id" = $1 and "space_activity"."occurred_at" < $2)'
    );
    expect(rendered.params[0]).toBe(TEST_SPACE_ID);
    // Cutoff is the 7-day retention boundary evaluated at request time.
    const cutoff = new Date(rendered.params[1] as string);
    const expectedCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoff.getTime() - expectedCutoff)).toBeLessThan(5000);
  });

  it('does not purge when the user has no active space', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([]);
    const res = await app.fetch(req('GET', '/v1/spaces/current/activity', { jwt }));
    expect(res.status).toBe(200);
    expect(deleteCalls).toHaveLength(0);
  });

  it('still responds when the best-effort purge fails', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([spaceMemberRow()], [activityRow()]);
    mockDeleteWhereError = new Error('db unavailable');
    const res = await app.fetch(req('GET', '/v1/spaces/current/activity', { jwt }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activity).toHaveLength(1);
  });
});
