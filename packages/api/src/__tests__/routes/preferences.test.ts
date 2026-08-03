import { vi, describe, it, expect, beforeEach } from 'vitest';
import { app, getTestJwt, req, TEST_USER_ID } from '../helpers/test-app.js';

vi.stubEnv('JWT_SECRET', 'test-jwt-secret-for-testing');
vi.stubEnv('CORS_ORIGIN', '*');

let mockSelectResult: any[] = [];
let mockReturningResult: any[] = [];

function selectChain() {
  return {
    from: vi.fn(() => selectChain()),
    where: vi.fn(() => selectChain()),
    limit: vi.fn((n: number) => Promise.resolve(mockSelectResult)),
    then: (resolve: Function) => resolve(mockSelectResult),
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
  mockSelectResult = [];
  mockReturningResult = [];
});

describe('GET /v1/users/me/preferences', () => {
  it('returns 401 without auth', async () => {
    const res = await app.fetch(req('GET', '/v1/users/me/preferences'));
    expect(res.status).toBe(401);
  });

  it('returns default preferences when none stored', async () => {
    const jwt = await getTestJwt();
    mockSelectResult = [];
    const res = await app.fetch(req('GET', '/v1/users/me/preferences', { jwt }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('themeId');
    expect(body.themeId).toBe('sunset-shore');
  });

  it('returns stored preferences', async () => {
    const jwt = await getTestJwt();
    mockSelectResult = [{ userId: TEST_USER_ID, themeId: 'sea-glass' }];
    const res = await app.fetch(req('GET', '/v1/users/me/preferences', { jwt }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.themeId).toBe('sea-glass');
  });
});

describe('PATCH /v1/users/me/preferences', () => {
  it('returns 401 without auth', async () => {
    const res = await app.fetch(req('PATCH', '/v1/users/me/preferences', {
      body: { themeId: 'sea-glass' },
    }));
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid themeId', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('PATCH', '/v1/users/me/preferences', {
      jwt, body: { themeId: 'invalid-theme' },
    }));
    expect(res.status).toBe(400);
  });

  it('returns 200 for valid upsert (existing)', async () => {
    const jwt = await getTestJwt();
    mockSelectResult = [{ userId: TEST_USER_ID, themeId: 'sunset-shore' }];
    mockReturningResult = [{ userId: TEST_USER_ID, themeId: 'deep-ocean' }];
    const res = await app.fetch(req('PATCH', '/v1/users/me/preferences', {
      jwt, body: { themeId: 'deep-ocean' },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('themeId');
    expect(body.themeId).toBe('deep-ocean');
  });

  it('returns 200 for valid upsert (new)', async () => {
    const jwt = await getTestJwt();
    mockSelectResult = [];
    mockReturningResult = [{ userId: TEST_USER_ID, themeId: 'sea-glass' }];
    const res = await app.fetch(req('PATCH', '/v1/users/me/preferences', {
      jwt, body: { themeId: 'sea-glass' },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.themeId).toBe('sea-glass');
  });
});
