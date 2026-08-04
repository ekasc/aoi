import AsyncStorage from '@react-native-async-storage/async-storage';
import { LOCATION_GRANT_FRESHNESS_MINUTES } from '@aoi/shared';

import type {
  LocationConsentState,
  LocationRepository,
  LocationStateSnapshot,
} from '@/features/location/types';

const STORAGE_KEY_PREFIX = 'aoi.location.v1.';

/**
 * SIMULATED PARTNER — stub mode only.
 *
 * Stub mode is one device, so the "partner" here is a simulation, plainly
 * documented as such:
 * - When you opt in, the simulated partner consents a couple of seconds
 *   later (`partnerConsentsAt`).
 * - When you ask where they are, the simulated partner grants a one-time
 *   position a few seconds later (`partnerGrantsAt`) — a FIXED location near
 *   a plausible place, shown for the grant freshness window and then gone.
 * Nothing is ever sent anywhere; remote mode talks to the real API instead.
 */

export const STUB_PARTNER_PLACE_NAME = 'The coffee shop by the station';

export const STUB_PARTNER_LOCATION = {
  latitude: 35.65858,
  longitude: 139.74543,
  accuracyMeters: 18,
} as const;

const SIMULATED_PARTNER_CONSENT_DELAY_MS = 2_500;
const SIMULATED_PARTNER_GRANT_DELAY_MS = 3_000;

type StoredLocationState = {
  youConsented: boolean;
  /** When the simulated partner consents (ISO); null = not scheduled. */
  partnerConsentsAt: string | null;
  /** When the simulated partner grants a request (ISO); null = none. */
  partnerGrantsAt: string | null;
};

const EMPTY_STATE: StoredLocationState = {
  youConsented: false,
  partnerConsentsAt: null,
  partnerGrantsAt: null,
};

function storageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}`;
}

async function readState(key: string): Promise<StoredLocationState> {
  const rawValue = await AsyncStorage.getItem(key);

  if (!rawValue) {
    return EMPTY_STATE;
  }

  try {
    const parsed: unknown = JSON.parse(rawValue);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return EMPTY_STATE;
    }

    const candidate = parsed as Partial<StoredLocationState>;

    return {
      youConsented: candidate.youConsented === true,
      partnerConsentsAt:
        typeof candidate.partnerConsentsAt === 'string'
          ? candidate.partnerConsentsAt
          : null,
      partnerGrantsAt:
        typeof candidate.partnerGrantsAt === 'string'
          ? candidate.partnerGrantsAt
          : null,
    };
  } catch {
    return EMPTY_STATE;
  }
}

function isReached(timestamp: string | null, nowMs: number): boolean {
  if (!timestamp) {
    return false;
  }

  const atMs = Date.parse(timestamp);
  return !Number.isNaN(atMs) && nowMs >= atMs;
}

export function createLocalLocationRepository(
  userId: string,
  getNow: () => Date = () => new Date()
): LocationRepository {
  const key = storageKey(userId);

  async function getConsent(
    stored: StoredLocationState,
    nowMs: number
  ): Promise<LocationConsentState> {
    return {
      youConsented: stored.youConsented,
      partnerConsented:
        stored.youConsented && isReached(stored.partnerConsentsAt, nowMs),
    };
  }

  return {
    async getState(): Promise<LocationStateSnapshot> {
      const nowMs = getNow().getTime();
      const stored = await readState(key);
      const consent = await getConsent(stored, nowMs);

      let partnerLocation: LocationStateSnapshot['partnerLocation'] = null;

      // The simulated grant behaves like a one-time grant: visible only
      // inside the grant freshness window after it lands.
      const grantedAtMs = stored.partnerGrantsAt
        ? Date.parse(stored.partnerGrantsAt)
        : Number.NaN;

      if (
        consent.youConsented &&
        consent.partnerConsented &&
        !Number.isNaN(grantedAtMs) &&
        nowMs >= grantedAtMs &&
        nowMs - grantedAtMs < LOCATION_GRANT_FRESHNESS_MINUTES * 60_000
      ) {
        partnerLocation = {
          mode: 'on_request_granted',
          latitude: STUB_PARTNER_LOCATION.latitude,
          longitude: STUB_PARTNER_LOCATION.longitude,
          accuracyMeters: STUB_PARTNER_LOCATION.accuracyMeters,
          reportedAt: new Date(grantedAtMs).toISOString(),
          destination: null,
        };
      }

      return { ...consent, partnerLocation };
    },

    async setConsent(consented: boolean): Promise<LocationConsentState> {
      const nowMs = getNow().getTime();
      const stored = await readState(key);

      const next: StoredLocationState = consented
        ? {
            youConsented: true,
            // The simulated partner opts in shortly after you do.
            partnerConsentsAt: new Date(
              nowMs + SIMULATED_PARTNER_CONSENT_DELAY_MS
            ).toISOString(),
            partnerGrantsAt: stored.partnerGrantsAt,
          }
        : { ...EMPTY_STATE }; // Opting out resets the whole simulation.

      await AsyncStorage.setItem(key, JSON.stringify(next));

      return getConsent(next, nowMs);
    },

    async share(): Promise<void> {
      // Stub mode never touches real GPS or the network: your own reports
      // are simply absorbed. (The simulated partner only ever answers
      // one-time requests — see the module note.)
    },

    async stop(): Promise<void> {
      // Nothing is stored about your position in stub mode.
    },

    async request(): Promise<void> {
      const nowMs = getNow().getTime();
      const stored = await readState(key);
      const consent = await getConsent(stored, nowMs);

      if (!consent.youConsented || !consent.partnerConsented) {
        return;
      }

      // The simulated partner grants a fixed position a little later.
      const next: StoredLocationState = {
        ...stored,
        partnerGrantsAt: new Date(
          nowMs + SIMULATED_PARTNER_GRANT_DELAY_MS
        ).toISOString(),
      };

      await AsyncStorage.setItem(key, JSON.stringify(next));
    },
  };
}
