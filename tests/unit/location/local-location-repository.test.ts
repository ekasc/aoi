import { describe, it, expect, beforeEach } from 'vitest';

import {
  createLocalLocationRepository,
  STUB_PARTNER_LOCATION,
  STUB_PARTNER_PLACE_NAME,
} from '@/features/location/local-location-repository';
import type { LocationRepository } from '@/features/location/types';

const BASE_NOW = Date.parse('2026-08-03T12:00:00Z');

let nowMs = BASE_NOW;

function advance(ms: number): void {
  nowMs += ms;
}

function makeRepository(userId: string): LocationRepository {
  return createLocalLocationRepository(userId, () => new Date(nowMs));
}

beforeEach(() => {
  nowMs = BASE_NOW;
  globalThis.__mockAsyncStorage.clear();
});

describe('local location repository (simulated partner, stub mode)', () => {
  it('starts completely quiet — no consent, no partner location', async () => {
    const repository = makeRepository('user-1');
    const snapshot = await repository.getState();

    expect(snapshot).toEqual({
      youConsented: false,
      partnerConsented: false,
      partnerLocation: null,
    });
  });

  it('opting in marks you consented; the simulated partner follows a couple of seconds later', async () => {
    const repository = makeRepository('user-1');

    const immediately = await repository.setConsent(true);
    expect(immediately.youConsented).toBe(true);
    expect(immediately.partnerConsented).toBe(false);

    advance(2_000);
    expect((await repository.getState()).partnerConsented).toBe(false);

    advance(600); // 2.6 s total — past the simulated consent delay.
    const settled = await repository.getState();
    expect(settled.youConsented).toBe(true);
    expect(settled.partnerConsented).toBe(true);
  });

  it('the simulated partner never consents before you do', async () => {
    const repository = makeRepository('user-1');
    advance(60_000);
    const snapshot = await repository.getState();
    expect(snapshot.youConsented).toBe(false);
    expect(snapshot.partnerConsented).toBe(false);
  });

  it('opting out resets the whole simulation in one tap', async () => {
    const repository = makeRepository('user-1');
    await repository.setConsent(true);
    advance(5_000);
    expect((await repository.getState()).partnerConsented).toBe(true);

    await repository.setConsent(false);
    advance(60_000);

    expect(await repository.getState()).toEqual({
      youConsented: false,
      partnerConsented: false,
      partnerLocation: null,
    });
  });

  it('ignores requests until both have consented', async () => {
    const repository = makeRepository('user-1');
    await repository.setConsent(true);
    await repository.request(); // Partner has not consented yet — quietly ignored.
    advance(10_000);

    const snapshot = await repository.getState();
    expect(snapshot.partnerLocation).toBeNull();
  });

  it('a request is answered with the fixed simulated position after the grant delay', async () => {
    const repository = makeRepository('user-1');
    await repository.setConsent(true);
    advance(3_000); // Partner consents.

    await repository.request();

    advance(2_900); // Not yet.
    expect((await repository.getState()).partnerLocation).toBeNull();

    advance(200); // 3.1 s past the request — the grant lands.
    const snapshot = await repository.getState();
    expect(snapshot.partnerLocation).not.toBeNull();
    expect(snapshot.partnerLocation).toEqual({
      mode: 'on_request_granted',
      latitude: STUB_PARTNER_LOCATION.latitude,
      longitude: STUB_PARTNER_LOCATION.longitude,
      accuracyMeters: STUB_PARTNER_LOCATION.accuracyMeters,
      reportedAt: expect.any(String),
      destination: null,
    });
  });

  it('the simulated grant ages out after the 5-minute grant window', async () => {
    const repository = makeRepository('user-1');
    await repository.setConsent(true);
    advance(3_000);
    await repository.request();
    advance(3_000);
    expect((await repository.getState()).partnerLocation).not.toBeNull();

    advance(5 * 60_000); // The one-time share passes quietly.
    expect((await repository.getState()).partnerLocation).toBeNull();
  });

  it('share and stop are silent no-ops in stub mode', async () => {
    const repository = makeRepository('user-1');
    await expect(
      repository.share({
        mode: 'live',
        latitude: STUB_PARTNER_LOCATION.latitude,
        longitude: STUB_PARTNER_LOCATION.longitude,
      })
    ).resolves.toBeUndefined();
    await expect(repository.stop()).resolves.toBeUndefined();
  });

  it('keeps each user’s simulation separate', async () => {
    const first = makeRepository('user-1');
    const second = makeRepository('user-2');

    await first.setConsent(true);
    advance(5_000);

    expect((await first.getState()).youConsented).toBe(true);
    expect((await second.getState()).youConsented).toBe(false);
  });

  it('recovers calmly from corrupted stored state', async () => {
    await globalThis.__mockAsyncStorage.setItem(
      'aoi.location.v1.user-1',
      'not-json'
    );
    const repository = makeRepository('user-1');
    const snapshot = await repository.getState();
    expect(snapshot.youConsented).toBe(false);
    expect(snapshot.partnerConsented).toBe(false);
    expect(snapshot.partnerLocation).toBeNull();
  });

  it('documents the simulated place name as plainly not real', () => {
    expect(STUB_PARTNER_PLACE_NAME.length).toBeGreaterThan(0);
    expect(STUB_PARTNER_LOCATION.latitude).toBeGreaterThanOrEqual(-90);
    expect(STUB_PARTNER_LOCATION.latitude).toBeLessThanOrEqual(90);
    expect(STUB_PARTNER_LOCATION.longitude).toBeGreaterThanOrEqual(-180);
    expect(STUB_PARTNER_LOCATION.longitude).toBeLessThanOrEqual(180);
  });
});
