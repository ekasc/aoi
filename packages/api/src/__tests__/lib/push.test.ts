import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  sendPushToUser,
  notifyPartnerInSpace,
  buildPushCopy,
  getPushEndpoint,
  setPushEndpoint,
} from '../../lib/push.js';

const DEFAULT_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_PARTNER_ID = '00000000-0000-0000-0000-000000000002';
const TEST_SPACE_ID = '00000000-0000-0000-0000-000000000010';

const mockSelectQueue: Array<Array<Record<string, unknown>>> = [];
const deleteWhereCalls: unknown[] = [];

vi.mock('../../db/index.js', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(mockSelectQueue.shift() ?? [])),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn((predicate: unknown) => {
        deleteWhereCalls.push(predicate);
        return Promise.resolve([]);
      }),
    })),
  },
}));

const fetchMock = vi.fn();

function pushResponse(tickets: Array<Record<string, unknown>>, status = 200) {
  return new Response(JSON.stringify({ data: tickets }), { status });
}

beforeEach(() => {
  mockSelectQueue.length = 0;
  deleteWhereCalls.length = 0;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(pushResponse([{ id: 't-1', status: 'ok' }]));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setPushEndpoint(DEFAULT_ENDPOINT);
});

function tokenRow(expoPushToken: string, overrides: Record<string, unknown> = {}) {
  return { expoPushToken, ...overrides };
}

describe('buildPushCopy', () => {
  it('gives every kind a warm, vague title and body', () => {
    for (const kind of ['squeeze', 'moment_added', 'moment_edited', 'moment_deleted', 'letter_sealed'] as const) {
      const copy = buildPushCopy(kind);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.body.length).toBeGreaterThan(0);
    }
  });

  it('location kinds carry the sender name at most — never coordinates', () => {
    const request = buildPushCopy('location_request', 'Mara');
    expect(request.title).toContain('Mara');
    const granted = buildPushCopy('location_granted', 'Mara');
    expect(granted.title).toContain('Mara');
    const stopped = buildPushCopy('location_stopped');
    expect(stopped.title.length).toBeGreaterThan(0);

    // The builder has no coordinate parameter; assert the copy for every
    // location kind stays free of anything resembling a position.
    for (const copy of [request, granted, stopped]) {
      expect(`${copy.title} ${copy.body}`).not.toMatch(/\d+\.\d+/);
    }
  });

  it('moment copy never carries content — the builder accepts none', () => {
    // Structural privacy: buildPushCopy(kind) has no content parameter, so
    // moment text can never enter a payload through it. Assert the copy for
    // the moment kinds stays generic.
    const secret = 'dinner at the pier, sunset, her laugh';
    for (const kind of ['moment_added', 'moment_edited', 'moment_deleted'] as const) {
      const copy = buildPushCopy(kind);
      expect(`${copy.title} ${copy.body}`).not.toContain(secret);
    }
  });

  it('letter_sealed copy never carries the words or the date', () => {
    const copy = buildPushCopy('letter_sealed');
    const wire = `${copy.title} ${copy.body}`;
    expect(wire).not.toContain('tide');
    expect(wire).not.toContain('summer');
    // The opening day is content too — never in the copy.
    expect(wire).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(wire).not.toMatch(/\b\d{1,2}\b/);
  });
});

describe('sendPushToUser', () => {
  it('does not call Expo when the user has no tokens', async () => {
    mockSelectQueue.push([]);
    await sendPushToUser(TEST_USER_ID, { title: 't', body: 'b' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends one Expo message per token, silent by default', async () => {
    mockSelectQueue.push([
      tokenRow('ExpoPushToken[device-a]'),
      tokenRow('ExpoPushToken[device-b]'),
    ]);
    fetchMock.mockResolvedValue(
      pushResponse([{ id: 't-1', status: 'ok' }, { id: 't-2', status: 'ok' }])
    );

    await sendPushToUser(TEST_USER_ID, {
      title: 'A squeeze for you',
      body: 'Your partner is thinking of you.',
      data: { kind: 'squeeze' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(DEFAULT_ENDPOINT);
    const sent = JSON.parse(init.body);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({
      to: 'ExpoPushToken[device-a]',
      title: 'A squeeze for you',
      body: 'Your partner is thinking of you.',
      data: { kind: 'squeeze' },
      sound: null, // silent — memories must never become noise
    });
  });

  it('batches messages in groups of 100', async () => {
    const rows = Array.from({ length: 150 }, (_, i) => tokenRow(`ExpoPushToken[device-${i}]`));
    mockSelectQueue.push(rows);
    fetchMock.mockResolvedValue(pushResponse([]));

    await sendPushToUser(TEST_USER_ID, { title: 't', body: 'b' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toHaveLength(100);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toHaveLength(50);
  });

  it('removes tokens whose tickets report DeviceNotRegistered or InvalidPushToken', async () => {
    mockSelectQueue.push([
      tokenRow('ExpoPushToken[healthy]'),
      tokenRow('ExpoPushToken[dead-device]'),
      tokenRow('ExpoPushToken[invalid-token]'),
    ]);
    fetchMock.mockResolvedValue(
      pushResponse([
        { id: 't-1', status: 'ok' },
        { status: 'error', details: { error: 'DeviceNotRegistered' } },
        { status: 'error', details: { error: 'InvalidPushToken' } },
      ])
    );

    await sendPushToUser(TEST_USER_ID, { title: 't', body: 'b' });

    expect(deleteWhereCalls).toHaveLength(1);
    const rendered = new PgDialect().sqlToQuery(deleteWhereCalls[0] as SQL);
    expect(rendered.params).toContain('ExpoPushToken[dead-device]');
    expect(rendered.params).toContain('ExpoPushToken[invalid-token]');
    expect(rendered.params).not.toContain('ExpoPushToken[healthy]');
    // Scoped to the recipient user.
    expect(rendered.params).toContain(TEST_USER_ID);
  });

  it('keeps tokens on transient ticket errors', async () => {
    mockSelectQueue.push([tokenRow('ExpoPushToken[busy]')]);
    fetchMock.mockResolvedValue(
      pushResponse([{ status: 'error', details: { error: 'MessageTooBig' } }])
    );

    await sendPushToUser(TEST_USER_ID, { title: 't', body: 'b' });

    expect(deleteWhereCalls).toHaveLength(0);
  });

  it('swallows fetch failures — push never breaks a request', async () => {
    mockSelectQueue.push([tokenRow('ExpoPushToken[device-a]')]);
    fetchMock.mockRejectedValue(new Error('network down'));

    await expect(
      sendPushToUser(TEST_USER_ID, { title: 't', body: 'b' })
    ).resolves.toBeUndefined();
    expect(deleteWhereCalls).toHaveLength(0);
  });

  it('swallows non-200 responses from the push endpoint', async () => {
    mockSelectQueue.push([tokenRow('ExpoPushToken[device-a]')]);
    fetchMock.mockResolvedValue(pushResponse([], 500));

    await expect(
      sendPushToUser(TEST_USER_ID, { title: 't', body: 'b' })
    ).resolves.toBeUndefined();
    expect(deleteWhereCalls).toHaveLength(0);
  });

  it('sends to an injected endpoint (relay / tests)', async () => {
    setPushEndpoint('https://relay.aoi.test/push/send');
    mockSelectQueue.push([tokenRow('ExpoPushToken[device-a]')]);

    await sendPushToUser(TEST_USER_ID, { title: 't', body: 'b' });

    expect(getPushEndpoint()).toBe('https://relay.aoi.test/push/send');
    expect(fetchMock.mock.calls[0][0]).toBe('https://relay.aoi.test/push/send');
  });

  it('gives the Expo fetch a timeout signal so a hung endpoint cannot stall callers', async () => {
    mockSelectQueue.push([tokenRow('ExpoPushToken[device-a]')]);

    await sendPushToUser(TEST_USER_ID, { title: 't', body: 'b' });

    const init = fetchMock.mock.calls[0][1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal.aborted).toBe(false);
  });

  it('swallows abort failures when a hung endpoint hits the timeout', async () => {
    mockSelectQueue.push([tokenRow('ExpoPushToken[device-a]')]);
    // What a hung Expo endpoint produces once the 10s abort fires.
    fetchMock.mockRejectedValue(
      new DOMException('This operation was aborted', 'AbortError')
    );

    await expect(
      sendPushToUser(TEST_USER_ID, { title: 't', body: 'b' })
    ).resolves.toBeUndefined();
    expect(deleteWhereCalls).toHaveLength(0);
  });

  it('still delivers later batches when an earlier batch fails', async () => {
    const rows = Array.from({ length: 150 }, (_, i) => tokenRow(`ExpoPushToken[device-${i}]`));
    mockSelectQueue.push(rows);
    fetchMock
      .mockRejectedValueOnce(new Error('first batch blew up'))
      .mockResolvedValueOnce(pushResponse([{ id: 't-2', status: 'ok' }]));

    await sendPushToUser(TEST_USER_ID, { title: 't', body: 'b' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The second batch (the remaining 50 tokens) still goes out.
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toHaveLength(50);
  });
});

describe('notifyPartnerInSpace', () => {
  it('sends to the other active member with the kind in data', async () => {
    mockSelectQueue.push(
      // Members of the space: sender + partner.
      [{ userId: TEST_USER_ID }, { userId: TEST_PARTNER_ID }],
      // Partner's tokens.
      [tokenRow('ExpoPushToken[partner-device]')]
    );

    await notifyPartnerInSpace(TEST_SPACE_ID, TEST_USER_ID, 'moment_added');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent[0]).toMatchObject({
      to: 'ExpoPushToken[partner-device]',
      data: { kind: 'moment_added' },
      sound: null,
    });
    // Vague copy only.
    expect(sent[0].title).toBe(buildPushCopy('moment_added').title);
    expect(sent[0].body).toBe(buildPushCopy('moment_added').body);
  });

  it('never pushes to the sender when they are the only member', async () => {
    mockSelectQueue.push([{ userId: TEST_USER_ID }]);

    await notifyPartnerInSpace(TEST_SPACE_ID, TEST_USER_ID, 'squeeze');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('push payloads never contain moment body text', async () => {
    const momentBody = 'we watched the tide come in and promised to come back every summer';
    mockSelectQueue.push(
      [{ userId: TEST_USER_ID }, { userId: TEST_PARTNER_ID }],
      [tokenRow('ExpoPushToken[partner-device]')]
    );

    // The route layer calls notifyPartnerInSpace with only the kind — the
    // moment body is never passed in. Simulate that contract end to end and
    // assert the wire payload stays clean.
    await notifyPartnerInSpace(TEST_SPACE_ID, TEST_USER_ID, 'moment_added');

    const wire = JSON.stringify(fetchMock.mock.calls[0][1].body);
    expect(wire).not.toContain(momentBody);
    expect(wire).not.toContain('every summer');
  });
});
