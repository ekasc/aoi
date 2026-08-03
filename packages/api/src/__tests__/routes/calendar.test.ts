import { vi, describe, it, expect, beforeEach } from 'vitest';
import { app, getTestJwt, req, TEST_USER_ID, TEST_OTHER_USER_ID, TEST_SPACE_ID, TEST_EVENT_ID } from '../helpers/test-app.js';

vi.stubEnv('JWT_SECRET', 'test-jwt-secret-for-testing');
vi.stubEnv('CORS_ORIGIN', '*');

const mockSelectQueue: any[][] = [];
let mockReturningResult: any[] = [];

function selectChain() {
  return {
    from: vi.fn(() => selectChain()),
    where: vi.fn(() => selectChain()),
    orderBy: vi.fn(() => selectChain()),
    limit: vi.fn((n: number) => Promise.resolve(mockSelectQueue.shift() ?? [])),
    then: (resolve: Function) => resolve(mockSelectQueue.shift() ?? []),
  };
}

function insertChain() {
  return {
    values: vi.fn(() => insertChain()),
    returning: vi.fn(() => Promise.resolve(mockReturningResult)),
    then: (resolve: Function) => resolve(mockReturningResult),
  };
}

function updateChain() {
  return {
    set: vi.fn(() => updateChain()),
    where: vi.fn(() => updateChain()),
    returning: vi.fn(() => Promise.resolve(mockReturningResult)),
    then: (resolve: Function) => resolve(mockReturningResult),
  };
}

vi.mock('../../db/index.js', () => ({
  db: {
    select: vi.fn(() => selectChain()),
    insert: vi.fn(() => insertChain()),
    update: vi.fn(() => updateChain()),
  },
}));

beforeEach(() => {
  mockSelectQueue.length = 0;
  mockReturningResult = [];
});

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_EVENT_ID,
    spaceId: TEST_SPACE_ID,
    createdByUserId: TEST_USER_ID,
    actor: 'you' as const,
    actorName: 'You',
    title: 'Test event',
    startsAt: new Date('2026-03-15T10:00:00Z'),
    endsAt: new Date('2026-03-15T11:00:00Z'),
    labelPreset: 'Date' as const,
    labelCustomText: null,
    createdAt: new Date('2026-03-15T09:00:00Z'),
    updatedAt: new Date('2026-03-15T09:00:00Z'),
    ...overrides,
  };
}

function spaceMemberRow(overrides: Record<string, unknown> = {}) {
  return { spaceId: TEST_SPACE_ID, userId: TEST_USER_ID, state: 'active' as const, ...overrides };
}

describe('GET /v1/spaces/current/calendar/events', () => {
  it('returns 401 without auth', async () => {
    const res = await app.fetch(req('GET', '/v1/spaces/current/calendar/events'));
    expect(res.status).toBe(401);
  });

  it('returns 400 without from/to', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('GET', '/v1/spaces/current/calendar/events', { jwt }));
    expect(res.status).toBe(400);
  });

  it('returns empty when user has no space', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([]);
    const res = await app.fetch(
      req('GET', '/v1/spaces/current/calendar/events?from=2026-03-01T00:00:00Z&to=2026-03-31T23:59:59Z', { jwt })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it('returns events array with correct shape', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([spaceMemberRow()], [eventRow()]);
    const res = await app.fetch(
      req('GET', '/v1/spaces/current/calendar/events?from=2026-03-01T00:00:00Z&to=2026-03-31T23:59:59Z', { jwt })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    if (body.length > 0) {
      expect(body[0]).toMatchObject({ id: TEST_EVENT_ID, title: 'Test event' });
    }
  });
});

describe('GET /v1/calendar/events/:id', () => {
  it('returns 401 without auth', async () => {
    const res = await app.fetch(req('GET', `/v1/calendar/events/${TEST_EVENT_ID}`));
    expect(res.status).toBe(401);
  });

  it('returns 404 for non-existent event', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([]);
    const res = await app.fetch(req('GET', `/v1/calendar/events/${TEST_EVENT_ID}`, { jwt }));
    expect(res.status).toBe(404);
  });

  it('returns 404 when user not in event space', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([eventRow({ spaceId: TEST_SPACE_ID })], []);
    const res = await app.fetch(req('GET', `/v1/calendar/events/${TEST_EVENT_ID}`, { jwt }));
    expect(res.status).toBe(404);
  });
});

describe('POST /v1/spaces/current/calendar/events', () => {
  it('returns 401 without auth', async () => {
    const res = await app.fetch(req('POST', '/v1/spaces/current/calendar/events'));
    expect(res.status).toBe(401);
  });

  it('returns 400 for missing title', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('POST', '/v1/spaces/current/calendar/events', {
      jwt, body: { startsAt: '2026-03-15T10:00:00Z', endsAt: '2026-03-15T11:00:00Z', actor: 'you', actorName: 'You', label: { preset: 'Date' } },
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid label preset', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('POST', '/v1/spaces/current/calendar/events', {
      jwt, body: { title: 'Test', startsAt: '2026-03-15T10:00:00Z', endsAt: '2026-03-15T11:00:00Z', actor: 'you', actorName: 'You', label: { preset: 'Invalid' } },
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when user has no space', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([]);
    const res = await app.fetch(req('POST', '/v1/spaces/current/calendar/events', {
      jwt, body: { title: 'Test', startsAt: '2026-03-15T10:00:00Z', endsAt: '2026-03-15T11:00:00Z', actor: 'you', actorName: 'You', label: { preset: 'Date' } },
    }));
    expect(res.status).toBe(400);
  });

  it('returns 201 for valid event', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([spaceMemberRow()]);
    mockReturningResult = [eventRow()];
    const res = await app.fetch(req('POST', '/v1/spaces/current/calendar/events', {
      jwt, body: { title: 'Test event', startsAt: '2026-03-15T10:00:00Z', endsAt: '2026-03-15T11:00:00Z', actor: 'you', actorName: 'You', label: { preset: 'Date' } },
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ id: TEST_EVENT_ID });
  });
});

describe('PATCH /v1/calendar/events/:id', () => {
  it('returns 401 without auth', async () => {
    const res = await app.fetch(req('PATCH', `/v1/calendar/events/${TEST_EVENT_ID}`));
    expect(res.status).toBe(401);
  });

  it('returns 404 for non-existent event', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([]);
    const res = await app.fetch(req('PATCH', `/v1/calendar/events/${TEST_EVENT_ID}`, { jwt, body: { title: 'Updated' } }));
    expect(res.status).toBe(404);
  });

  it('returns 403 when updating another user\'s event', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([eventRow({ createdByUserId: TEST_OTHER_USER_ID })]);
    const res = await app.fetch(req('PATCH', `/v1/calendar/events/${TEST_EVENT_ID}`, { jwt, body: { title: 'Updated' } }));
    expect(res.status).toBe(403);
  });

  it('returns 200 for valid update', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([eventRow()], [spaceMemberRow()]);
    mockReturningResult = [eventRow({ title: 'Updated' })];
    const res = await app.fetch(req('PATCH', `/v1/calendar/events/${TEST_EVENT_ID}`, { jwt, body: { title: 'Updated' } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('id');
  });
});

describe('DELETE /v1/calendar/events/:id', () => {
  it('returns 401 without auth', async () => {
    const res = await app.fetch(req('DELETE', `/v1/calendar/events/${TEST_EVENT_ID}`));
    expect(res.status).toBe(401);
  });

  it('returns 404 for non-existent event', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([]);
    const res = await app.fetch(req('DELETE', `/v1/calendar/events/${TEST_EVENT_ID}`, { jwt }));
    expect(res.status).toBe(404);
  });

  it('returns 200 for valid delete', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([eventRow()], [spaceMemberRow()]);
    const res = await app.fetch(req('DELETE', `/v1/calendar/events/${TEST_EVENT_ID}`, { jwt }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });
});
