import { isLocationShareFresh } from '@aoi/shared';

import type {
  LocationShareDestination,
  PartnerLocationShare,
} from '@/features/location/types';

/**
 * Pure, testable rules behind location sharing. Nothing here touches the
 * network or the GPS — the context and repositories compose these.
 */

/** The both-consent gate: nothing flows unless both partners opted in. */
export function canShareLocation(
  youConsented: boolean,
  partnerConsented: boolean
): boolean {
  return youConsented && partnerConsented;
}

/** Mutuality: you can only ask when you also opted in. */
export function canRequestLocation(youConsented: boolean): boolean {
  return youConsented;
}

/**
 * Client-side freshness check — the partner pin hides itself once the share
 * ages out, even between refreshes. Consumption of one-time grants is
 * enforced server-side; the client simply shows what it last received.
 */
export function isPartnerLocationVisible(
  share: PartnerLocationShare | null,
  nowMs: number
): boolean {
  if (!share) {
    return false;
  }

  const reportedAtMs = Date.parse(share.reportedAt);

  if (Number.isNaN(reportedAtMs)) {
    return false;
  }

  return isLocationShareFresh(share.mode, reportedAtMs, nowMs);
}

/**
 * The persistent-but-subtle sharing indicator: visible exactly while you
 * are actively sharing, in any mode. Consent alone is not enough — nobody
 * should see "sharing" when nothing is flowing, and vice versa.
 */
export function isSharingIndicatorVisible(
  sharingMode: string | null
): boolean {
  return sharingMode !== null;
}

// ── Arrival (the "until I arrive" geofence) ──────────────────────────────

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance in meters (haversine). */
export function getDistanceMeters(
  fromLatitude: number,
  fromLongitude: number,
  toLatitude: number,
  toLongitude: number
): number {
  const deltaLat = toRadians(toLatitude - fromLatitude);
  const deltaLng = toRadians(toLongitude - fromLongitude);
  const halfChord =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(fromLatitude)) *
      Math.cos(toRadians(toLatitude)) *
      Math.sin(deltaLng / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(halfChord));
}

/**
 * Arrival rule for `until_arrive`: inside the destination radius means the
 * journey is over and sharing stops itself — quietly, one hop, no drama.
 */
export function hasArrivedAtDestination(
  latitude: number,
  longitude: number,
  destination: LocationShareDestination
): boolean {
  return (
    getDistanceMeters(
      latitude,
      longitude,
      destination.latitude,
      destination.longitude
    ) <= destination.radiusMeters
  );
}

// ── Quiet labels ─────────────────────────────────────────────────────────

/** How long ago a share was reported, in the calmest words possible. */
export function formatShareAgeLabel(
  reportedAtIso: string,
  nowMs: number
): string {
  const reportedAtMs = Date.parse(reportedAtIso);

  if (Number.isNaN(reportedAtMs) || reportedAtMs > nowMs) {
    return 'Just now';
  }

  const minutes = Math.floor((nowMs - reportedAtMs) / 60_000);

  if (minutes < 1) {
    return 'Just now';
  }

  return minutes === 1 ? '1 min ago' : `${minutes} min ago`;
}

// ── Map framing ──────────────────────────────────────────────────────────

export type MapRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

/**
 * Frame a single pin — partner position, or the destination when the share
 * carries one (the destination is where the story is). Nothing else is ever
 * drawn: no trails, no history, no accuracy circles beyond a soft one.
 */
export function getMapRegionForShare(
  share: PartnerLocationShare
): MapRegion {
  const focus = share.destination ?? {
    latitude: share.latitude,
    longitude: share.longitude,
  };

  return {
    latitude: focus.latitude,
    longitude: focus.longitude,
    // ~1.2 km across: close enough to feel like "almost home", wide enough
    // to stay calm.
    latitudeDelta: 0.012,
    longitudeDelta: 0.012,
  };
}
