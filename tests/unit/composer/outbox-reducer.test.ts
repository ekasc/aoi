import { describe, expect, it } from 'vitest';

import {
  beginSendRecord,
  deliveredRecord,
  failedRecord,
  outboxReducer,
  type OutboxAction,
  type OutboxState,
} from '@/features/composer/outbox-reducer';
import type {
  ComposerDraft,
  PendingRecord,
  PendingSlot,
} from '@/features/composer/types';
import type { Moment } from '@/features/moments/types';

const NOW = '2026-01-01T10:00:00.000Z';
const LATER = '2026-01-01T10:05:00.000Z';

const slot: PendingSlot = {
  stagedId: 'staged_1',
  kind: 'image',
  mimeType: 'image/jpeg',
  localUri: 'file:///staged_1.jpg',
  uploaded: null,
};

function record(overrides: Partial<PendingRecord> = {}): PendingRecord {
  return {
    clientId: 'client_1',
    body: 'a note',
    occurredAt: NOW,
    slots: [slot],
    status: 'queued',
    errorCode: null,
    errorMessage: null,
    attempts: 0,
    createdAt: NOW,
    updatedAt: NOW,
    scope: { viewerId: 'user_1', spaceId: 'space_1' },
    ...overrides,
  };
}

function draft(): ComposerDraft {
  return {
    clientId: 'draft_1',
    body: '',
    occurredAt: NOW,
    assets: [],
    updatedAt: NOW,
  };
}

function state(overrides: Partial<OutboxState> = {}): OutboxState {
  return {
    draft: draft(),
    pending: [record()],
    hydrating: false,
    error: null,
    sendingIds: [],
    scopeKey: 'user_1:space_1',
    ...overrides,
  };
}

function run(actions: OutboxAction[], from: OutboxState = state()): OutboxState {
  return actions.reduce(outboxReducer, from);
}

describe('composer outbox reducer', () => {
  it('reserves a client id once and leaves the record untouched until it is persisted', () => {
    const reserved = run([{ type: 'sendRequested', clientId: 'client_1' }]);
    expect(reserved.sendingIds).toEqual(['client_1']);
    expect(reserved.pending[0].status).toBe('queued');

    expect(
      run([{ type: 'sendRequested', clientId: 'client_1' }], reserved).sendingIds
    ).toEqual(['client_1']);
  });

  it('publishes the persisted sending record', () => {
    const sending = beginSendRecord(record(), NOW);
    const next = run([
      { type: 'sendRequested', clientId: 'client_1' },
      { type: 'sendPersisted', record: sending },
    ]);
    expect(next.pending[0]).toEqual(sending);
    expect(next.pending[0].attempts).toBe(1);
    expect(next.sendingIds).toEqual(['client_1']);
  });

  it('marks a pre-network manifest failure without claiming the attempt happened', () => {
    const next = run([
      { type: 'sendRequested', clientId: 'client_1' },
      { type: 'sendNotPersisted', clientId: 'client_1', message: 'Could not save.' },
    ]);
    expect(next.pending[0].status).toBe('failed');
    expect(next.pending[0].attempts).toBe(0);
    expect(next.pending[0].errorCode).toBeNull();
    expect(next.pending[0].errorMessage).toBe('Could not save.');
    expect(next.sendingIds).toEqual([]);
    expect(next.error).toBe('Could not save.');
  });

  it('only reaches delivered through a record that carries the server moment', () => {
    const sending = beginSendRecord(record(), NOW);
    const moment = { id: 'moment_1' } as unknown as Moment;
    const delivered = deliveredRecord(sending, moment, sending.slots, LATER);
    const next = run([
      { type: 'sendRequested', clientId: 'client_1' },
      { type: 'sendPersisted', record: sending },
      { type: 'sendDelivered', clientId: 'client_1', record: delivered },
    ]);

    expect(next.pending[0].status).toBe('delivered');
    expect(next.pending[0].deliveredMoment).toBe(moment);
    expect(next.pending[0].updatedAt).toBe(LATER);
    expect(next.sendingIds).toEqual([]);
    expect(next.error).toBeNull();
  });

  it('fails with the slots and attempt retained, and requeues on scope drift without touching the attempt', () => {
    const sending = beginSendRecord(record(), NOW);
    const failed = failedRecord(sending, {
      code: 'LIMIT_EXCEEDED',
      message: 'This Space is out of media room.',
      slots: sending.slots,
      nowIso: LATER,
    });
    const failedState = run([
      { type: 'sendRequested', clientId: 'client_1' },
      { type: 'sendPersisted', record: sending },
      { type: 'sendFailed', clientId: 'client_1', record: failed, message: failed.errorMessage ?? '' },
    ]);
    expect(failedState.pending[0].status).toBe('failed');
    expect(failedState.pending[0].slots).toEqual(sending.slots);
    expect(failedState.pending[0].attempts).toBe(1);
    expect(failedState.pending[0].errorCode).toBe('LIMIT_EXCEEDED');
    expect(failedState.sendingIds).toEqual([]);

    const requeued = outboxReducer(failedState, { type: 'sendRequeued', clientId: 'client_1' });
    expect(requeued.pending[0].status).toBe('queued');
    expect(requeued.pending[0].attempts).toBe(1);
    expect(requeued.pending[0].errorCode).toBe('LIMIT_EXCEEDED');
    expect(requeued.sendingIds).toEqual([]);
  });

  it('patches only the uploaded slot and the record timestamp', () => {
    const next = run([
      {
        type: 'slotUploaded',
        clientId: 'client_1',
        stagedId: 'staged_1',
        uploaded: { mediaId: 'media_1', url: 'https://example.test/media_1' },
        now: LATER,
      },
    ]);
    expect(next.pending[0].slots[0].uploaded).toEqual({
      mediaId: 'media_1',
      url: 'https://example.test/media_1',
    });
    expect(next.pending[0].updatedAt).toBe(LATER);
    expect(next.pending[0].status).toBe('queued');
  });

  it('removes a record and clears the error only when the transition asks for it', () => {
    const failed = run([{ type: 'errorSet', message: 'Something went wrong.' }]);
    expect(
      run([{ type: 'pendingRemoved', clientId: 'client_1' }], failed)
    ).toMatchObject({ pending: [], error: 'Something went wrong.' });
    expect(
      run([{ type: 'pendingRemoved', clientId: 'client_1', clearError: true }], failed)
    ).toMatchObject({ pending: [], error: null });
  });

  it('fails a hydration closed without pretending the previous scope succeeded', () => {
    const next = run([
      { type: 'hydrateFailed', scopeKey: 'user_1:space_1', message: 'Could not open saved drafts.' },
    ]);
    expect(next).toMatchObject({
      draft: null,
      pending: [],
      hydrating: false,
      error: 'Could not open saved drafts.',
      scopeKey: 'user_1:space_1',
    });
  });

  it('clears every scoped field on sign-out', () => {
    expect(
      run([
        { type: 'sendRequested', clientId: 'client_1' },
        { type: 'scopeCleared' },
      ])
    ).toEqual({
      draft: null,
      pending: [],
      hydrating: false,
      error: null,
      sendingIds: [],
      scopeKey: null,
    });
  });
});
