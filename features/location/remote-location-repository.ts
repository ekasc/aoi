import type { CurrentLocationResponse, LocationConsentResponse } from '@aoi/shared';

import { apiFetch } from '@/features/api-client';
import type {
  LocationRepository,
  LocationStateSnapshot,
} from '@/features/location/types';

/**
 * Remote location repository. All privacy gates (both-consent, freshness,
 * one-time consumption) are enforced server-side; this client only ever
 * receives the partner's current share or `null`.
 */
export const remoteLocationRepository: LocationRepository = {
  async getState(): Promise<LocationStateSnapshot> {
    const response = await apiFetch<CurrentLocationResponse>(
      '/v1/spaces/current/location'
    );

    return {
      youConsented: response.youConsented,
      partnerConsented: response.partnerConsented,
      partnerLocation: response.location,
    };
  },

  async setConsent(consented: boolean) {
    return apiFetch<LocationConsentResponse>(
      '/v1/spaces/current/location/consent',
      {
        method: 'POST',
        body: JSON.stringify({ consented }),
      }
    );
  },

  async share(input) {
    await apiFetch('/v1/spaces/current/location/share', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async stop() {
    await apiFetch('/v1/spaces/current/location/share', {
      method: 'DELETE',
    });
  },

  async request() {
    await apiFetch('/v1/spaces/current/location/request', {
      method: 'POST',
      body: '{}',
    });
  },
};
