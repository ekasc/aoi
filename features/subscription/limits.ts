/**
 * v1 Plus benefit set (P8B). Four real benefits, truthfully worded:
 * - media ceiling raised (server-enforced per Space);
 * - future-letter count cap removed (server-enforced per Space);
 * - chapter PDF keepsakes (server-Plus-gated locally);
 * - Sky History, rewind the Us sky to any month of the relationship.
 * Plus belongs to the shared Space — one purchase covers both members.
 * No location, no gated Memory Wall/reading, no "everything unlocked".
 *
 * The live photo sky, random photo viewing, shared memories and everyday
 * resurfacing stay free.
 *
 * Letter/upgrade gating is server-authoritative (LIMIT_EXCEEDED + usage
 * read); no client-side allowance helpers live here anymore.
 */
export const PLUS_FEATURES = [
  'More storage for your shared archive',
  'More letters for the future',
  'PDF chapter keepsakes',
  'Sky History — revisit your sky at any point in time',
] as const;
