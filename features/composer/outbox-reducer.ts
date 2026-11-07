import type { Moment } from '@/features/moments/types';

import type {
  ComposerDraft,
  PendingRecord,
  PendingSlot,
} from '@/features/composer/types';

/**
 * The composer's outbox as one reducer.
 *
 * Before this, the provider committed state with a general `setPartial(patch)`
 * at thirty call sites, so every legal record transition was implicit in the
 * exact shape of the patch handed to it. The transitions that matter:
 *
 *   queued      -> sending    (scope checked, no duplicate in flight)
 *   sending     -> delivered  (only after the API returned a moment)
 *   sending     -> failed     (coded error, slots retained for retry)
 *   sending     -> queued     (scope drift or restart recovery)
 *   failed      -> sending    (explicit retry reuses the same clientId)
 *   queued/failed -> removed  (explicit discard)
 *   delivered   -> removed    (acknowledged once the feed shows it)
 *
 * The reducer owns which fields each transition writes, so a patch can no
 * longer half-apply a transition (for example, mark a record delivered without
 * clearing its sending id). Side effects that must happen in order, such as
 * persisting before publishing `delivered`, stay in the provider; the reducer
 * is the single source of the resulting state.
 */

export type OutboxState = {
  draft: ComposerDraft | null;
  pending: PendingRecord[];
  hydrating: boolean;
  error: string | null;
  sendingIds: string[];
  scopeKey: string | null;
};

export type StoredCheckpoint = PendingSlot['uploaded'];

export type OutboxAction =
  /** No scope: hide and clear everything scoped to the previous account. */
  | { type: 'scopeCleared' }
  | { type: 'hydrated'; scopeKey: string; draft: ComposerDraft; pending: PendingRecord[] }
  | { type: 'hydrateFailed'; scopeKey: string | null; message: string }
  | { type: 'draftReplaced'; draft: ComposerDraft | null }
  | { type: 'errorSet'; message: string | null }
  /** Reserve this client id as in flight; the record itself is unchanged. */
  | { type: 'sendRequested'; clientId: string }
  /** The manifest write failed before any network call. */
  | { type: 'sendNotPersisted'; clientId: string; message: string }
  /** The send record is now on disk and owns the client id. */
  | { type: 'sendPersisted'; record: PendingRecord }
  | { type: 'slotUploaded'; clientId: string; stagedId: string; uploaded: StoredCheckpoint; now: string }
  | { type: 'sendDelivered'; clientId: string; record: PendingRecord }
  | { type: 'sendRequeued'; clientId: string }
  | { type: 'sendFailed'; clientId: string; record: PendingRecord; message: string }
  /** Release the in-flight marker without changing the record. */
  | { type: 'sendFinished'; clientId: string }
  | { type: 'draftAndPendingReplaced'; draft: ComposerDraft; pending: PendingRecord[] }
  | { type: 'pendingRemoved'; clientId: string; clearError?: boolean }
  | { type: 'corruptReset'; draft: ComposerDraft; scopeKey: string };

export function outboxReducer(state: OutboxState, action: OutboxAction): OutboxState {
  switch (action.type) {
    case 'scopeCleared':
      return {
        draft: null,
        pending: [],
        hydrating: false,
        error: null,
        sendingIds: [],
        scopeKey: null,
      };
    case 'hydrated':
      return {
        draft: action.draft,
        pending: action.pending,
        hydrating: false,
        error: null,
        sendingIds: [],
        scopeKey: action.scopeKey,
      };
    case 'hydrateFailed':
      return {
        ...state,
        draft: null,
        pending: [],
        hydrating: false,
        error: action.message,
        scopeKey: action.scopeKey,
      };
    case 'draftReplaced':
      return { ...state, draft: action.draft, error: null };
    case 'errorSet':
      return { ...state, error: action.message };
    case 'sendRequested':
      return state.sendingIds.includes(action.clientId)
        ? state
        : { ...state, sendingIds: [...state.sendingIds, action.clientId] };
    case 'sendNotPersisted':
      return {
        ...state,
        pending: state.pending.map((record) =>
          record.clientId === action.clientId
            ? { ...record, status: 'failed', errorMessage: action.message }
            : record
        ),
        sendingIds: state.sendingIds.filter((id) => id !== action.clientId),
        error: action.message,
      };
    case 'sendPersisted':
      return {
        ...state,
        pending: state.pending.map((record) =>
          record.clientId === action.record.clientId ? action.record : record
        ),
      };
    case 'slotUploaded':
      return {
        ...state,
        pending: state.pending.map((record) =>
          record.clientId === action.clientId
            ? {
                ...record,
                slots: record.slots.map((slot) =>
                  slot.stagedId === action.stagedId
                    ? { ...slot, uploaded: action.uploaded }
                    : slot
                ),
                updatedAt: action.now,
              }
            : record
        ),
      };
    case 'sendDelivered':
      return {
        ...state,
        pending: state.pending.map((record) =>
          record.clientId === action.clientId ? action.record : record
        ),
        sendingIds: state.sendingIds.filter((id) => id !== action.clientId),
        error: null,
      };
    case 'sendRequeued':
      return {
        ...state,
        pending: state.pending.map((record) =>
          record.clientId === action.clientId
            ? { ...record, status: 'queued' }
            : record
        ),
        sendingIds: state.sendingIds.filter((id) => id !== action.clientId),
      };
    case 'sendFailed':
      return {
        ...state,
        pending: state.pending.map((record) =>
          record.clientId === action.clientId ? action.record : record
        ),
        sendingIds: state.sendingIds.filter((id) => id !== action.clientId),
        error: action.message,
      };
    case 'sendFinished':
      return {
        ...state,
        sendingIds: state.sendingIds.filter((id) => id !== action.clientId),
      };
    case 'draftAndPendingReplaced':
      return {
        ...state,
        draft: action.draft,
        pending: action.pending,
        error: null,
      };
    case 'pendingRemoved':
      return {
        ...state,
        pending: state.pending.filter((record) => record.clientId !== action.clientId),
        ...(action.clearError ? { error: null } : null),
      };
    case 'corruptReset':
      return {
        draft: action.draft,
        pending: [],
        hydrating: false,
        error: null,
        sendingIds: [],
        scopeKey: action.scopeKey,
      };
    default:
      return state;
  }
}

/** The record a send starts from: same client id, counted attempt, clean error. */
export function beginSendRecord(record: PendingRecord, nowIso: string): PendingRecord {
  return {
    ...record,
    status: 'sending',
    attempts: record.attempts + 1,
    updatedAt: nowIso,
    errorCode: null,
    errorMessage: null,
  };
}

/** The terminal success record, retained until the feed acknowledges it. */
export function deliveredRecord(
  sending: PendingRecord,
  moment: Moment,
  slots: PendingSlot[],
  nowIso: string
): PendingRecord {
  return {
    ...sending,
    status: 'delivered',
    deliveredMoment: moment,
    errorCode: null,
    errorMessage: null,
    updatedAt: nowIso,
    slots: slots.map((slot) => ({ ...slot })),
  };
}

/** The terminal failure record; slots and attempts survive for an explicit retry. */
export function failedRecord(
  sending: PendingRecord,
  input: { code: string | null; message: string; slots: PendingSlot[]; nowIso: string }
): PendingRecord {
  return {
    ...sending,
    status: 'failed',
    errorCode: input.code,
    errorMessage: input.message,
    updatedAt: input.nowIso,
    slots: input.slots.map((slot) => ({ ...slot })),
  };
}
