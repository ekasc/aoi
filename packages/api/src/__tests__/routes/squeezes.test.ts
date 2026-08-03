import { vi, describe, it, expect, beforeEach } from 'vitest';
import { app, getTestJwt, req, TEST_USER_ID, TEST_SPACE_ID } from '../helpers/test-app.js';
import { db } from '../../db/index.js';
import { notifyPartnerInSpace } from '../../lib/push.js';

vi.stubEnv('JWT_SECRET', 'test-jwt-secret-for-testing');
vi.stubEnv('CORS_ORIGIN', '*');

const mockSelectQueue: any[][] = [];

function selectChain() {
  return {
    from: vi.fn(() => selectChain()),
    where: vi.fn(() => selectChain()),
    limit: vi.fn(() => Promise.resolve(mockSelectQueue.shift() ?? [])),
    then: (resolve: Function) => resolve(mockSelectQueue.shift() ?? []),
  };
}

vi.mock('../../db/index.js', () => ({
  db: {
    select: vi.fn(() => selectChain()),
  },
}));

// The send service is mocked away — route tests assert the delivery intent,
// not Expo traffic.
vi.mock('../../lib/push.js', () => ({
  notifyPartnerInSpace: vi.fn(async () => {}),
}));

beforeEach(() => {
  mockSelectQueue.length = 0;
  vi.mocked(db.select).mockClear();
  vi.mocked(notifyPartnerInSpace).mockClear();
});

function spaceMemberRow(overrides: Record<string, unknown> = {}) {
  return { spaceId: TEST_SPACE_ID, userId: TEST_USER_ID, state: 'active' as const, ...overrides };
}

describe('POST /v1/squeezes', () => {
  it('returns 401 without auth', async () => {
    const res = await app.fetch(req('POST', '/v1/squeezes'));
    expect(res.status).toBe(401);
  });

  it('returns 400 when the sender has no active space', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([]);
    const res = await app.fetch(req('POST', '/v1/squeezes', { jwt, body: {} }));
    expect(res.status).toBe(400);
    expect(notifyPartnerInSpace).not.toHaveBeenCalled();
  });

  it('notifies the partner with the squeeze kind and nothing else', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([spaceMemberRow()]);
    const res = await app.fetch(req('POST', '/v1/squeezes', { jwt, body: {} }));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true });
    expect(notifyPartnerInSpace).toHaveBeenCalledTimes(1);
    expect(notifyPartnerInSpace).toHaveBeenCalledWith(
      TEST_SPACE_ID,
      TEST_USER_ID,
      'squeeze'
    );
  });

  it('stores nothing: a squeeze is wordless and leaves no record', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([spaceMemberRow()]);
    const res = await app.fetch(req('POST', '/v1/squeezes', { jwt, body: {} }));
    expect(res.status).toBe(202);
    // Exactly one read (the space lookup). The mocked db intentionally
    // exposes no insert/update/delete — any write attempt would throw.
    expect(vi.mocked(db.select)).toHaveBeenCalledTimes(1);
  });
});
