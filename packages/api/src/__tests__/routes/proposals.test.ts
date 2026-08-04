import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
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

const TEST_PROPOSAL_ID = '00000000-0000-0000-0000-000000000040';
const TEST_OTHER_SPACE_ID = '00000000-0000-0000-0000-000000000011';
const PROPOSALS_PATH = '/v1/spaces/current/proposals';

// Fixed "now" so the strictly-future check is deterministic.
const FIXED_NOW = new Date('2026-08-03T12:00:00Z');
const FUTURE_START = '2026-09-15T10:00:00Z';
const FUTURE_END = '2026-09-15T12:00:00Z';
const PROPOSAL_TITLE = 'How about the farmers market?';

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
    returning: vi.fn(() => Promise.resolve(mockReturningResult)),
    then: (resolve: Function) => resolve(mockReturningResult),
  };
}

function updateChain() {
  return {
    set: vi.fn(() => updateChain()),
    where: vi.fn(() => updateChain()),
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

function proposalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_PROPOSAL_ID,
    spaceId: TEST_SPACE_ID,
    proposerUserId: TEST_OTHER_USER_ID,
    // The list query joins the proposer's display name as `proposerName`.
    proposerName: 'Mara',
    title: PROPOSAL_TITLE,
    proposedStart: new Date(FUTURE_START),
    proposedEnd: new Date(FUTURE_END),
    label: null,
    status: 'pending' as const,
    createdAt: new Date('2026-08-02T10:00:00Z'),
    resolvedAt: null,
    ...overrides,
  };
}

function spaceMemberRow(overrides: Record<string, unknown> = {}) {
  return { spaceId: TEST_SPACE_ID, userId: TEST_USER_ID, state: 'active' as const, role: 'partner' as const, ...overrides };
}

const VALID_PROPOSAL_BODY = {
  title: PROPOSAL_TITLE,
  proposedStart: FUTURE_START,
  proposedEnd: FUTURE_END,
};

function wordOnly(message: unknown) {
  expect(typeof message).toBe('string');
  expect(message as string).not.toMatch(/\d/);
}

describe('POST /v1/spaces/current/proposals (suggest a time)', () => {
  it('returns 401 without auth', async () => {
    const res = await app.fetch(req('POST', PROPOSALS_PATH));
    expect(res.status).toBe(401);
  });

  it('returns 400 for a missing title with a word-only message', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('POST', PROPOSALS_PATH, {
      jwt, body: { proposedStart: FUTURE_START, proposedEnd: FUTURE_END },
    }));
    expect(res.status).toBe(400);
    const payload = await res.json();
    expect(payload.error.message).toBe('Give the idea a few words');
    wordOnly(payload.error.message);
    expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
  });

  it('returns 400 for a title over the limit, word-only', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('POST', PROPOSALS_PATH, {
      jwt, body: { ...VALID_PROPOSAL_BODY, title: 'a'.repeat(121) },
    }));
    expect(res.status).toBe(400);
    const payload = await res.json();
    expect(payload.error.message).toBe('Keep the suggestion short and sweet');
    wordOnly(payload.error.message);
  });

  it('returns 400 for a malformed time, word-only and never echoing it', async () => {
    const jwt = await getTestJwt();
    for (const body of [
      { ...VALID_PROPOSAL_BODY, proposedStart: 'next saturday' },
      { ...VALID_PROPOSAL_BODY, proposedEnd: 'in the evening' },
      { title: PROPOSAL_TITLE, proposedStart: FUTURE_START },
    ]) {
      const res = await app.fetch(req('POST', PROPOSALS_PATH, { jwt, body }));
      expect(res.status).toBe(400);
      const payload = await res.json();
      expect(payload.error.message).toBe("That time doesn't look quite right");
      wordOnly(payload.error.message);
      expect(payload.error.message).not.toContain('saturday');
    }
  });

  it('returns 400 when the user has no space', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([]);
    const res = await app.fetch(req('POST', PROPOSALS_PATH, { jwt, body: VALID_PROPOSAL_BODY }));
    expect(res.status).toBe(400);
    expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
    expect(notifyPartnerInSpace).not.toHaveBeenCalled();
  });

  it('returns 400 for a start in the past, word-only', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([spaceMemberRow()]);
    const res = await app.fetch(req('POST', PROPOSALS_PATH, {
      jwt,
      body: { ...VALID_PROPOSAL_BODY, proposedStart: '2026-08-01T10:00:00Z' },
    }));
    expect(res.status).toBe(400);
    const payload = await res.json();
    expect(payload.error.message).toBe('A suggestion can only point to the future');
    wordOnly(payload.error.message);
    expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
  });

  it('returns 400 when the end does not come after the start', async () => {
    const jwt = await getTestJwt();
    for (const proposedEnd of [FUTURE_START, '2026-09-15T09:00:00Z']) {
      mockSelectQueue.push([spaceMemberRow()]);
      const res = await app.fetch(req('POST', PROPOSALS_PATH, {
        jwt, body: { ...VALID_PROPOSAL_BODY, proposedEnd },
      }));
      expect(res.status).toBe(400);
      const payload = await res.json();
      expect(payload.error.message).toBe('The ending needs to come after the start');
      wordOnly(payload.error.message);
    }
    expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
  });

  it('creates the proposal and returns it as the viewer\'s own', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([spaceMemberRow()]);
    mockReturningResult = [proposalRow({ proposerUserId: TEST_USER_ID, title: PROPOSAL_TITLE })];
    const res = await app.fetch(req('POST', PROPOSALS_PATH, { jwt, body: VALID_PROPOSAL_BODY }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      id: TEST_PROPOSAL_ID,
      proposerRole: 'you',
      proposerName: 'You',
      title: PROPOSAL_TITLE,
      proposedStart: '2026-09-15T10:00:00.000Z',
      proposedEnd: '2026-09-15T12:00:00.000Z',
      status: 'pending',
      resolvedAt: null,
    });
  });

  it('stores an Other label with its custom text and echoes it back', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([spaceMemberRow()]);
    mockReturningResult = [
      proposalRow({
        proposerUserId: TEST_USER_ID,
        label: { preset: 'Other', customText: 'Anniversary' },
      }),
    ];
    const res = await app.fetch(req('POST', PROPOSALS_PATH, {
      jwt,
      body: { ...VALID_PROPOSAL_BODY, label: { preset: 'Other', customText: 'Anniversary' } },
    }));
    expect(res.status).toBe(201);
    const values = vi.mocked(db.insert).mock.results[0].value.values.mock.calls[0][0];
    expect(values.label).toEqual({ preset: 'Other', customText: 'Anniversary' });
    const body = await res.json();
    expect(body.label).toEqual({ preset: 'Other', customText: 'Anniversary' });
  });

  it('notifies the partner with proposal_received and no content channel', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([spaceMemberRow()]);
    mockReturningResult = [proposalRow({ proposerUserId: TEST_USER_ID })];
    const res = await app.fetch(req('POST', PROPOSALS_PATH, { jwt, body: VALID_PROPOSAL_BODY }));
    expect(res.status).toBe(201);
    expect(notifyPartnerInSpace).toHaveBeenCalledTimes(1);
    expect(notifyPartnerInSpace).toHaveBeenCalledWith(TEST_SPACE_ID, TEST_USER_ID, 'proposal_received');
    // Structural privacy: exactly (space, sender, kind) — no channel through
    // which the title or the time could travel.
    expect(vi.mocked(notifyPartnerInSpace).mock.calls[0]).toHaveLength(3);
    expect(JSON.stringify(vi.mocked(notifyPartnerInSpace).mock.calls[0]))
      .not.toContain(PROPOSAL_TITLE);
  });
});

describe('GET /v1/spaces/current/proposals', () => {
  it('returns 401 without auth', async () => {
    const res = await app.fetch(req('GET', PROPOSALS_PATH));
    expect(res.status).toBe(401);
  });

  it('returns an empty list when the user has no space', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([]);
    const res = await app.fetch(req('GET', PROPOSALS_PATH, { jwt }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ proposals: [] });
  });

  it('computes authorship relative to the viewer', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [spaceMemberRow()],
      [
        proposalRow(), // partner's proposal
        proposalRow({
          id: '00000000-0000-0000-0000-000000000041',
          proposerUserId: TEST_USER_ID,
          createdAt: new Date('2026-08-01T10:00:00Z'),
        }),
      ]
    );
    const res = await app.fetch(req('GET', PROPOSALS_PATH, { jwt }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.proposals).toHaveLength(2);
    expect(body.proposals[0]).toMatchObject({
      proposerRole: 'partner',
      proposerName: 'Mara',
      status: 'pending',
    });
    expect(body.proposals[1]).toMatchObject({
      proposerRole: 'you',
      proposerName: 'You',
    });
  });
});

describe('POST /v1/proposals/:id/accept', () => {
  const ACCEPT_PATH = `/v1/proposals/${TEST_PROPOSAL_ID}/accept`;

  it('returns 401 without auth', async () => {
    const res = await app.fetch(req('POST', ACCEPT_PATH));
    expect(res.status).toBe(401);
  });

  it('returns 400 for a non-UUID id', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('POST', '/v1/proposals/not-a-uuid/accept', { jwt }));
    expect(res.status).toBe(400);
  });

  it('returns 404 for a non-existent proposal', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([]);
    const res = await app.fetch(req('POST', ACCEPT_PATH, { jwt }));
    expect(res.status).toBe(404);
    expect(vi.mocked(db.update)).not.toHaveBeenCalled();
  });

  it('returns 404 for another space\'s proposal (no existence leaks)', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [proposalRow({ spaceId: TEST_OTHER_SPACE_ID })],
      [] // no membership in the other space
    );
    const res = await app.fetch(req('POST', ACCEPT_PATH, { jwt }));
    expect(res.status).toBe(404);
    expect(vi.mocked(db.update)).not.toHaveBeenCalled();
    expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
  });

  it('returns 403 when the proposer tries to answer their own suggestion', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [proposalRow({ proposerUserId: TEST_USER_ID })],
      [spaceMemberRow()]
    );
    const res = await app.fetch(req('POST', ACCEPT_PATH, { jwt }));
    expect(res.status).toBe(403);
    const payload = await res.json();
    expect(payload.error.message).toBe('This one is theirs to answer');
    wordOnly(payload.error.message);
    expect(vi.mocked(db.update)).not.toHaveBeenCalled();
  });

  it('returns 400 when the proposal was already answered', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [proposalRow({ status: 'declined', resolvedAt: new Date('2026-08-02T12:00:00Z') })],
      [spaceMemberRow()]
    );
    const res = await app.fetch(req('POST', ACCEPT_PATH, { jwt }));
    expect(res.status).toBe(400);
    const payload = await res.json();
    expect(payload.error.message).toBe('This one has already been answered');
    wordOnly(payload.error.message);
    expect(vi.mocked(db.update)).not.toHaveBeenCalled();
    expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
  });

  it('a racing double-resolve loses the atomic gate and creates no event', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [proposalRow()],
      [spaceMemberRow()],
      [{ role: 'partner', displayName: 'Mara' }]
    );
    // The scoped UPDATE matches nothing — someone answered first.
    mockReturningResult = [];
    const res = await app.fetch(req('POST', ACCEPT_PATH, { jwt }));
    expect(res.status).toBe(400);
    const payload = await res.json();
    expect(payload.error.message).toBe('This one has already been answered');
    expect(vi.mocked(db.update)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
    expect(notifyPartnerInSpace).not.toHaveBeenCalled();
  });

  it('accepts and creates the calendar event under the proposer\'s authorship', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [proposalRow({ label: { preset: 'Date' } })],
      [spaceMemberRow()],
      [{ role: 'partner', displayName: 'Mara' }],
      [{ role: 'partner' }] // proposer's membership role for the event's actor
    );
    mockReturningResult = [proposalRow({
      label: { preset: 'Date' },
      status: 'accepted',
      resolvedAt: FIXED_NOW,
    })];
    const res = await app.fetch(req('POST', ACCEPT_PATH, { jwt }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      id: TEST_PROPOSAL_ID,
      proposerRole: 'partner',
      proposerName: 'Mara',
      status: 'accepted',
      resolvedAt: '2026-08-03T12:00:00.000Z',
    });

    // The acceptance copies the proposal into a real calendar event.
    expect(vi.mocked(db.insert)).toHaveBeenCalledTimes(1);
    const values = vi.mocked(db.insert).mock.results[0].value.values.mock.calls[0][0];
    expect(values).toMatchObject({
      spaceId: TEST_SPACE_ID,
      createdByUserId: TEST_OTHER_USER_ID, // authorship stays with the proposer
      actor: 'partner', // proposer's membership role — the authorship snapshot
      actorName: 'Mara',
      title: PROPOSAL_TITLE,
      startsAt: new Date(FUTURE_START),
      endsAt: new Date(FUTURE_END),
      labelPreset: 'Date',
      labelCustomText: null,
      recurrence: 'none',
      recurrenceGroupId: null,
      reminderMinutesBefore: null,
      allDay: false,
      together: false,
    });
  });

  it('copies an Other label\'s custom text into the created event', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [proposalRow({ label: { preset: 'Other', customText: 'Anniversary' } })],
      [spaceMemberRow()],
      [{ role: 'partner', displayName: 'Mara' }],
      [{ role: 'partner' }]
    );
    mockReturningResult = [proposalRow({ status: 'accepted', resolvedAt: FIXED_NOW })];
    const res = await app.fetch(req('POST', ACCEPT_PATH, { jwt }));
    expect(res.status).toBe(200);
    const values = vi.mocked(db.insert).mock.results[0].value.values.mock.calls[0][0];
    expect(values.labelPreset).toBe('Other');
    expect(values.labelCustomText).toBe('Anniversary');
  });

  it('notifies the proposer with proposal_accepted and no content', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [proposalRow()],
      [spaceMemberRow()],
      [{ role: 'partner', displayName: 'Mara' }],
      [{ role: 'partner' }]
    );
    mockReturningResult = [proposalRow({ status: 'accepted', resolvedAt: FIXED_NOW })];
    const res = await app.fetch(req('POST', ACCEPT_PATH, { jwt }));
    expect(res.status).toBe(200);
    expect(notifyPartnerInSpace).toHaveBeenCalledTimes(1);
    expect(notifyPartnerInSpace).toHaveBeenCalledWith(TEST_SPACE_ID, TEST_USER_ID, 'proposal_accepted');
    expect(vi.mocked(notifyPartnerInSpace).mock.calls[0]).toHaveLength(3);
    expect(JSON.stringify(vi.mocked(notifyPartnerInSpace).mock.calls[0]))
      .not.toContain(PROPOSAL_TITLE);
  });
});

describe('POST /v1/proposals/:id/decline', () => {
  const DECLINE_PATH = `/v1/proposals/${TEST_PROPOSAL_ID}/decline`;

  it('returns 401 without auth', async () => {
    const res = await app.fetch(req('POST', DECLINE_PATH));
    expect(res.status).toBe(401);
  });

  it('returns 404 for a non-existent proposal', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([]);
    const res = await app.fetch(req('POST', DECLINE_PATH, { jwt }));
    expect(res.status).toBe(404);
  });

  it('returns 403 for the proposer\'s own suggestion', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [proposalRow({ proposerUserId: TEST_USER_ID })],
      [spaceMemberRow()]
    );
    const res = await app.fetch(req('POST', DECLINE_PATH, { jwt }));
    expect(res.status).toBe(403);
    expect(vi.mocked(db.update)).not.toHaveBeenCalled();
  });

  it('declines a pending proposal and creates no calendar event', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [proposalRow()],
      [spaceMemberRow()],
      [{ role: 'partner', displayName: 'Mara' }]
    );
    mockReturningResult = [proposalRow({ status: 'declined', resolvedAt: FIXED_NOW })];
    const res = await app.fetch(req('POST', DECLINE_PATH, { jwt }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      id: TEST_PROPOSAL_ID,
      proposerRole: 'partner',
      proposerName: 'Mara',
      status: 'declined',
      resolvedAt: '2026-08-03T12:00:00.000Z',
    });
    // "Not now" never manufactures an event.
    expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
  });

  it('a racing double-resolve loses the atomic gate', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [proposalRow()],
      [spaceMemberRow()],
      [{ role: 'partner', displayName: 'Mara' }]
    );
    mockReturningResult = [];
    const res = await app.fetch(req('POST', DECLINE_PATH, { jwt }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe('This one has already been answered');
    expect(notifyPartnerInSpace).not.toHaveBeenCalled();
  });

  it('notifies the proposer with proposal_declined and no content', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [proposalRow()],
      [spaceMemberRow()],
      [{ role: 'partner', displayName: 'Mara' }]
    );
    mockReturningResult = [proposalRow({ status: 'declined', resolvedAt: FIXED_NOW })];
    const res = await app.fetch(req('POST', DECLINE_PATH, { jwt }));
    expect(res.status).toBe(200);
    expect(notifyPartnerInSpace).toHaveBeenCalledTimes(1);
    expect(notifyPartnerInSpace).toHaveBeenCalledWith(TEST_SPACE_ID, TEST_USER_ID, 'proposal_declined');
    expect(vi.mocked(notifyPartnerInSpace).mock.calls[0]).toHaveLength(3);
  });
});
