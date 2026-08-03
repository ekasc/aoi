import { vi, describe, it, expect, beforeEach } from 'vitest';
import { app, getTestJwt, req, TEST_USER_ID, TEST_OTHER_USER_ID, TEST_SPACE_ID, TEST_MOMENT_ID } from '../helpers/test-app.js';

vi.stubEnv('JWT_SECRET', 'test-jwt-secret-for-testing');
vi.stubEnv('CORS_ORIGIN', '*');

const mockSelectQueue: any[][] = [];
let mockReturningResult: any[] = [];
const insertCalls: any[] = [];

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
  const chain = {
    values: vi.fn((value: any) => {
      insertCalls.push(value);
      return chain;
    }),
    returning: vi.fn(() => Promise.resolve(mockReturningResult)),
    then: (resolve: Function) => resolve(mockReturningResult),
  };
  return chain;
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
    // Runs the callback with the same mocked chains so handlers can be
    // tested without a real database.
    transaction: vi.fn((callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        select: () => selectChain(),
        insert: () => insertChain(),
        update: () => updateChain(),
      })
    ),
  },
}));

beforeEach(() => {
  mockSelectQueue.length = 0;
  mockReturningResult = [];
  insertCalls.length = 0;
});

function momentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_MOMENT_ID,
    spaceId: TEST_SPACE_ID,
    type: 'note' as const,
    title: 'Test moment',
    body: 'Test body',
    occurredAt: new Date('2026-03-15T10:00:00Z'),
    targetAt: null,
    createdAt: new Date('2026-03-15T10:00:00Z'),
    updatedAt: new Date('2026-03-15T10:00:00Z'),
    createdByUserId: TEST_USER_ID,
    authorRole: 'you' as const,
    authorName: 'You',
    mediaPreview: null,
    ...overrides,
  };
}

function spaceMemberRow(overrides: Record<string, unknown> = {}) {
  return { spaceId: TEST_SPACE_ID, userId: TEST_USER_ID, state: 'active' as const, ...overrides };
}

describe('POST /v1/spaces/current/moments', () => {
  it('returns 401 without auth', async () => {
    const res = await app.fetch(req('POST', '/v1/spaces/current/moments'));
    expect(res.status).toBe(401);
  });

  it('returns 400 for missing body', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('POST', '/v1/spaces/current/moments', { jwt }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid type', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('POST', '/v1/spaces/current/moments', {
      jwt, body: { type: 'invalid' },
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when user has no active space', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([]);
    const res = await app.fetch(req('POST', '/v1/spaces/current/moments', {
      jwt, body: { type: 'note' },
    }));
    expect(res.status).toBe(400);
  });

  it('returns 201 for valid moment', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([spaceMemberRow()]);
    mockReturningResult = [momentRow()];
    const res = await app.fetch(req('POST', '/v1/spaces/current/moments', {
      jwt, body: { type: 'note', title: 'Hello', body: 'World' },
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ id: TEST_MOMENT_ID, type: 'note' });
  });

  it('accepts media type with mediaPreview', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([spaceMemberRow()]);
    mockReturningResult = [momentRow({ type: 'media' as const, mediaPreview: 'https://cdn.example.com/img.jpg' })];
    const res = await app.fetch(req('POST', '/v1/spaces/current/moments', {
      jwt, body: { type: 'media', mediaPreview: 'https://cdn.example.com/img.jpg' },
    }));
    expect(res.status).toBe(201);
  });
});

describe('GET /v1/spaces/current/moments', () => {
  it('returns 401 without auth', async () => {
    const res = await app.fetch(req('GET', '/v1/spaces/current/moments'));
    expect(res.status).toBe(401);
  });

  it('returns empty when user has no space', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([]);
    const res = await app.fetch(req('GET', '/v1/spaces/current/moments', { jwt }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ moments: [], nextCursor: undefined });
  });

  it('returns moments list with nextCursor', async () => {
    const jwt = await getTestJwt();
    const moments = Array.from({ length: 11 }, (_, i) =>
      momentRow({ id: `${TEST_MOMENT_ID.slice(0, -1)}${i}`, occurredAt: new Date(2026, 2, 15 - i) })
    );
    mockSelectQueue.push([spaceMemberRow()], moments);
    const res = await app.fetch(req('GET', '/v1/spaces/current/moments?limit=10', { jwt }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('moments');
    expect(body.moments.length).toBe(10);
    expect(body.nextCursor).toBeTruthy();
  });

  it('returns empty moments for empty DB', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([spaceMemberRow()], []);
    const res = await app.fetch(req('GET', '/v1/spaces/current/moments', { jwt }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.moments).toEqual([]);
  });

  it('validates cursor format', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('GET', '/v1/spaces/current/moments?cursor=invalid', { jwt }));
    expect(res.status).toBe(400);
  });
});

describe('PATCH /v1/moments/:id', () => {
  it('returns 401 without auth', async () => {
    const res = await app.fetch(req('PATCH', `/v1/moments/${TEST_MOMENT_ID}`));
    expect(res.status).toBe(401);
  });

  it('returns 404 for non-existent moment', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([]);
    const res = await app.fetch(req('PATCH', `/v1/moments/${TEST_MOMENT_ID}`, {
      jwt, body: { title: 'Updated' },
    }));
    expect(res.status).toBe(404);
  });

  it('returns 403 when updating another user\'s moment', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([momentRow({ createdByUserId: TEST_OTHER_USER_ID })]);
    const res = await app.fetch(req('PATCH', `/v1/moments/${TEST_MOMENT_ID}`, {
      jwt, body: { title: 'Updated' },
    }));
    expect(res.status).toBe(403);
  });

  it('returns 200 for valid update', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([momentRow()], [spaceMemberRow()]);
    mockReturningResult = [momentRow({ title: 'Updated' })];
    const res = await app.fetch(req('PATCH', `/v1/moments/${TEST_MOMENT_ID}`, {
      jwt, body: { title: 'Updated' },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('id');
  });

  it('validates title max length', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('PATCH', `/v1/moments/${TEST_MOMENT_ID}`, {
      jwt, body: { title: 'x'.repeat(501) },
    }));
    expect(res.status).toBe(400);
  });

  it('records a moment_edited activity row in the same transaction', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([momentRow()], [spaceMemberRow()]);
    mockReturningResult = [momentRow({ title: 'Updated' })];
    const res = await app.fetch(req('PATCH', `/v1/moments/${TEST_MOMENT_ID}`, {
      jwt, body: { title: 'Updated' },
    }));
    expect(res.status).toBe(200);
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]).toMatchObject({
      spaceId: TEST_SPACE_ID,
      actorUserId: TEST_USER_ID,
      kind: 'moment_edited',
      subjectId: TEST_MOMENT_ID,
    });
  });

  it('does not record activity when the moment belongs to someone else', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([momentRow({ createdByUserId: TEST_OTHER_USER_ID })]);
    const res = await app.fetch(req('PATCH', `/v1/moments/${TEST_MOMENT_ID}`, {
      jwt, body: { title: 'Updated' },
    }));
    expect(res.status).toBe(403);
    expect(insertCalls).toHaveLength(0);
  });
});

describe('DELETE /v1/moments/:id', () => {
  it('returns 401 without auth', async () => {
    const res = await app.fetch(req('DELETE', `/v1/moments/${TEST_MOMENT_ID}`));
    expect(res.status).toBe(401);
  });

  it('returns 404 for non-existent moment', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([]);
    const res = await app.fetch(req('DELETE', `/v1/moments/${TEST_MOMENT_ID}`, { jwt }));
    expect(res.status).toBe(404);
  });

  it('returns 403 when deleting another user\'s moment', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([momentRow({ createdByUserId: TEST_OTHER_USER_ID })]);
    const res = await app.fetch(req('DELETE', `/v1/moments/${TEST_MOMENT_ID}`, { jwt }));
    expect(res.status).toBe(403);
  });

  it('returns 200 for valid delete', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([momentRow()], [spaceMemberRow()]);
    const res = await app.fetch(req('DELETE', `/v1/moments/${TEST_MOMENT_ID}`, { jwt }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it('records a moment_deleted activity row in the same transaction', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([momentRow()], [spaceMemberRow()]);
    const res = await app.fetch(req('DELETE', `/v1/moments/${TEST_MOMENT_ID}`, { jwt }));
    expect(res.status).toBe(200);
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]).toMatchObject({
      spaceId: TEST_SPACE_ID,
      actorUserId: TEST_USER_ID,
      kind: 'moment_deleted',
      subjectId: TEST_MOMENT_ID,
    });
  });

  it('does not record activity when the moment belongs to someone else', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([momentRow({ createdByUserId: TEST_OTHER_USER_ID })]);
    const res = await app.fetch(req('DELETE', `/v1/moments/${TEST_MOMENT_ID}`, { jwt }));
    expect(res.status).toBe(403);
    expect(insertCalls).toHaveLength(0);
  });
});
