import { MOMENT_ATTACHMENT_MAX } from '@aoi/shared';

import type {
  ComposerDraft,
  ComposerScope,
  PendingRecord,
  PendingSlot,
} from '@/features/composer/types';
import { scopeEquals } from '@/features/composer/validate';

/** User-safe error text. Never includes URIs, keys, or server internals. */
export function userSafeMessage(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'LIMIT_EXCEEDED') return 'This Space is out of media room.';
  if (code === 'SCOPE_CHANGED') return 'Account changed. Please try again.';
  if (code === 'EMPTY_DRAFT') return 'Add a note, photo, or voice first.';
  if (code === 'TOO_MANY_ASSETS') return `Keep it to ${MOMENT_ATTACHMENT_MAX} photos or voice notes.`;
  if (code === 'UNSUPPORTED_MEDIA') return 'Only photos and voice notes are supported. Video is not supported yet.';
  if (code === 'NO_SCOPE') return 'Sign in to keep a memory.';
  if (code === 'STORE_UNAVAILABLE') return 'Could not open saved drafts. Please try again.';
  if (code === 'KEY_UNAVAILABLE') return 'Could not unlock saved drafts. Please try again.';
  if (code === 'CORRUPT') return 'Saved drafts look damaged. Discard the draft to start fresh.';
  if (code === 'DRAFT_EXISTS') return 'Finish or discard your current draft first.';
  return 'Could not keep this. Please try again.';
}

export function classifySendError(error: unknown): { code: string | null; message: string } {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && code.length > 0) {
    return { code, message: userSafeMessage(error) };
  }
  const message = error instanceof Error && error.message ? 'Could not keep this. Please try again.' : 'Could not keep this. Please try again.';
  return { code: null, message };
}

export function isDraftEmpty(draft: ComposerDraft): boolean {
  return draft.body.trim().length === 0 && draft.assets.length === 0;
}

export function newEmptyDraft(clientId: string, nowIso: string): ComposerDraft {
  return { clientId, body: '', occurredAt: nowIso, assets: [], updatedAt: nowIso };
}

export function buildPendingFromDraft(
  draft: ComposerDraft,
  scope: ComposerScope,
  nowIso: string
): PendingRecord {
  const slots: PendingSlot[] = draft.assets.map((a) => ({
    stagedId: a.stagedId,
    kind: a.kind,
    mimeType: a.mimeType,
    localUri: a.localUri,
    uploaded: a.uploaded ?? null,
  }));
  return {
    clientId: draft.clientId,
    body: draft.body,
    occurredAt: draft.occurredAt,
    slots,
    status: 'queued',
    errorCode: null,
    errorMessage: null,
    attempts: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
    scope: { ...scope },
  };
}

/**
 * Restart recovery: `sending` never survives a restart — it becomes
 * `queued` (explicit, no silent send of mutable drafts; only immutable
 * pending records are re-queued, and only on foreground with same scope).
 */
export function recoverSendingToQueued(pending: PendingRecord[]): PendingRecord[] {
  return pending.map((p) => (p.status === 'sending' ? { ...p, status: 'queued' as const } : p));
}

export function canAutoRetry(status: PendingRecord['status'], appState: string): boolean {
  return status === 'queued' && appState === 'active';
}

export function moveAssetIndex<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length) return [...items];
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Guard for every network step: abort when scope drifted (account/space switch). */
export function assertSameScope(captured: ComposerScope, current: ComposerScope | null): void {
  if (!scopeEquals(captured, current)) {
    const err = new Error('Scope changed') as Error & { code?: string };
    err.code = 'SCOPE_CHANGED';
    throw err;
  }
}
