import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getWeeklyQuestionForDate } from '@aoi/shared';
import { db } from '../../db/index.js';
import { app, getTestJwt, req, TEST_USER_ID, TEST_OTHER_USER_ID, TEST_SPACE_ID } from '../helpers/test-app.js';

vi.stubEnv('JWT_SECRET', 'test-jwt-secret-for-testing');
vi.stubEnv('CORS_ORIGIN', '*');

const QUESTION_PATH = '/v1/spaces/current/question';
const ANSWER_PATH = '/v1/spaces/current/question/answer';

// Fixed "now" so the ISO week (and therefore the question) is deterministic.
// 2026-08-03 is a Monday in ISO week 32.
const FIXED_NOW = new Date('2026-08-03T12:00:00Z');

const mockSelectQueue: any[][] = [];
let mockReturningResult: any[] = [];

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
    onConflictDoUpdate: vi.fn(() => insertChain()),
    returning: vi.fn(() => Promise.resolve(mockReturningResult)),
    then: (resolve: Function) => resolve(mockReturningResult),
  };
}

vi.mock('../../db/index.js', () => ({
  db: {
    select: vi.fn(() => selectChain()),
    insert: vi.fn(() => insertChain()),
  },
}));

function expectedWeek(now = FIXED_NOW) {
  return getWeeklyQuestionForDate(now);
}

function weeklyAnswerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-0000-0000-000000000050',
    spaceId: TEST_SPACE_ID,
    userId: TEST_USER_ID,
    weekKey: expectedWeek().weekKey,
    questionId: expectedWeek().questionId,
    answer: 'The way they made coffee on Tuesday.',
    createdAt: new Date('2026-08-01T10:00:00Z'),
    updatedAt: new Date('2026-08-01T10:00:00Z'),
    ...overrides,
  };
}

function spaceMemberRow(overrides: Record<string, unknown> = {}) {
  return { spaceId: TEST_SPACE_ID, userId: TEST_USER_ID, state: 'active' as const, ...overrides };
}

beforeEach(() => {
  mockSelectQueue.length = 0;
  mockReturningResult = [];
  vi.mocked(db.insert).mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /v1/spaces/current/question', () => {
  it('returns 401 without auth', async () => {
    const res = await app.fetch(req('GET', QUESTION_PATH));
    expect(res.status).toBe(401);
  });

  it('returns the question with empty answer states when the user has no space', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([]); // no active membership
    const res = await app.fetch(req('GET', QUESTION_PATH, { jwt }));
    expect(res.status).toBe(200);
    const week = expectedWeek();
    expect(await res.json()).toEqual({
      weekKey: week.weekKey,
      questionId: week.questionId,
      question: week.question,
      yourAnswer: null,
      yourAnswerUpdatedAt: null,
      partnerAnswered: false,
      partnerAnswer: null,
      partnerName: null,
      revealed: false,
    });
  });

  it('serves the ISO week and its deterministic question', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([spaceMemberRow()], [], []);
    const res = await app.fetch(req('GET', QUESTION_PATH, { jwt }));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Independently known: 2026-08-03 falls in ISO week 2026-W32.
    expect(body.weekKey).toBe('2026-W32');
    expect(body.questionId).toBe(expectedWeek().questionId);
    expect(body.question).toBe(expectedWeek().question);
  });

  it('shows your own answer but keeps revealed false when only you answered', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [spaceMemberRow()],
      [weeklyAnswerRow()], // only your answer exists
      [{ displayName: 'Mara' }]
    );
    const res = await app.fetch(req('GET', QUESTION_PATH, { jwt }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.yourAnswer).toBe('The way they made coffee on Tuesday.');
    expect(body.yourAnswerUpdatedAt).toBe('2026-08-01T10:00:00.000Z');
    expect(body.partnerAnswered).toBe(false);
    expect(body.partnerAnswer).toBeNull();
    expect(body.revealed).toBe(false);
  });

  it('hides the partner answer content until you have answered too (reveal gating)', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [spaceMemberRow()],
      [weeklyAnswerRow({ userId: TEST_OTHER_USER_ID, answer: 'Their secret answer' })],
      [{ displayName: 'Mara' }]
    );
    const res = await app.fetch(req('GET', QUESTION_PATH, { jwt }));
    expect(res.status).toBe(200);
    const body = await res.json();
    // The partner HAS answered…
    expect(body.partnerAnswered).toBe(true);
    // …but their words stay hidden until both answers are in.
    expect(body.partnerAnswer).toBeNull();
    expect(body.yourAnswer).toBeNull();
    expect(body.revealed).toBe(false);
    expect(JSON.stringify(body)).not.toContain('Their secret answer');
  });

  it('reveals both answers when both partners have answered', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [spaceMemberRow()],
      [
        weeklyAnswerRow(),
        weeklyAnswerRow({
          id: '00000000-0000-0000-0000-000000000051',
          userId: TEST_OTHER_USER_ID,
          answer: 'Their secret answer',
        }),
      ],
      [{ displayName: 'Mara' }]
    );
    const res = await app.fetch(req('GET', QUESTION_PATH, { jwt }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.revealed).toBe(true);
    expect(body.partnerAnswered).toBe(true);
    expect(body.yourAnswer).toBe('The way they made coffee on Tuesday.');
    expect(body.partnerAnswer).toBe('Their secret answer');
    expect(body.partnerName).toBe('Mara');
  });
});

describe('PUT /v1/spaces/current/question/answer', () => {
  it('returns 401 without auth', async () => {
    const res = await app.fetch(req('PUT', ANSWER_PATH));
    expect(res.status).toBe(401);
  });

  it('returns 400 for a blank answer', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('PUT', ANSWER_PATH, { jwt, body: { answer: '   ' } }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when the answer exceeds the limit', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('PUT', ANSWER_PATH, {
      jwt,
      body: { answer: 'a'.repeat(501) },
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when the user has no space', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([]); // no active membership
    const res = await app.fetch(req('PUT', ANSWER_PATH, {
      jwt,
      body: { answer: 'Something small and true.' },
    }));
    expect(res.status).toBe(400);
    expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
  });

  it('upserts your answer and returns the fresh state (still unrevealed when alone)', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [spaceMemberRow()], // membership gate
      [weeklyAnswerRow({ answer: 'Something small and true.' })], // post-upsert read
      [{ displayName: 'Mara' }]
    );
    const res = await app.fetch(req('PUT', ANSWER_PATH, {
      jwt,
      body: { answer: 'Something small and true.' },
    }));
    expect(res.status).toBe(200);
    expect(vi.mocked(db.insert)).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body.yourAnswer).toBe('Something small and true.');
    expect(body.partnerAnswered).toBe(false);
    expect(body.revealed).toBe(false);
  });

  it('reveals immediately when the partner had already answered', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [spaceMemberRow()],
      [
        weeklyAnswerRow({ answer: 'Something small and true.' }),
        weeklyAnswerRow({
          id: '00000000-0000-0000-0000-000000000051',
          userId: TEST_OTHER_USER_ID,
          answer: 'Their secret answer',
        }),
      ],
      [{ displayName: 'Mara' }]
    );
    const res = await app.fetch(req('PUT', ANSWER_PATH, {
      jwt,
      body: { answer: 'Something small and true.' },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.revealed).toBe(true);
    expect(body.partnerAnswer).toBe('Their secret answer');
  });
});
