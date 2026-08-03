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

  it('serializes reminderMinutesBefore, allDay and together', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [spaceMemberRow()],
      [eventRow({ reminderMinutesBefore: [30], allDay: true, together: true })]
    );
    const res = await app.fetch(
      req('GET', '/v1/spaces/current/calendar/events?from=2026-03-01T00:00:00Z&to=2026-03-31T23:59:59Z', { jwt })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0]).toMatchObject({
      reminderMinutesBefore: [30],
      allDay: true,
      together: true,
    });
  });

  it('defaults allDay/together to false and omits empty reminders', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([spaceMemberRow()], [eventRow()]);
    const res = await app.fetch(
      req('GET', '/v1/spaces/current/calendar/events?from=2026-03-01T00:00:00Z&to=2026-03-31T23:59:59Z', { jwt })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0].allDay).toBe(false);
    expect(body[0].together).toBe(false);
    expect(body[0].reminderMinutesBefore).toBeUndefined();
  });

  it('serializes isOwn relative to the requester, not the actor', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [spaceMemberRow()],
      [
        eventRow(),
        // Self-created event "about" the partner: still own.
        eventRow({ id: '00000000-0000-0000-0000-000000000031', actor: 'partner', actorName: 'Alex' }),
        // Partner-created event: not own, whatever the actor says.
        eventRow({ id: '00000000-0000-0000-0000-000000000032', createdByUserId: TEST_OTHER_USER_ID }),
      ]
    );
    const res = await app.fetch(
      req('GET', '/v1/spaces/current/calendar/events?from=2026-03-01T00:00:00Z&to=2026-03-31T23:59:59Z', { jwt })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0].isOwn).toBe(true);
    expect(body[1].isOwn).toBe(true);
    expect(body[2].isOwn).toBe(false);
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

  it('returns the serialized event for a member of the space', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [eventRow({ together: true, reminderMinutesBefore: [10, 60] })],
      [spaceMemberRow()]
    );
    const res = await app.fetch(req('GET', `/v1/calendar/events/${TEST_EVENT_ID}`, { jwt }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      id: TEST_EVENT_ID,
      together: true,
      allDay: false,
      reminderMinutesBefore: [10, 60],
      isOwn: true,
    });
  });

  it('marks a partner-created event as not own for a member', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push(
      [eventRow({ createdByUserId: TEST_OTHER_USER_ID, actor: 'you', actorName: 'You' })],
      [spaceMemberRow()]
    );
    const res = await app.fetch(req('GET', `/v1/calendar/events/${TEST_EVENT_ID}`, { jwt }));
    expect(res.status).toBe(200);
    const body = await res.json();
    // actor says "you" but the creator is the partner: not editable.
    expect(body.isOwn).toBe(false);
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
    expect(body).toMatchObject({ id: TEST_EVENT_ID, isOwn: true });
  });

  it('returns 400 when endsAt is not strictly after startsAt', async () => {
    const jwt = await getTestJwt();
    const equal = await app.fetch(req('POST', '/v1/spaces/current/calendar/events', {
      jwt, body: { title: 'Test', startsAt: '2026-03-15T10:00:00Z', endsAt: '2026-03-15T10:00:00Z', actor: 'you', actorName: 'You', label: { preset: 'Date' } },
    }));
    expect(equal.status).toBe(400);

    const inverted = await app.fetch(req('POST', '/v1/spaces/current/calendar/events', {
      jwt, body: { title: 'Test', startsAt: '2026-03-15T10:00:00Z', endsAt: '2026-03-15T09:00:00Z', actor: 'you', actorName: 'You', label: { preset: 'Date' } },
    }));
    expect(inverted.status).toBe(400);
  });

  it('round-trips reminderMinutesBefore, allDay and together', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([spaceMemberRow()]);
    mockReturningResult = [eventRow({ reminderMinutesBefore: [10, 60], allDay: true, together: true })];
    const res = await app.fetch(req('POST', '/v1/spaces/current/calendar/events', {
      jwt, body: {
        title: 'Visit', startsAt: '2026-03-15T00:00:00Z', endsAt: '2026-03-16T00:00:00Z',
        actor: 'you', actorName: 'You', label: { preset: 'Date' },
        reminderMinutesBefore: [10, 60], allDay: true, together: true,
      },
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      id: TEST_EVENT_ID,
      reminderMinutesBefore: [10, 60],
      allDay: true,
      together: true,
    });
  });

  it('returns 400 for a reminder offset above the maximum', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('POST', '/v1/spaces/current/calendar/events', {
      jwt, body: {
        title: 'Test', startsAt: '2026-03-15T10:00:00Z', endsAt: '2026-03-15T11:00:00Z',
        actor: 'you', actorName: 'You', label: { preset: 'Date' }, reminderMinutesBefore: [5000],
      },
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for a non-integer reminder offset', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('POST', '/v1/spaces/current/calendar/events', {
      jwt, body: {
        title: 'Test', startsAt: '2026-03-15T10:00:00Z', endsAt: '2026-03-15T11:00:00Z',
        actor: 'you', actorName: 'You', label: { preset: 'Date' }, reminderMinutesBefore: [2.5],
      },
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for too many reminder offsets', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('POST', '/v1/spaces/current/calendar/events', {
      jwt, body: {
        title: 'Test', startsAt: '2026-03-15T10:00:00Z', endsAt: '2026-03-15T11:00:00Z',
        actor: 'you', actorName: 'You', label: { preset: 'Date' },
        reminderMinutesBefore: [0, 5, 10, 15, 30, 60, 120, 240, 1440],
      },
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for duplicate reminder offsets', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('POST', '/v1/spaces/current/calendar/events', {
      jwt, body: {
        title: 'Test', startsAt: '2026-03-15T10:00:00Z', endsAt: '2026-03-15T11:00:00Z',
        actor: 'you', actorName: 'You', label: { preset: 'Date' }, reminderMinutesBefore: [30, 30],
      },
    }));
    expect(res.status).toBe(400);
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

  it('round-trips reminderMinutesBefore, allDay and together on update', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([eventRow()], [spaceMemberRow()]);
    mockReturningResult = [eventRow({ reminderMinutesBefore: [30], allDay: false, together: true })];
    const res = await app.fetch(req('PATCH', `/v1/calendar/events/${TEST_EVENT_ID}`, {
      jwt, body: { reminderMinutesBefore: [30], allDay: false, together: true },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      reminderMinutesBefore: [30],
      allDay: false,
      together: true,
    });
  });

  it('clears reminders when reminderMinutesBefore is an empty array', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([eventRow({ reminderMinutesBefore: [30] })], [spaceMemberRow()]);
    mockReturningResult = [eventRow({ reminderMinutesBefore: null })];
    const res = await app.fetch(req('PATCH', `/v1/calendar/events/${TEST_EVENT_ID}`, {
      jwt, body: { reminderMinutesBefore: [] },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reminderMinutesBefore).toBeUndefined();
  });

  it('returns 400 for a negative reminder offset', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('PATCH', `/v1/calendar/events/${TEST_EVENT_ID}`, {
      jwt, body: { reminderMinutesBefore: [-5] },
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for duplicate reminder offsets', async () => {
    const jwt = await getTestJwt();
    const res = await app.fetch(req('PATCH', `/v1/calendar/events/${TEST_EVENT_ID}`, {
      jwt, body: { reminderMinutesBefore: [30, 30] },
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when a partial update would make endsAt <= startsAt', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([eventRow()], [spaceMemberRow()]);
    const res = await app.fetch(req('PATCH', `/v1/calendar/events/${TEST_EVENT_ID}`, {
      // Existing event starts at 10:00Z — ending at 09:00Z is invalid.
      jwt, body: { endsAt: '2026-03-15T09:00:00Z' },
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when updated startsAt crosses the existing endsAt', async () => {
    const jwt = await getTestJwt();
    mockSelectQueue.push([eventRow()], [spaceMemberRow()]);
    const res = await app.fetch(req('PATCH', `/v1/calendar/events/${TEST_EVENT_ID}`, {
      // Existing event ends at 11:00Z — starting at noon is invalid.
      jwt, body: { startsAt: '2026-03-15T12:00:00Z' },
    }));
    expect(res.status).toBe(400);
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
