import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { db } from '../../db/index.js';
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

const TEST_LETTER_ID = '00000000-0000-0000-0000-000000000060';
const TEST_OTHER_SPACE_ID = '00000000-0000-0000-0000-000000000011';
const LETTERS_PATH = '/v1/spaces/current/letters';
const SECRET_BODY = 'we watched the tide come in and promised to come back every summer';

// Fixed "now" so due/horizon checks are deterministic.
const FIXED_NOW = new Date('2026-08-03T12:00:00Z');
const FUTURE_SEAL = '2026-09-03T09:00:00Z';
const PAST_SEAL = '2026-08-01T09:00:00Z';
const DUE_SEAL = '2026-08-03T09:00:00Z'; // same day, already past FIXED_NOW

const mockSelectQueue: any[][] = [];
let mockReturningResult: any[] = [];
const updateWhereCalls: unknown[] = [];

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

function insertChain() {
  return {
    values: vi.fn(() => insertChain()),
    returning: vi.fn(() => Promise.resolve(mockReturningResult)),
  };
}

function updateChain() {
  return {
    set: vi.fn(() => updateChain()),
    where: vi.fn((predicate: unknown) => {
      updateWhereCalls.push(predicate);
      return updateChain();
    }),
    returning: vi.fn(() => Promise.resolve(mockReturningResult)),
  };
}

vi.mock('../../db/index.js', () => ({
  db: {
    select: vi.fn(() => selectChain()),
    insert: vi.fn(() => insertChain()),
    update: vi.fn(() => updateChain()),
  },
}));

// The delivery service is mocked away — route tests assert the delivery
// intent, not Expo traffic.
vi.mock('../../lib/push.js', () => ({
  notifyPartnerInSpace: vi.fn(async () => {}),
}));

beforeEach(() => {
  mockSelectQueue.length = 0;
  updateWhereCalls.length = 0;
  mockReturningResult = [];
  vi.mocked(db.insert).mockClear();
  vi.mocked(db.update).mockClear();
  vi.mocked(notifyPartnerInSpace).mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function letterRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_LETTER_ID,
    spaceId: TEST_SPACE_ID,
    authorUserId: TEST_USER_ID,
    authorName: 'Alex',
    caption: null,
    body: SECRET_BODY,
    sealedUntil: new Date(FUTURE_SEAL),
    createdAt: new Date('2026-08-02T10:00:00Z'),
    openedAt: null,
    openedByUserId: null,
    ...overrides,
  };
}

function spaceMemberRow(overrides: Record<string, unknown> = {}) {
  return { spaceId: TEST_SPACE_ID, userId: TEST_USER_ID, state: 'active' as const, ...overrides };
}

const VALID_SEAL_BODY = { body: 'Something small and true.', sealedUntil: FUTURE_SEAL };

function wordOnly(message: unknown) {
  expect(typeof message).toBe('string');
  expect(message as string).not.toMatch(/\d/);
}

describe('POST /v1/spaces/current/letters (seal)', () => {
  it('returns 401 without auth', async () => {
    const res = await app.fetch(req('POST', LETTERS_PATH));
    expect(res.status).toBe(401);
  });

  it('returns 400 for an empty body with a word-only message', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('POST', LETTERS_PATH, {
      jwt, body: { body: '   ', sealedUntil: FUTURE_SEAL },
    }));
    expect(res.status).toBe(400);
    const payload = await res.json();
    expect(payload.error.message).toBe('A letter needs a few words');
    wordOnly(payload.error.message);
    expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
  });

  it('returns 400 when the body is missing', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('POST', LETTERS_PATH, {
      jwt, body: { sealedUntil: FUTURE_SEAL },
    }));
    expect(res.status).toBe(400);
    wordOnly((await res.json()).error.message);
  });

  it('returns 400 when the body exceeds the limit', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('POST', LETTERS_PATH, {
      jwt, body: { body: 'a'.repeat(5001), sealedUntil: FUTURE_SEAL },
    }));
    expect(res.status).toBe(400);
    wordOnly((await res.json()).error.message);
  });

  it('returns 400 when the caption exceeds the limit', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('POST', LETTERS_PATH, {
      jwt, body: { ...VALID_SEAL_BODY, caption: 'c'.repeat(81) },
    }));
    expect(res.status).toBe(400);
    wordOnly((await res.json()).error.message);
  });

  it('returns 400 for a sealedUntil in the past, without echoing the date', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([spaceMemberRow()]);
    const res = await app.fetch(req('POST', LETTERS_PATH, {
      jwt, body: { body: 'Something.', sealedUntil: PAST_SEAL },
    }));
    expect(res.status).toBe(400);
    const payload = await res.json();
    expect(payload.error.message).toBe('A letter can only open in the future');
    wordOnly(payload.error.message);
    expect(payload.error.message).not.toContain('2026');
  });

  it('returns 400 for a sealedUntil beyond the horizon', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([spaceMemberRow()]);
    const tooFar = new Date(FIXED_NOW.getTime() + 51 * 365 * 24 * 60 * 60 * 1000).toISOString();
    const res = await app.fetch(req('POST', LETTERS_PATH, {
      jwt, body: { body: 'Something.', sealedUntil: tooFar },
    }));
    expect(res.status).toBe(400);
    const payload = await res.json();
    expect(payload.error.message).toBe("That's farther away than letters can wait");
    wordOnly(payload.error.message);
  });

  it('returns 400 for a malformed sealedUntil', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('POST', LETTERS_PATH, {
      jwt, body: { body: 'Something.', sealedUntil: 'next spring' },
    }));
    expect(res.status).toBe(400);
    wordOnly((await res.json()).error.message);
  });

  it('returns 400 when the user has no space', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([]); // no active membership
    const res = await app.fetch(req('POST', LETTERS_PATH, { jwt, body: VALID_SEAL_BODY }));
    expect(res.status).toBe(400);
    expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
    expect(notifyPartnerInSpace).not.toHaveBeenCalled();
  });

  it('seals the letter and returns it WITHOUT its body — even to the author', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [spaceMemberRow()], // active space lookup
      [{ displayName: 'Alex' }] // author name for the response
    );
    mockReturningResult = [letterRow()];
    const res = await app.fetch(req('POST', LETTERS_PATH, { jwt, body: VALID_SEAL_BODY }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      id: TEST_LETTER_ID,
      authorRole: 'you',
      authorName: 'You',
      caption: null,
      sealedUntil: '2026-09-03T09:00:00.000Z',
      isOpened: false,
      readyToOpen: false,
      openedAt: null,
    });
    // The lock applies to the sealing response too: no re-reading it.
    expect(body.body).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(SECRET_BODY);
  });

  it('round-trips an optional caption', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([spaceMemberRow()], [{ displayName: 'Alex' }]);
    mockReturningResult = [letterRow({ caption: 'For a quiet day' })];
    const res = await app.fetch(req('POST', LETTERS_PATH, {
      jwt, body: { ...VALID_SEAL_BODY, caption: 'For a quiet day' },
    }));
    expect(res.status).toBe(201);
    expect((await res.json()).caption).toBe('For a quiet day');
  });

  it('notifies the partner with letter_sealed and no content ever', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([spaceMemberRow()], [{ displayName: 'Alex' }]);
    mockReturningResult = [letterRow()];
    const res = await app.fetch(req('POST', LETTERS_PATH, {
      jwt, body: { ...VALID_SEAL_BODY, body: SECRET_BODY },
    }));
    expect(res.status).toBe(201);
    expect(notifyPartnerInSpace).toHaveBeenCalledTimes(1);
    expect(notifyPartnerInSpace).toHaveBeenCalledWith(TEST_SPACE_ID, TEST_USER_ID, 'letter_sealed');
    // Structural privacy: the notify hook accepts exactly (space, sender,
    // kind) — there is no channel through which the body or the date could
    // travel.
    expect(vi.mocked(notifyPartnerInSpace).mock.calls[0]).toHaveLength(3);
  });
});

describe('GET /v1/spaces/current/letters (the shelf)', () => {
  it('returns 401 without auth', async () => {
    const res = await app.fetch(req('GET', LETTERS_PATH));
    expect(res.status).toBe(401);
  });

  it('returns an empty shelf when the user has no space', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([]);
    const res = await app.fetch(req('GET', LETTERS_PATH, { jwt }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ letters: [] });
  });

  it('omits the body of an unopened letter — even for its own author', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [spaceMemberRow()],
      [letterRow({ authorUserId: TEST_USER_ID, authorName: 'Alex' })]
    );
    const res = await app.fetch(req('GET', LETTERS_PATH, { jwt }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.letters).toHaveLength(1);
    expect(body.letters[0]).toMatchObject({
      authorRole: 'you',
      isOpened: false,
      readyToOpen: false,
    });
    expect(body.letters[0].body).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(SECRET_BODY);
  });

  it('omits the body of an unopened partner letter', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [spaceMemberRow()],
      [letterRow({ authorUserId: TEST_OTHER_USER_ID, authorName: 'Mara' })]
    );
    const res = await app.fetch(req('GET', LETTERS_PATH, { jwt }));
    const body = await res.json();
    expect(body.letters[0]).toMatchObject({
      authorRole: 'partner',
      authorName: 'Mara',
      isOpened: false,
    });
    expect(body.letters[0].body).toBeUndefined();
  });

  it('marks a due-but-unopened letter readyToOpen without serving its body', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [spaceMemberRow()],
      [letterRow({ sealedUntil: new Date(DUE_SEAL) })]
    );
    const res = await app.fetch(req('GET', LETTERS_PATH, { jwt }));
    const body = await res.json();
    expect(body.letters[0].readyToOpen).toBe(true);
    expect(body.letters[0].isOpened).toBe(false);
    expect(body.letters[0].body).toBeUndefined();
  });

  it('serves the body once a letter is opened', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [spaceMemberRow()],
      [letterRow({
        sealedUntil: new Date(DUE_SEAL),
        openedAt: new Date('2026-08-03T10:00:00Z'),
        openedByUserId: TEST_OTHER_USER_ID,
      })]
    );
    const res = await app.fetch(req('GET', LETTERS_PATH, { jwt }));
    const body = await res.json();
    expect(body.letters[0]).toMatchObject({
      isOpened: true,
      readyToOpen: true,
      openedAt: '2026-08-03T10:00:00.000Z',
      body: SECRET_BODY,
    });
  });

  it('orders the shelf newest first', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [spaceMemberRow()],
      [
        letterRow({ id: '00000000-0000-0000-0000-000000000061', createdAt: new Date('2026-07-01T10:00:00Z') }),
        letterRow({ id: '00000000-0000-0000-0000-000000000062', createdAt: new Date('2026-08-01T10:00:00Z') }),
      ]
    );
    const res = await app.fetch(req('GET', LETTERS_PATH, { jwt }));
    const body = await res.json();
    expect(body.letters.map((letter: { id: string }) => letter.id)).toEqual([
      '00000000-0000-0000-0000-000000000062',
      '00000000-0000-0000-0000-000000000061',
    ]);
  });
});

describe('POST /v1/letters/:id/open', () => {
  it('returns 401 without auth', async () => {
    const res = await app.fetch(req('POST', `/v1/letters/${TEST_LETTER_ID}/open`));
    expect(res.status).toBe(401);
  });

  it('returns 400 for a non-UUID id', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('POST', '/v1/letters/not-a-uuid/open', { jwt }));
    expect(res.status).toBe(400);
  });

  it('returns 404 for a non-existent letter', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([]);
    const res = await app.fetch(req('POST', `/v1/letters/${TEST_LETTER_ID}/open`, { jwt }));
    expect(res.status).toBe(404);
  });

  it('returns 404 for another space\'s letter (no existence leaks)', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [letterRow({ spaceId: TEST_OTHER_SPACE_ID })],
      [] // no membership in the other space
    );
    const res = await app.fetch(req('POST', `/v1/letters/${TEST_LETTER_ID}/open`, { jwt }));
    expect(res.status).toBe(404);
    expect(vi.mocked(db.update)).not.toHaveBeenCalled();
  });

  it('returns a calm 400 without the body when it is not yet time', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([letterRow()], [spaceMemberRow()]);
    const res = await app.fetch(req('POST', `/v1/letters/${TEST_LETTER_ID}/open`, { jwt }));
    expect(res.status).toBe(400);
    const payload = await res.json();
    expect(payload.error.message).toBe('Not yet time');
    wordOnly(payload.error.message);
    expect(JSON.stringify(payload)).not.toContain(SECRET_BODY);
    expect(vi.mocked(db.update)).not.toHaveBeenCalled();
  });

  it('opens a due letter atomically and returns it with its body', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [letterRow({ sealedUntil: new Date(DUE_SEAL) })],
      [spaceMemberRow()]
    );
    mockReturningResult = [letterRow({
      sealedUntil: new Date(DUE_SEAL),
      openedAt: FIXED_NOW,
      openedByUserId: TEST_USER_ID,
    })];
    const res = await app.fetch(req('POST', `/v1/letters/${TEST_LETTER_ID}/open`, { jwt }));
    expect(res.status).toBe(200);
    expect(vi.mocked(db.update)).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body).toMatchObject({
      isOpened: true,
      openedAt: '2026-08-03T12:00:00.000Z',
      body: SECRET_BODY,
    });
  });

  it('a double-open never crashes: the second caller gets the opened row', async () => {
    const jwt = await getTestJwt();

    // First caller wins the atomic UPDATE.
    mockSelectQueue.push(
      [letterRow({ sealedUntil: new Date(DUE_SEAL) })],
      [spaceMemberRow()]
    );
    mockReturningResult = [letterRow({
      sealedUntil: new Date(DUE_SEAL),
      openedAt: FIXED_NOW,
      openedByUserId: TEST_OTHER_USER_ID,
    })];
    const first = await app.fetch(req('POST', `/v1/letters/${TEST_LETTER_ID}/open`, { jwt }));
    expect(first.status).toBe(200);

    // Second caller: the scoped UPDATE matches nothing (opened_at no longer
    // null), so the route reads the freshly opened row instead.
    mockSelectQueue.push(
      [letterRow({ sealedUntil: new Date(DUE_SEAL) })],
      [spaceMemberRow()],
      [letterRow({
        sealedUntil: new Date(DUE_SEAL),
        openedAt: FIXED_NOW,
        openedByUserId: TEST_OTHER_USER_ID,
      })]
    );
    mockReturningResult = [];
    const second = await app.fetch(req('POST', `/v1/letters/${TEST_LETTER_ID}/open`, { jwt }));
    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body).toMatchObject({ isOpened: true, body: SECRET_BODY });
  });

  it('reading an already-opened letter is idempotent and writes nothing', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [letterRow({
        sealedUntil: new Date(DUE_SEAL),
        openedAt: new Date('2026-08-03T10:00:00Z'),
        openedByUserId: TEST_OTHER_USER_ID,
      })],
      [spaceMemberRow()]
    );
    const res = await app.fetch(req('POST', `/v1/letters/${TEST_LETTER_ID}/open`, { jwt }));
    expect(res.status).toBe(200);
    expect(vi.mocked(db.update)).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body).toMatchObject({
      isOpened: true,
      openedAt: '2026-08-03T10:00:00.000Z',
      body: SECRET_BODY,
    });
  });

  it('scopes the atomic open to the letter AND opened_at IS NULL', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [letterRow({ sealedUntil: new Date(DUE_SEAL) })],
      [spaceMemberRow()]
    );
    mockReturningResult = [letterRow({
      sealedUntil: new Date(DUE_SEAL),
      openedAt: FIXED_NOW,
      openedByUserId: TEST_USER_ID,
    })];
    const res = await app.fetch(req('POST', `/v1/letters/${TEST_LETTER_ID}/open`, { jwt }));
    expect(res.status).toBe(200);

    // The load-bearing atomicity invariant, rendered from the real drizzle
    // predicate: id = $ AND opened_at IS NULL.
    expect(updateWhereCalls).toHaveLength(1);
    const rendered = new PgDialect().sqlToQuery(updateWhereCalls[0] as SQL);
    expect(rendered.params).toContain(TEST_LETTER_ID);
    const sql = rendered.sql.toLowerCase();
    expect(sql).toContain('"letters"."opened_at" is null');
    expect(sql).toContain(' and ');
  });

  it('returns 404 when the membership is no longer active', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [letterRow({ sealedUntil: new Date(DUE_SEAL) })],
      [] // membership vanished between list and open
    );
    const res = await app.fetch(req('POST', `/v1/letters/${TEST_LETTER_ID}/open`, { jwt }));
    expect(res.status).toBe(404);
    expect(vi.mocked(db.update)).not.toHaveBeenCalled();
  });
});
