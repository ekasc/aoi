import { vi, describe, it, expect, beforeEach } from 'vitest';
import { app, getTestJwt, req, TEST_USER_ID, TEST_OTHER_USER_ID, TEST_SPACE_ID } from '../helpers/test-app.js';

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

function spaceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_SPACE_ID,
    name: 'Our Space',
    relationshipStartDate: '2026-01-15',
    createdByUserId: TEST_USER_ID,
    createdAt: new Date('2026-01-15T00:00:00Z'),
    updatedAt: new Date('2026-01-15T00:00:00Z'),
    ...overrides,
  };
}

function spaceMemberRow(overrides: Record<string, unknown> = {}) {
  return { spaceId: TEST_SPACE_ID, userId: TEST_USER_ID, state: 'active' as const, role: 'you' as const, ...overrides };
}

function inviteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'invite-1',
    spaceId: TEST_SPACE_ID,
    code: 'TEST-CODE-1234',
    codeNormalized: 'test-code-1234',
    createdByUserId: TEST_USER_ID,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    ...overrides,
  };
}

describe('GET /v1/spaces/current', () => {
  it('returns 401 without auth', async () => {
    const res = await app.fetch(req('GET', '/v1/spaces/current'));
    expect(res.status).toBe(401);
  });

  it('returns null when user has no space', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([]);
    const res = await app.fetch(req('GET', '/v1/spaces/current', { jwt }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ space: null, inviteCode: null });
  });

  it('returns space when user is member', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [spaceMemberRow()],
      [spaceRow()],
      [inviteRow()],
      [spaceMemberRow({ role: 'partner' as const })]
    );
    const res = await app.fetch(req('GET', '/v1/spaces/current', { jwt }));
    expect(res.status).toBe(200);
  });
});

describe('POST /v1/spaces', () => {
  it('returns 401 without auth', async () => {
    const res = await app.fetch(req('POST', '/v1/spaces'));
    expect(res.status).toBe(401);
  });

  it('returns 400 for missing name', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('POST', '/v1/spaces', {
      jwt, body: { partnerName: 'Partner', relationshipStartDate: '2026-01-15' },
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing partnerName', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('POST', '/v1/spaces', {
      jwt, body: { name: 'Our Space', relationshipStartDate: '2026-01-15' },
    }));
    expect(res.status).toBe(400);
  });

  it('returns 409 if user already has active space', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([spaceMemberRow()]);
    const res = await app.fetch(req('POST', '/v1/spaces', {
      jwt, body: { name: 'Our Space', partnerName: 'Partner', relationshipStartDate: '2026-01-15' },
    }));
    expect(res.status).toBe(409);
  });

  it('returns 201 for valid space creation', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([]);
    mockReturningResult = [spaceRow()];
    const res = await app.fetch(req('POST', '/v1/spaces', {
      jwt, body: { name: 'Our Space', partnerName: 'Partner', relationshipStartDate: '2026-01-15' },
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty('space');
    expect(body).toHaveProperty('inviteCode');
  });
});

describe('PATCH /v1/spaces/current', () => {
  it('returns 401 without auth', async () => {
    const res = await app.fetch(req('PATCH', '/v1/spaces/current'));
    expect(res.status).toBe(401);
  });

  it('returns 404 when user has no space', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([]);
    const res = await app.fetch(req('PATCH', '/v1/spaces/current', { jwt, body: { name: 'Updated' } }));
    expect(res.status).toBe(404);
  });

  it('returns 403 when non-creator tries to update', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([spaceMemberRow()], [spaceRow({ createdByUserId: TEST_OTHER_USER_ID })]);
    const res = await app.fetch(req('PATCH', '/v1/spaces/current', { jwt, body: { name: 'Updated' } }));
    expect(res.status).toBe(403);
  });

  it('returns 200 for valid update', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([spaceMemberRow()], [spaceRow()]);
    mockReturningResult = [spaceRow({ name: 'Updated' })];
    const res = await app.fetch(req('PATCH', '/v1/spaces/current', { jwt, body: { name: 'Updated' } }));
    expect(res.status).toBe(200);
  });
});

describe('POST /v1/spaces/join', () => {
  it('returns 401 without auth', async () => {
    const res = await app.fetch(req('POST', '/v1/spaces/join'));
    expect(res.status).toBe(401);
  });

  it('returns 400 for missing inviteCode', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('POST', '/v1/spaces/join', { jwt, body: {} }));
    expect(res.status).toBe(400);
  });

  it('returns 404 for invalid invite code', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([]);
    const res = await app.fetch(req('POST', '/v1/spaces/join', { jwt, body: { inviteCode: 'INVALID' } }));
    expect(res.status).toBe(404);
  });

  it('returns 409 if user already has space', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([inviteRow()], [spaceMemberRow()]);
    const res = await app.fetch(req('POST', '/v1/spaces/join', { jwt, body: { inviteCode: 'VALID-CODE' } }));
    expect(res.status).toBe(409);
  });
});
