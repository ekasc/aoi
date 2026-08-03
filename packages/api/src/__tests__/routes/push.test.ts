import { vi, describe, it, expect, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { app, getTestJwt, req, TEST_USER_ID, TEST_OTHER_USER_ID } from '../helpers/test-app.js';

vi.stubEnv('JWT_SECRET', 'test-jwt-secret-for-testing');
vi.stubEnv('CORS_ORIGIN', '*');

const VALID_TOKEN = 'ExponentPushToken[abcDEF123_-]';
const VALID_NEW_FORMAT_TOKEN = 'ExpoPushToken[abcDEF123_-]';
const TOKEN_ROW_ID = '00000000-0000-0000-0000-000000000050';

let mockReturningResult: any[] = [];
const insertValuesCalls: any[] = [];
const conflictSetCalls: any[] = [];
const deleteWhereCalls: unknown[] = [];

function insertChain() {
  const chain = {
    values: vi.fn((value: any) => {
      insertValuesCalls.push(value);
      return chain;
    }),
    onConflictDoUpdate: vi.fn((config: any) => {
      conflictSetCalls.push(config.set);
      return chain;
    }),
    returning: vi.fn(() => Promise.resolve(mockReturningResult)),
    then: (resolve: Function) => resolve(mockReturningResult),
  };
  return chain;
}

function deleteChain() {
  return {
    where: vi.fn((predicate: unknown) => {
      deleteWhereCalls.push(predicate);
      return Promise.resolve([]);
    }),
  };
}

vi.mock('../../db/index.js', () => ({
  db: {
    insert: vi.fn(() => insertChain()),
    delete: vi.fn(() => deleteChain()),
  },
}));

beforeEach(() => {
  mockReturningResult = [];
  insertValuesCalls.length = 0;
  conflictSetCalls.length = 0;
  deleteWhereCalls.length = 0;
});

function pushTokenRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TOKEN_ROW_ID,
    userId: TEST_USER_ID,
    expoPushToken: VALID_TOKEN,
    platform: 'ios' as const,
    createdAt: new Date('2026-08-01T10:00:00Z'),
    lastSeenAt: new Date('2026-08-01T10:00:00Z'),
    ...overrides,
  };
}

describe('POST /v1/push/tokens', () => {
  it('returns 401 without auth', async () => {
    const res = await app.fetch(req('POST', '/v1/push/tokens', {
      body: { expoPushToken: VALID_TOKEN },
    }));
    expect(res.status).toBe(401);
  });

  it('returns 400 when the token is missing', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('POST', '/v1/push/tokens', {
      jwt, body: { platform: 'ios' },
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for a token with the wrong prefix', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('POST', '/v1/push/tokens', {
      jwt, body: { expoPushToken: 'NotAToken[abc123]' },
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for a token without brackets', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('POST', '/v1/push/tokens', {
      jwt, body: { expoPushToken: 'ExponentPushTokenabc123' },
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for an empty bracket payload', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('POST', '/v1/push/tokens', {
      jwt, body: { expoPushToken: 'ExpoPushToken[]' },
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for an unknown platform', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('POST', '/v1/push/tokens', {
      jwt, body: { expoPushToken: VALID_TOKEN, platform: 'blackberry' },
    }));
    expect(res.status).toBe(400);
  });

  it('upserts a legacy ExponentPushToken and echoes a minimal shape', async () => {
    const jwt = await getTestJwt();
    mockReturningResult = [pushTokenRow()];
    const res = await app.fetch(req('POST', '/v1/push/tokens', {
      jwt, body: { expoPushToken: VALID_TOKEN, platform: 'ios' },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Minimal echo — the token itself never comes back down the wire.
    expect(body).toEqual({ id: TOKEN_ROW_ID, platform: 'ios' });
    expect(insertValuesCalls[0]).toMatchObject({
      userId: TEST_USER_ID,
      expoPushToken: VALID_TOKEN,
      platform: 'ios',
    });
  });

  it('accepts the current ExpoPushToken format', async () => {
    const jwt = await getTestJwt();
    mockReturningResult = [pushTokenRow({ expoPushToken: VALID_NEW_FORMAT_TOKEN })];
    const res = await app.fetch(req('POST', '/v1/push/tokens', {
      jwt, body: { expoPushToken: VALID_NEW_FORMAT_TOKEN },
    }));
    expect(res.status).toBe(200);
  });

  it('re-assigns a token to the new user on conflict (device changed hands)', async () => {
    // The same upsert statement covers both re-registration and reassignment:
    // on conflict with the unique token, ownership moves to the caller.
    const jwt = await getTestJwt(TEST_OTHER_USER_ID);
    mockReturningResult = [pushTokenRow({ userId: TEST_OTHER_USER_ID })];
    const res = await app.fetch(req('POST', '/v1/push/tokens', {
      jwt, body: { expoPushToken: VALID_TOKEN, platform: 'android' },
    }));
    expect(res.status).toBe(200);
    expect(conflictSetCalls).toHaveLength(1);
    expect(conflictSetCalls[0]).toMatchObject({
      userId: TEST_OTHER_USER_ID,
      platform: 'android',
    });
    expect(conflictSetCalls[0]).toHaveProperty('lastSeenAt');
  });
});

describe('DELETE /v1/push/tokens', () => {
  it('returns 401 without auth', async () => {
    const res = await app.fetch(req('DELETE', '/v1/push/tokens', {
      body: { expoPushToken: VALID_TOKEN },
    }));
    expect(res.status).toBe(401);
  });

  it('returns 400 for an invalid token format', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('DELETE', '/v1/push/tokens', {
      jwt, body: { expoPushToken: 'garbage' },
    }));
    expect(res.status).toBe(400);
  });

  it('removes only the caller\'s own registration', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('DELETE', '/v1/push/tokens', {
      jwt, body: { expoPushToken: VALID_TOKEN },
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(deleteWhereCalls).toHaveLength(1);
    // The where clause is scoped to both the caller and the token.
    const rendered = new PgDialect().sqlToQuery(deleteWhereCalls[0] as SQL);
    expect(rendered.sql).toContain('"user_id"');
    expect(rendered.sql).toContain('"expo_push_token"');
    expect(rendered.params).toContain(TEST_USER_ID);
    expect(rendered.params).toContain(VALID_TOKEN);
  });

  it('returns ok even when nothing matched (no existence leaks)', async () => {
    // The delete chain resolves to [] — the response shape is identical.
    const jwt = await getTestJwt();
    const res = await app.fetch(req('DELETE', '/v1/push/tokens', {
      jwt, body: { expoPushToken: VALID_NEW_FORMAT_TOKEN },
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
