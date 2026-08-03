import type {
  LocationShareDestination,
  LocationShareMode,
  PartnerLocationShare,
} from '@aoi/shared';

export type { LocationShareDestination, LocationShareMode, PartnerLocationShare };

/**
 * Modes the USER can choose to share with. `on_request_granted` is never a
 * standing choice — it is the one-time answer to a partner's request.
 */
export type UserShareMode = 'live' | 'until_arrive';

export type LocationConsentState = {
  youConsented: boolean;
  partnerConsented: boolean;
};

export type LocationStateSnapshot = LocationConsentState & {
  /** The partner's current share when one qualifies; null otherwise. */
  partnerLocation: PartnerLocationShare | null;
};

export type ShareLocationInput = {
  mode: LocationShareMode;
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  destination?: LocationShareDestination;
};

export type LocationRepository = {
  /** Consent flags + the partner's share when one qualifies. */
  getState: () => Promise<LocationStateSnapshot>;
  setConsent: (consented: boolean) => Promise<LocationConsentState>;
  share: (input: ShareLocationInput) => Promise<void>;
  stop: () => Promise<void>;
  request: () => Promise<void>;
};

export type LocationContextValue = {
  /** True once the first state load has settled. */
  isLoaded: boolean;
  youConsented: boolean;
  partnerConsented: boolean;
  /** Both opted in — only then may anything flow. */
  bothConsented: boolean;
  setConsent: (consented: boolean) => Promise<void>;

  /** The mode you are actively sharing in; null = not sharing. */
  sharingMode: UserShareMode | null;
  startSharing: (
    mode: UserShareMode,
    destination?: LocationShareDestination
  ) => Promise<void>;
  stopSharing: () => Promise<void>;

  /** Ask the partner for a one-time share (mutuality-gated). */
  requestPartnerLocation: () => Promise<void>;
  requestSent: boolean;

  /** The partner's current share (already freshness-checked). */
  partnerLocation: PartnerLocationShare | null;
  refreshPartnerLocation: () => Promise<void>;
  /** Called by push routing when the partner stops/revokes. */
  handlePartnerStopped: () => void;

  /** Incoming request approval flow (push-driven). */
  hasPendingRequest: boolean;
  isGranting: boolean;
  receiveRequest: () => void;
  approveRequest: () => Promise<void>;
  dismissRequest: () => void;

  error: string | null;
};
