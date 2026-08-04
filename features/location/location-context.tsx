import * as Location from 'expo-location';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';

import { isStubMode } from '@/features/api-client';
import { approvalReducer, IDLE_APPROVAL } from '@/features/location/approval';
import {
  LOCATION_BACKGROUND_TASK,
  setLocationReportCallback,
} from '@/features/location/background-task';
import { createLocalLocationRepository } from '@/features/location/local-location-repository';
import {
  canRequestLocation,
  canShareLocation,
  hasArrivedAtDestination,
} from '@/features/location/location-state';
import { remoteLocationRepository } from '@/features/location/remote-location-repository';
import type {
  LocationContextValue,
  LocationRepository,
  LocationShareDestination,
  PartnerLocationShare,
  UserShareMode,
} from '@/features/location/types';
import { useSession } from '@/features/session/session-context';

const LocationContext = createContext<LocationContextValue | undefined>(
  undefined
);

// Battery care: calm reporting, never continuous high accuracy.
const LIVE_DISTANCE_INTERVAL_METERS = 75;
const LIVE_TIME_INTERVAL_MS = 60_000;
const UNTIL_ARRIVE_DISTANCE_INTERVAL_METERS = 50;
const SENT_PROMPT_LINGER_MS = 5_000;

// Stub mode is one device, so the partner is simulated (see
// local-location-repository). A gentle interval lets the simulation unfold
// without push: ~2s of local reads only, never the network.
const STUB_SIMULATION_POLL_MS = 2_000;

/**
 * Optional, consensual, bounded location sharing — "they'll be home soon",
 * never tracking. Default OFF; both partners opt in; either stops in one
 * tap. Live mode is the ONLY mode that uses background location; grants and
 * Until-I-arrive stay foreground. Stub mode simulates the partner (clearly
 * documented in the local repository) and never touches real GPS.
 */
export function LocationProvider({ children }: PropsWithChildren) {
  const { user } = useSession();
  const userId = user?.id;

  const [isLoaded, setIsLoaded] = useState(false);
  const [youConsented, setYouConsented] = useState(false);
  const [partnerConsented, setPartnerConsented] = useState(false);
  const [partnerLocation, setPartnerLocation] =
    useState<PartnerLocationShare | null>(null);
  const [sharingMode, setSharingMode] = useState<UserShareMode | null>(null);
  const [requestSent, setRequestSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approval, dispatchApproval] = useReducer(approvalReducer, IDLE_APPROVAL);

  const repository = useMemo<LocationRepository | null>(() => {
    if (!userId) {
      return null;
    }

    return isStubMode()
      ? createLocalLocationRepository(userId)
      : remoteLocationRepository;
  }, [userId]);

  // Active until_arrive destination (arrival checks + every report carries it).
  const destinationRef = useRef<LocationShareDestination | null>(null);
  const sharingModeRef = useRef<UserShareMode | null>(null);
  const youConsentedRef = useRef(false);
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const sentResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped on every stop/revoke so an in-flight report can never resurrect
  // a row that was just deleted (it re-issues stop when it lands late).
  const stopEpochRef = useRef(0);
  // Arrival checks only trust fixes taken after tracking started — the
  // first callback can be a stale last-known location ≈ destination.
  const arriveStartedAtRef = useRef(0);
  const approvingRef = useRef(false);

  useEffect(() => {
    sharingModeRef.current = sharingMode;
  }, [sharingMode]);

  useEffect(() => {
    youConsentedRef.current = youConsented;
  }, [youConsented]);

  useEffect(
    () => () => {
      if (sentResetTimer.current) {
        clearTimeout(sentResetTimer.current);
      }
    },
    []
  );

  const applySnapshot = useCallback(
    (snapshot: {
      youConsented: boolean;
      partnerConsented: boolean;
      partnerLocation: PartnerLocationShare | null;
    }) => {
      setYouConsented(snapshot.youConsented);
      setPartnerConsented(snapshot.partnerConsented);
      setPartnerLocation(snapshot.partnerLocation);

      if (snapshot.partnerLocation) {
        // An answered request settles the "asked" state.
        setRequestSent(false);
      }
    },
    []
  );

  const reload = useCallback(async () => {
    if (!repository) {
      return;
    }

    try {
      applySnapshot(await repository.getState());
      setError(null);
    } catch {
      // Tender-error policy: location state that fails to load is silently
      // absorbed — the screen simply shows "off".
    } finally {
      setIsLoaded(true);
    }
  }, [applySnapshot, repository]);

  useEffect(() => {
    if (!repository) {
      setIsLoaded(false);
      setYouConsented(false);
      setPartnerConsented(false);
      setPartnerLocation(null);
      setSharingMode(null);
      return;
    }

    void reload();
  }, [reload, repository]);

  // ── Reporting (remote mode only) ───────────────────────────────────────

  const reportPosition = useCallback(
    async (position: Location.LocationObject) => {
      const mode = sharingModeRef.current;

      if (!repository || isStubMode() || !mode) {
        return;
      }

      const destination = destinationRef.current;
      const epoch = stopEpochRef.current;

      try {
        await repository.share({
          mode,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy ?? undefined,
          ...(destination ? { destination } : {}),
        });

        // A stop/revoke that landed while this report was in flight wins:
        // the upsert may have resurrected the row, so stop it again.
        if (stopEpochRef.current !== epoch) {
          try {
            await repository.stop();
          } catch {
            // Absorbed — the row simply expires on its own.
          }
        }
      } catch {
        // A location that fails to send is silently absorbed.
      }
    },
    [repository]
  );

  const stopTrackers = useCallback(async () => {
    setLocationReportCallback(null);

    if (watchRef.current) {
      watchRef.current.remove();
      watchRef.current = null;
    }

    try {
      if (await Location.hasStartedLocationUpdatesAsync(LOCATION_BACKGROUND_TASK)) {
        await Location.stopLocationUpdatesAsync(LOCATION_BACKGROUND_TASK);
      }
    } catch {
      // Stopping what is already stopped is still stopping.
    }
  }, []);

  const stopSharing = useCallback(async () => {
    stopEpochRef.current += 1;
    const wasSharing = sharingModeRef.current !== null;

    destinationRef.current = null;
    setSharingMode(null);
    await stopTrackers();

    if (wasSharing && repository) {
      try {
        await repository.stop();
      } catch {
        // Tender-error policy: the row simply expires on its own.
      }
    }
  }, [repository, stopTrackers]);

  const startSharing = useCallback(
    async (mode: UserShareMode, destination?: LocationShareDestination) => {
      if (!repository || !canShareLocation(youConsented, partnerConsented)) {
        return;
      }

      if (mode === 'until_arrive' && !destination) {
        return;
      }

      destinationRef.current = mode === 'until_arrive' ? destination ?? null : null;

      if (isStubMode()) {
        // Simulated: stub mode never touches real GPS or the network.
        setSharingMode(mode);
        return;
      }

      try {
        const foreground = await Location.requestForegroundPermissionsAsync();

        if (!foreground.granted) {
          setError('Location access is needed while sharing is on.');
          return;
        }

        setSharingMode(mode);
        sharingModeRef.current = mode;

        if (mode === 'live') {
          // "Always" permission is asked ONLY here, for Live — and the
          // person can decline: Live then simply runs while the app is open.
          let backgroundGranted = false;

          try {
            if (await Location.isBackgroundLocationAvailableAsync()) {
              const background =
                await Location.requestBackgroundPermissionsAsync();
              backgroundGranted = background.granted;
            }
          } catch {
            backgroundGranted = false;
          }

          if (backgroundGranted) {
            setLocationReportCallback((location) => {
              void reportPosition(location);
            });

            await Location.startLocationUpdatesAsync(
              LOCATION_BACKGROUND_TASK,
              {
                accuracy: Location.Accuracy.Balanced,
                distanceInterval: LIVE_DISTANCE_INTERVAL_METERS,
                timeInterval: LIVE_TIME_INTERVAL_MS,
              }
            );
          } else {
            // Declined background — calm foreground fallback.
            watchRef.current = await Location.watchPositionAsync(
              {
                accuracy: Location.Accuracy.Balanced,
                distanceInterval: LIVE_DISTANCE_INTERVAL_METERS,
                timeInterval: LIVE_TIME_INTERVAL_MS,
              },
              (position) => {
                void reportPosition(position);
              }
            );
          }
        } else {
          // Until I arrive: foreground watching, auto-stop on arrival.
          const arrivalDestination = destination;
          arriveStartedAtRef.current = Date.now();

          watchRef.current = await Location.watchPositionAsync(
            {
              accuracy: Location.Accuracy.Balanced,
              distanceInterval: UNTIL_ARRIVE_DISTANCE_INTERVAL_METERS,
            },
            (position) => {
              void reportPosition(position);

              // The first callback can be a stale last-known fix ≈ the
              // destination — only fixes taken after tracking started may
              // declare arrival.
              const isFreshFix =
                typeof position.timestamp === 'number' &&
                position.timestamp >= arriveStartedAtRef.current;

              if (
                arrivalDestination &&
                isFreshFix &&
                hasArrivedAtDestination(
                  position.coords.latitude,
                  position.coords.longitude,
                  arrivalDestination
                )
              ) {
                void stopSharing();
              }
            }
          );
        }

        // One immediate report so the partner sees something right away.
        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        await reportPosition(current);
      } catch {
        // Tender-error policy: a share that cannot start quietly doesn't.
        await stopTrackers();
        setSharingMode(null);
        sharingModeRef.current = null;
      }
    },
    [partnerConsented, reportPosition, repository, stopSharing, stopTrackers, youConsented]
  );

  // Unmount: stop everything (the server row expires on its own).
  useEffect(
    () => () => {
      void stopTrackers();
    },
    [stopTrackers]
  );

  // ── Consent ────────────────────────────────────────────────────────────

  const setConsent = useCallback(
    async (consented: boolean) => {
      if (!repository) {
        return;
      }

      try {
        if (!consented) {
          // Stopping consent also stops any active sharing — one tap.
          stopEpochRef.current += 1;
          destinationRef.current = null;
          setSharingMode(null);
          await stopTrackers();
        }

        const next = await repository.setConsent(consented);
        setYouConsented(next.youConsented);
        setPartnerConsented(next.partnerConsented);
        setError(null);

        if (!consented) {
          setPartnerLocation(null);
        } else {
          void reload();
        }
      } catch {
        setError('Your choice could not be saved right now.');
      }
    },
    [reload, repository, stopTrackers]
  );

  // ── Requests (asking + approving) ──────────────────────────────────────

  const requestPartnerLocation = useCallback(async () => {
    if (!repository || !canRequestLocation(youConsented)) {
      return;
    }

    try {
      await repository.request();
      setRequestSent(true);
    } catch {
      // Tender-error policy: an ask that fails to send is silently absorbed.
    }
  }, [repository, youConsented]);

  const receiveRequest = useCallback(() => {
    // You can only be asked when you opted in — mutuality, enforced where
    // the request lands as well.
    if (youConsentedRef.current) {
      dispatchApproval({ type: 'request_received' });
    }
  }, []);

  const dismissRequest = useCallback(() => {
    dispatchApproval({ type: 'decline' });
  }, []);

  const approveRequest = useCallback(async () => {
    // A rapid double-tap must not post two grants/pushes: the reducer only
    // guards state, so the side effect is guarded here as well.
    if (!repository || approvingRef.current) {
      return;
    }

    approvingRef.current = true;
    dispatchApproval({ type: 'approve' });

    try {
      if (!isStubMode()) {
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        await repository.share({
          mode: 'on_request_granted',
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy ?? undefined,
        });
      }
      // Stub mode: there is no real requester to send to — the grant is a
      // no-op and the flow simply settles.

      dispatchApproval({ type: 'granted' });

      if (sentResetTimer.current) {
        clearTimeout(sentResetTimer.current);
      }

      sentResetTimer.current = setTimeout(() => {
        dispatchApproval({ type: 'reset' });
      }, SENT_PROMPT_LINGER_MS);
    } catch {
      // A location that fails to send is silently absorbed — the prompt
      // simply goes away, never an error surface.
      dispatchApproval({ type: 'decline' });
    } finally {
      approvingRef.current = false;
    }
  }, [repository]);

  const refreshPartnerLocation = useCallback(async () => {
    await reload();
  }, [reload]);

  const handlePartnerStopped = useCallback(() => {
    setPartnerLocation(null);
  }, []);

  // ── Stub simulation: let the pretend partner unfold ────────────────────

  const stubWaiting =
    isStubMode() &&
    youConsented &&
    (!partnerConsented || requestSent || approval.status !== 'idle');

  useEffect(() => {
    if (!stubWaiting || !repository) {
      return;
    }

    const timer = setInterval(() => {
      void reload();
    }, STUB_SIMULATION_POLL_MS);

    return () => clearInterval(timer);
  }, [reload, repository, stubWaiting]);

  const value = useMemo<LocationContextValue>(
    () => ({
      isLoaded,
      youConsented,
      partnerConsented,
      bothConsented: canShareLocation(youConsented, partnerConsented),
      setConsent,
      sharingMode,
      startSharing,
      stopSharing,
      requestPartnerLocation,
      requestSent,
      partnerLocation,
      refreshPartnerLocation,
      handlePartnerStopped,
      hasPendingRequest: approval.status === 'pending',
      isGranting: approval.status === 'granting',
      receiveRequest,
      approveRequest,
      dismissRequest,
      error,
    }),
    [
      approval.status,
      approveRequest,
      dismissRequest,
      error,
      handlePartnerStopped,
      isLoaded,
      partnerConsented,
      partnerLocation,
      receiveRequest,
      refreshPartnerLocation,
      requestPartnerLocation,
      requestSent,
      setConsent,
      sharingMode,
      startSharing,
      stopSharing,
      youConsented,
    ]
  );

  return (
    <LocationContext.Provider value={value}>
      {children}
    </LocationContext.Provider>
  );
}

export function useLocation(): LocationContextValue {
  const context = useContext(LocationContext);

  if (!context) {
    throw new Error('useLocation must be used within LocationProvider');
  }

  return context;
}
