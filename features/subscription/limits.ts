/**
 * v1 Plus benefit set (P8B). Three real benefits, truthfully worded:
 * - media ceiling raised (server-enforced per Space);
 * - future-letter count cap removed (server-enforced per Space);
 * - chapter PDF keepsakes (server-Plus-gated locally).
 * Plus belongs to the shared Space — one purchase covers both members.
 * No location, no gated Memory Wall/reading, no "everything unlocked".
 *
 * Letter/upgrade gating is server-authoritative (LIMIT_EXCEEDED + usage
 * read); no client-side allowance helpers live here anymore.
 */
export const PLUS_FEATURES = [
  'More room for photos and voice memories',
  'More letters for the future',
  'PDF chapter keepsakes',
] as const;
