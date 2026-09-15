import { z } from 'zod';

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

export const locationShareModeSchema = z.enum(LOCATION_SHARE_MODES);

export type LocationShareMode = z.infer<typeof locationShareModeSchema>;

/** How long a reported position stays servable, per mode. */
export const LOCATION_LIVE_FRESHNESS_MINUTES = 15;
export const LOCATION_GRANT_FRESHNESS_MINUTES = 5;

/** Server-side validation bounds (mirrored by the API zod schemas). */
export const LOCATION_ACCURACY_MAX_METERS = 5000;
export const LOCATION_DESTINATION_NAME_MAX_LENGTH = 80;
export const LOCATION_DESTINATION_RADIUS_MAX_METERS = 10000;

export const locationShareDestinationSchema = z.object({
  name: z.string().min(1).max(LOCATION_DESTINATION_NAME_MAX_LENGTH),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.number().min(0).max(LOCATION_DESTINATION_RADIUS_MAX_METERS),
});

export type LocationShareDestination = z.infer<
  typeof locationShareDestinationSchema
>;

/**
 * POST /v1/spaces/current/location/share — upserts the caller's current
 * position. `reportedAt` is always server-assigned; clients never supply it.
 */
export const locationShareRequestSchema = z.object({
  mode: locationShareModeSchema,
  destination: locationShareDestinationSchema.optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().min(0).max(LOCATION_ACCURACY_MAX_METERS).optional(),
});

export type LocationShareRequest = z.infer<typeof locationShareRequestSchema>;

export const locationConsentRequestSchema = z.object({
  consented: z.boolean(),
});

export type LocationConsentRequest = z.infer<typeof locationConsentRequestSchema>;

export const locationConsentResponseSchema = z.object({
  youConsented: z.boolean(),
  partnerConsented: z.boolean(),
});

export type LocationConsentResponse = z.infer<
  typeof locationConsentResponseSchema
>;

/**
 * The partner's current share, exactly as served by
 * GET /v1/spaces/current/location. Only ever the partner's position — the
 * caller's own row is never returned.
 */
export const partnerLocationShareSchema = z.object({
  mode: locationShareModeSchema,
  latitude: z.number(),
  longitude: z.number(),
  accuracyMeters: z.number().nullable(),
  reportedAt: z.string(),
  destination: locationShareDestinationSchema.nullable(),
});

export type PartnerLocationShare = z.infer<typeof partnerLocationShareSchema>;

export const currentLocationResponseSchema = z.object({
  /** Null whenever nothing qualifies (no consent on either side, no row,
   *  stale row, consumed grant) — a calm 200, never an error. */
  location: partnerLocationShareSchema.nullable(),
  /** Consent flags for the consent screen (both members may see these —
   *  mutuality is the feature). Positions are never derived from them. */
  youConsented: z.boolean(),
  partnerConsented: z.boolean(),
});

export type CurrentLocationResponse = z.infer<typeof currentLocationResponseSchema>;

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
