import { randomUUID } from 'expo-crypto';

/**
 * Opaque per-draft identity for Story capture idempotency.
 *
 * Identity rules (P4A):
 * - creating a new draft generates a new id;
 * - retrying submission of that same draft reuses its id (the callers hold
 *   it stable for the draft's lifetime, so a double-tap replays server-side
 *   instead of creating a second moment);
 * - editing a draft's contents does NOT change its id;
 * - abandoning a draft and starting another generates a new id, even for
 *   byte-identical content — identity is never derived from content or
 *   timestamps.
 *
 * The backend partial unique (space_id, created_by_user_id, client_id) is
 * the enforcement point and is intentionally untouched.
 */
export function newDraftClientId(): string {
  return `moment_${randomUUID()}`;
}
