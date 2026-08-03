import { describe, it, expect } from 'vitest';

import {
  canRequestLocation,
  canShareLocation,
  formatShareAgeLabel,
  getDistanceMeters,
  getMapRegionForShare,
  hasArrivedAtDestination,
  isPartnerLocationVisible,
  isSharingIndicatorVisible,
  type MapRegion,
} from '@/features/location/location-state';
import type {
  LocationShareDestination,
  PartnerLocationShare,
} from '@/features/location/types';

const NOW = Date.parse('2026-08-03T12:00:00Z');

function makeShare(
  overrides: Partial<PartnerLocationShare> = {}
): PartnerLocationShare {
  return {
    mode: 'live',
    latitude: 35.65858,
    longitude: 139.74543,
    accuracyMeters: 18,
    reportedAt: new Date(NOW).toISOString(),
    destination: null,
    ...overrides,
  };
}

function makeDestination(
  overrides: Partial<LocationShareDestination> = {}
): LocationShareDestination {
  return {
    name: 'Home',
    latitude: 35.65858,
    longitude: 139.74543,
    radiusMeters: 200,
    ...overrides,
  };
}

describe('canShareLocation (both-consent gate)', () => {
  it('allows sharing only when both partners opted in', () => {
    expect(canShareLocation(true, true)).toBe(true);
  });

  it('blocks sharing when either side has not opted in', () => {
    expect(canShareLocation(true, false)).toBe(false);
    expect(canShareLocation(false, true)).toBe(false);
    expect(canShareLocation(false, false)).toBe(false);
  });
});

describe('canRequestLocation (mutuality)', () => {
  it('allows asking only when you opted in yourself', () => {
    expect(canRequestLocation(true)).toBe(true);
    expect(canRequestLocation(false)).toBe(false);
  });
});

describe('isPartnerLocationVisible (client freshness)', () => {
  it('hides when there is no share at all', () => {
    expect(isPartnerLocationVisible(null, NOW)).toBe(false);
  });

  it('hides when reportedAt cannot be parsed', () => {
    expect(
      isPartnerLocationVisible(makeShare({ reportedAt: 'not-a-date' }), NOW)
    ).toBe(false);
  });

  it('shows a fresh live share inside the 15-minute window', () => {
    const reportedAt = new Date(NOW - 14 * 60_000).toISOString();
    expect(isPartnerLocationVisible(makeShare({ reportedAt }), NOW)).toBe(true);
  });

  it('hides a live share once it ages past 15 minutes', () => {
    const reportedAt = new Date(NOW - 15 * 60_000).toISOString();
    expect(isPartnerLocationVisible(makeShare({ reportedAt }), NOW)).toBe(false);
  });

  it('shows an until_arrive share inside the 15-minute window', () => {
    const reportedAt = new Date(NOW - 10 * 60_000).toISOString();
    expect(
      isPartnerLocationVisible(makeShare({ mode: 'until_arrive', reportedAt }), NOW)
    ).toBe(true);
  });

  it('shows a grant only inside its tighter 5-minute window', () => {
    const fresh = new Date(NOW - 4 * 60_000).toISOString();
    const stale = new Date(NOW - 5 * 60_000).toISOString();
    expect(
      isPartnerLocationVisible(
        makeShare({ mode: 'on_request_granted', reportedAt: fresh }),
        NOW
      )
    ).toBe(true);
    expect(
      isPartnerLocationVisible(
        makeShare({ mode: 'on_request_granted', reportedAt: stale }),
        NOW
      )
    ).toBe(false);
  });

  it('tolerates small clock skew but not future reports beyond it', () => {
    const slightSkew = new Date(NOW + 30_000).toISOString();
    const farFuture = new Date(NOW + 5 * 60_000).toISOString();
    expect(isPartnerLocationVisible(makeShare({ reportedAt: slightSkew }), NOW)).toBe(true);
    expect(isPartnerLocationVisible(makeShare({ reportedAt: farFuture }), NOW)).toBe(false);
  });
});

describe('isSharingIndicatorVisible', () => {
  it('is visible exactly while actively sharing', () => {
    expect(isSharingIndicatorVisible('live')).toBe(true);
    expect(isSharingIndicatorVisible('until_arrive')).toBe(true);
    expect(isSharingIndicatorVisible(null)).toBe(false);
  });
});

describe('getDistanceMeters / hasArrivedAtDestination', () => {
  it('measures zero distance at the same point', () => {
    expect(getDistanceMeters(35.65858, 139.74543, 35.65858, 139.74543)).toBe(0);
  });

  it('measures roughly one degree of latitude as ~111 km', () => {
    const distance = getDistanceMeters(0, 0, 1, 0);
    expect(distance).toBeGreaterThan(110_000);
    expect(distance).toBeLessThan(112_000);
  });

  it('reports arrival inside the destination radius', () => {
    const destination = makeDestination({ radiusMeters: 200 });
    expect(
      hasArrivedAtDestination(
        destination.latitude,
        destination.longitude,
        destination
      )
    ).toBe(true);
  });

  it('does not report arrival outside the destination radius', () => {
    const destination = makeDestination({ radiusMeters: 200 });
    // ~550 m north of the destination.
    expect(
      hasArrivedAtDestination(destination.latitude + 0.005, destination.longitude, destination)
    ).toBe(false);
  });
});

describe('formatShareAgeLabel', () => {
  it('says "Just now" for brand-new shares', () => {
    expect(formatShareAgeLabel(new Date(NOW).toISOString(), NOW)).toBe('Just now');
  });

  it('says "Just now" for unparsable or future timestamps', () => {
    expect(formatShareAgeLabel('garbage', NOW)).toBe('Just now');
    expect(formatShareAgeLabel(new Date(NOW + 60_000).toISOString(), NOW)).toBe('Just now');
  });

  it('counts whole minutes calmly', () => {
    expect(formatShareAgeLabel(new Date(NOW - 60_000).toISOString(), NOW)).toBe('1 min ago');
    expect(formatShareAgeLabel(new Date(NOW - 7 * 60_000).toISOString(), NOW)).toBe('7 min ago');
  });
});

describe('getMapRegionForShare', () => {
  it('frames the partner position when there is no destination', () => {
    const region: MapRegion = getMapRegionForShare(makeShare());
    expect(region.latitude).toBe(35.65858);
    expect(region.longitude).toBe(139.74543);
    expect(region.latitudeDelta).toBeGreaterThan(0);
    expect(region.longitudeDelta).toBeGreaterThan(0);
  });

  it('frames the destination when the share carries one', () => {
    const destination = makeDestination({
      name: 'The station',
      latitude: 35.7,
      longitude: 139.8,
    });
    const region = getMapRegionForShare(makeShare({ destination }));
    expect(region.latitude).toBe(35.7);
    expect(region.longitude).toBe(139.8);
  });
});
