import { vi, describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../db/index.js';
import { app, getTestJwt, req, TEST_USER_ID, TEST_OTHER_USER_ID, TEST_SPACE_ID } from '../helpers/test-app.js';

vi.stubEnv('JWT_SECRET', 'test-jwt-secret-for-testing');
vi.stubEnv('CORS_ORIGIN', '*');

const TEST_SOMEDAY_ID = '00000000-0000-0000-0000-000000000040';
const TEST_OTHER_SPACE_ID = '00000000-0000-0000-0000-000000000011';

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
  vi.mocked(db.update).mockClear();
});

function somedayRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_SOMEDAY_ID,
    spaceId: TEST_SPACE_ID,
    createdByUserId: TEST_USER_ID,
    title: 'That little ramen place',
    note: null,
    category: 'food' as const,
    createdAt: new Date('2026-07-01T10:00:00Z'),
    checkedAt: null,
    checkedByUserId: null,
    ...overrides,
  };
}

function spaceMemberRow(overrides: Record<string, unknown> = {}) {
  return { spaceId: TEST_SPACE_ID, userId: TEST_USER_ID, state: 'active' as const, ...overrides };
}

const VALID_CREATE_BODY = { title: 'That little ramen place', category: 'food' };

describe('GET /v1/spaces/current/someday', () => {
  it('returns 401 without auth', async () => {
    const res = await app.fetch(req('GET', '/v1/spaces/current/someday'));
    expect(res.status).toBe(401);
  });

  it('returns an empty list when the user has no space', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([]);
    const res = await app.fetch(req('GET', '/v1/spaces/current/someday', { jwt }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [] });
  });

  it('returns items with roles computed relative to the viewer', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [spaceMemberRow()],
      [
        somedayRow(),
        somedayRow({
          id: '00000000-0000-0000-0000-000000000041',
          title: 'Partner item',
          createdByUserId: TEST_OTHER_USER_ID,
        }),
      ]
    );
    const res = await app.fetch(req('GET', '/v1/spaces/current/someday', { jwt }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({ createdByRole: 'you', checkedAt: null, checkedByRole: null });
    expect(body.items[1]).toMatchObject({ createdByRole: 'partner' });
  });

  it('orders open items first (newest first), then checked items (most recently checked first)', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [spaceMemberRow()],
      [
        somedayRow({ id: '00000000-0000-0000-0000-000000000041', title: 'Old open', createdAt: new Date('2026-06-01T10:00:00Z') }),
        somedayRow({
          id: '00000000-0000-0000-0000-000000000042',
          title: 'Checked long ago',
          checkedAt: new Date('2026-07-02T10:00:00Z'),
          checkedByUserId: TEST_OTHER_USER_ID,
        }),
        somedayRow({ id: '00000000-0000-0000-0000-000000000043', title: 'New open', createdAt: new Date('2026-07-10T10:00:00Z') }),
        somedayRow({
          id: '00000000-0000-0000-0000-000000000044',
          title: 'Checked recently',
          createdAt: new Date('2026-06-15T10:00:00Z'),
          checkedAt: new Date('2026-07-20T10:00:00Z'),
          checkedByUserId: TEST_USER_ID,
        }),
      ]
    );
    const res = await app.fetch(req('GET', '/v1/spaces/current/someday', { jwt }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.map((item: { title: string }) => item.title)).toEqual([
      'New open',
      'Old open',
      'Checked recently',
      'Checked long ago',
    ]);
  });

  it('serializes checkedByRole relative to the viewer', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [spaceMemberRow()],
      [
        somedayRow({
          id: '00000000-0000-0000-0000-000000000041',
          checkedAt: new Date('2026-07-20T10:00:00Z'),
          checkedByUserId: TEST_USER_ID,
        }),
        somedayRow({
          id: '00000000-0000-0000-0000-000000000042',
          checkedAt: new Date('2026-07-21T10:00:00Z'),
          checkedByUserId: TEST_OTHER_USER_ID,
        }),
      ]
    );
    const res = await app.fetch(req('GET', '/v1/spaces/current/someday', { jwt }));
    const body = await res.json();
    // Both rows are checked, so most-recently-checked comes first.
    expect(body.items[0].checkedByRole).toBe('partner');
    expect(body.items[1].checkedByRole).toBe('you');
  });
});

describe('POST /v1/spaces/current/someday', () => {
  it('returns 401 without auth', async () => {
    const res = await app.fetch(req('POST', '/v1/spaces/current/someday'));
    expect(res.status).toBe(401);
  });

  it('returns 400 when the title is missing', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('POST', '/v1/spaces/current/someday', {
      jwt, body: { category: 'food' },
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when the title is blank after trimming', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('POST', '/v1/spaces/current/someday', {
      jwt, body: { title: '   ', category: 'food' },
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when the title exceeds the limit', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('POST', '/v1/spaces/current/someday', {
      jwt, body: { title: 'a'.repeat(121), category: 'food' },
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for an unknown category', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('POST', '/v1/spaces/current/someday', {
      jwt, body: { title: 'Picnic', category: 'concert' },
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when the note exceeds the limit', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('POST', '/v1/spaces/current/someday', {
      jwt, body: { title: 'Picnic', category: 'place', note: 'n'.repeat(281) },
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when the user has no space', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([]);
    const res = await app.fetch(req('POST', '/v1/spaces/current/someday', {
      jwt, body: VALID_CREATE_BODY,
    }));
    expect(res.status).toBe(400);
  });

  it('creates an item and returns the serialized shape', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([spaceMemberRow()]);
    mockReturningResult = [somedayRow()];
    const res = await app.fetch(req('POST', '/v1/spaces/current/someday', {
      jwt, body: VALID_CREATE_BODY,
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      id: TEST_SOMEDAY_ID,
      title: 'That little ramen place',
      category: 'food',
      createdByRole: 'you',
      createdAt: '2026-07-01T10:00:00.000Z',
      checkedAt: null,
      checkedByRole: null,
    });
  });

  it('round-trips an optional note', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([spaceMemberRow()]);
    mockReturningResult = [somedayRow({ note: 'Ask Mara first' })];
    const res = await app.fetch(req('POST', '/v1/spaces/current/someday', {
      jwt, body: { ...VALID_CREATE_BODY, note: 'Ask Mara first' },
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.note).toBe('Ask Mara first');
  });
});

describe('PATCH /v1/someday/:id', () => {
  it('returns 401 without auth', async () => {
    const res = await app.fetch(req('PATCH', `/v1/someday/${TEST_SOMEDAY_ID}`));
    expect(res.status).toBe(401);
  });

  it('returns 400 for a non-UUID id', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('PATCH', '/v1/someday/not-a-uuid', {
      jwt, body: { checked: true },
    }));
    expect(res.status).toBe(400);
  });

  it('returns 404 for a non-existent item', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([]);
    const res = await app.fetch(req('PATCH', `/v1/someday/${TEST_SOMEDAY_ID}`, {
      jwt, body: { checked: true },
    }));
    expect(res.status).toBe(404);
  });

  it('returns 404 when the requester is not a member of the item\'s space (cross-space isolation)', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [somedayRow({ spaceId: TEST_OTHER_SPACE_ID })],
      [] // no membership in the other space
    );
    const res = await app.fetch(req('PATCH', `/v1/someday/${TEST_SOMEDAY_ID}`, {
      jwt, body: { checked: true },
    }));
    expect(res.status).toBe(404);
  });

  it('returns 400 for an empty patch', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('PATCH', `/v1/someday/${TEST_SOMEDAY_ID}`, {
      jwt, body: {},
    }));
    expect(res.status).toBe(400);
  });

  it('returns 404 when the scoped update matches no rows (row vanished mid-flight)', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([somedayRow()], [spaceMemberRow()]);
    mockReturningResult = []; // the UPDATE ... RETURNING matched nothing
    const res = await app.fetch(req('PATCH', `/v1/someday/${TEST_SOMEDAY_ID}`, {
      jwt, body: { title: 'New title' },
    }));
    expect(res.status).toBe(404);
  });

  it('returns 400 for a title that exceeds the limit', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('PATCH', `/v1/someday/${TEST_SOMEDAY_ID}`, {
      jwt, body: { title: 'a'.repeat(121) },
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for an unknown category', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('PATCH', `/v1/someday/${TEST_SOMEDAY_ID}`, {
      jwt, body: { category: 'concert' },
    }));
    expect(res.status).toBe(400);
  });

  it('checks off an item created by the partner (either member can check off)', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [somedayRow({ createdByUserId: TEST_OTHER_USER_ID })],
      [spaceMemberRow()]
    );
    mockReturningResult = [somedayRow({
      createdByUserId: TEST_OTHER_USER_ID,
      checkedAt: new Date('2026-07-25T10:00:00Z'),
      checkedByUserId: TEST_USER_ID,
    })];
    const res = await app.fetch(req('PATCH', `/v1/someday/${TEST_SOMEDAY_ID}`, {
      jwt, body: { checked: true },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      createdByRole: 'partner',
      checkedAt: '2026-07-25T10:00:00.000Z',
      checkedByRole: 'you',
    });
  });

  it('undoes a check-off (clears checkedAt and checkedByRole)', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [somedayRow({
        checkedAt: new Date('2026-07-25T10:00:00Z'),
        checkedByUserId: TEST_OTHER_USER_ID,
      })],
      [spaceMemberRow()]
    );
    mockReturningResult = [somedayRow()];
    const res = await app.fetch(req('PATCH', `/v1/someday/${TEST_SOMEDAY_ID}`, {
      jwt, body: { checked: false },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checkedAt).toBeNull();
    expect(body.checkedByRole).toBeNull();
  });

  it('does not write when checking an already-checked item', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [somedayRow({
        checkedAt: new Date('2026-07-25T10:00:00Z'),
        checkedByUserId: TEST_OTHER_USER_ID,
      })],
      [spaceMemberRow()]
    );
    const res = await app.fetch(req('PATCH', `/v1/someday/${TEST_SOMEDAY_ID}`, {
      jwt, body: { checked: true },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    // The original check-off (by the partner) is preserved — no churn.
    expect(body).toMatchObject({
      checkedAt: '2026-07-25T10:00:00.000Z',
      checkedByRole: 'partner',
    });
    expect(vi.mocked(db.update)).not.toHaveBeenCalled();
  });

  it('does not write when undoing an item that is still open', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([somedayRow()], [spaceMemberRow()]);
    const res = await app.fetch(req('PATCH', `/v1/someday/${TEST_SOMEDAY_ID}`, {
      jwt, body: { checked: false },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checkedAt).toBeNull();
    expect(vi.mocked(db.update)).not.toHaveBeenCalled();
  });

  it('does not write when the patch repeats the current values', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [somedayRow({ title: 'That little ramen place', category: 'food' })],
      [spaceMemberRow()]
    );
    const res = await app.fetch(req('PATCH', `/v1/someday/${TEST_SOMEDAY_ID}`, {
      jwt, body: { title: 'That little ramen place', category: 'food' },
    }));
    expect(res.status).toBe(200);
    expect(vi.mocked(db.update)).not.toHaveBeenCalled();
  });

  it('edits title, note and category', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([somedayRow()], [spaceMemberRow()]);
    mockReturningResult = [somedayRow({ title: 'Ramen night', note: 'The spicy one', category: 'food' })];
    const res = await app.fetch(req('PATCH', `/v1/someday/${TEST_SOMEDAY_ID}`, {
      jwt, body: { title: 'Ramen night', note: 'The spicy one', category: 'food' },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ title: 'Ramen night', note: 'The spicy one', category: 'food' });
    expect(vi.mocked(db.update)).toHaveBeenCalledTimes(1);
  });

  it('clears the note when an empty note is sent', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([somedayRow({ note: 'Ask Mara first' })], [spaceMemberRow()]);
    mockReturningResult = [somedayRow({ note: null })];
    const res = await app.fetch(req('PATCH', `/v1/someday/${TEST_SOMEDAY_ID}`, {
      jwt, body: { note: '' },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.note).toBeUndefined();
    expect(vi.mocked(db.update)).toHaveBeenCalledTimes(1);
  });
});
