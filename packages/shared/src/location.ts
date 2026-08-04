/**
 * Optional, consensual, bounded location sharing — "they'll be home soon",
 * never tracking.
 *
 * Consent model (non-negotiable):
 * - BOTH partners must explicitly opt in before any location flows. Consent
 *   is stored as `space_members.location_consent_at` (nullable timestamp —
 *   the simplest correct design: one existing row per member, consent = the
 *   column is set; revoking = clearing it and deleting any share row).
 * - Either partner can stop at any time — one tap, no confirmation dialogs.
 * - The server keeps ONLY the single latest live position per user,
 *   ephemeral: upsert-on-report, deleted outright on stop/expire. No
 *   history, no trails, and coordinates never appear in logs or errors.
 */

export const LOCATION_SHARE_MODES = [
  'live',
  'until_arrive',
  'on_request_granted',
] as const;

export type LocationShareMode = (typeof LOCATION_SHARE_MODES)[number];

/** How long a reported position stays servable, per mode. */
export const LOCATION_LIVE_FRESHNESS_MINUTES = 15;
export const LOCATION_GRANT_FRESHNESS_MINUTES = 5;

/** Server-side validation bounds (mirrored by the API zod schemas). */
export const LOCATION_ACCURACY_MAX_METERS = 5000;
export const LOCATION_DESTINATION_NAME_MAX_LENGTH = 80;
export const LOCATION_DESTINATION_RADIUS_MAX_METERS = 10000;

export type LocationShareDestination = {
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
};

/**
 * POST /v1/spaces/current/location/share — upserts the caller's current
 * position. `reportedAt` is always server-assigned; clients never supply it.
 */
export type LocationShareRequest = {
  mode: LocationShareMode;
  destination?: LocationShareDestination;
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
};

export type LocationConsentRequest = {
  consented: boolean;
};

export type LocationConsentResponse = {
  youConsented: boolean;
  partnerConsented: boolean;
};

/**
 * The partner's current share, exactly as served by
 * GET /v1/spaces/current/location. Only ever the partner's position — the
 * caller's own row is never returned.
 */
export type PartnerLocationShare = {
  mode: LocationShareMode;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  reportedAt: string;
  destination: LocationShareDestination | null;
};

export type CurrentLocationResponse = {
  /** Null whenever nothing qualifies (no consent on either side, no row,
   *  stale row, consumed grant) — a calm 200, never an error. */
  location: PartnerLocationShare | null;
  /** Consent flags for the consent screen (both members may see these —
   *  mutuality is the feature). Positions are never derived from them. */
  youConsented: boolean;
  partnerConsented: boolean;
};

/** How fresh a share must be to be servable, by mode. */
export function getLocationFreshnessMs(mode: LocationShareMode): number {
  return mode === 'on_request_granted'
    ? LOCATION_GRANT_FRESHNESS_MINUTES * 60_000
    : LOCATION_LIVE_FRESHNESS_MINUTES * 60_000;
}

/**
 * Pure freshness check shared by the API and the client. A share is fresh
 * while its report time is inside the mode's window (and not in the future
 * beyond a small clock-skew tolerance).
 */
export function isLocationShareFresh(
  mode: LocationShareMode,
  reportedAtMs: number,
  nowMs: number,
  clockSkewToleranceMs = 60_000
): boolean {
  return (
    reportedAtMs <= nowMs + clockSkewToleranceMs &&
    nowMs - reportedAtMs < getLocationFreshnessMs(mode)
  );
}
