import type { PendingStatus } from './types';

/**
 * One status string per pending state. `delivered` is a success, not a
 * fall-through to the failure copy; the row can stay visible while the feed
 * catches up.
 */
export function pendingStatusLabel(
  status: PendingStatus,
  isSending: boolean,
  errorMessage: string | null | undefined
): string {
  if (status === 'delivered') return 'Sent';
  if (isSending || status === 'sending') return 'Sending…';
  if (status === 'queued') return 'Waiting to send';
  return errorMessage ?? 'Could not send yet.';
}
