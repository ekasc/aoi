import { vi, describe, it, expect, beforeEach } from 'vitest';
import { app, getTestJwt, req, TEST_USER_ID, TEST_SPACE_ID } from '../helpers/test-app.js';

vi.stubEnv('JWT_SECRET', 'test-jwt-secret-for-testing');
vi.stubEnv('CORS_ORIGIN', '*');

const mockSelectQueue: any[][] = [];

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

vi.mock('../../db/index.js', () => ({
  db: {
    select: vi.fn(() => selectChain()),
  },
}));

beforeEach(() => {
  mockSelectQueue.length = 0;
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
});
