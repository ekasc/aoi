import * as Notifications from 'expo-notifications';
import { parsePushNotificationData } from '@aoi/shared';
import { useEffect, type PropsWithChildren } from 'react';

import { isStubMode } from '@/features/api-client';
import { useLocation } from '@/features/location/location-context';
import { useMoments } from '@/features/moments/moments-context';
import { registerDevicePushToken } from '@/features/push/register-push-token';
import { useSqueeze } from '@/features/squeeze/squeeze-context';

// Once per session is plenty — no re-registration churn on focus/nav.
let registeredThisSession = false;

/**
 * The push backbone on the client:
 *
 * - Registers this device's Expo push token once per session (remote mode,
 *   permission granted, physical device only — simulators no-op silently).
 *   The once-flag is only set after a real success, so a failed attempt
 *   (offline boot, denied permission) is retried on a later mount.
 * - Listens for received pushes and routes them: `squeeze` lights up the
 *   real overlay through the squeeze context; `moment_*` gently refreshes
 *   the timeline so partner changes appear without waiting for app focus.
 *   Pushes received while backgrounded/killed only surface when the user
 *   taps the notification — the response listener routes those too.
 *
 * The foreground handler (banner visible, never sound) is set globally in
 * `app/_layout.tsx`. Stub mode is a complete no-op — the simulated squeeze
 * loop stays intact for offline dev.
 */
export function PushProvider({ children }: PropsWithChildren) {
  const { receiveSqueeze } = useSqueeze();
  const { refresh } = useMoments();
  const {
    receiveRequest,
    refreshPartnerLocation,
    handlePartnerStopped,
  } = useLocation();

  useEffect(() => {
    if (isStubMode() || registeredThisSession) {
      return;
    }

    void registerDevicePushToken()
      .then((registered) => {
        // Only a real success locks out re-registration for the session —
        // a failure (offline boot, simulator, denied permission) leaves the
        // flag false so a later mount/focus can retry.
        registeredThisSession = registered;
      })
      .catch(() => {
        registeredThisSession = false;
      });
  }, []);

  useEffect(() => {
    if (isStubMode()) {
      return;
    }

    const routePushData = (rawData: unknown) => {
      const data = parsePushNotificationData(rawData);

if (!data) {
        return; // Unknown kinds are never acted on.
      }

      if (data.kind === 'squeeze') {
        receiveSqueeze();
        return;
      }

      if (data.kind === 'location_request') {
        // A gentle ask — the approval prompt appears if both opted in.
        receiveRequest();
        return;
      }

      if (data.kind === 'location_granted') {
        // They shared once — quietly fetch the current position.
        void refreshPartnerLocation();
        return;
      }

      if (data.kind === 'location_stopped') {
        // They paused or opted out — clear the pin without ceremony.
        handlePartnerStopped();
        return;
      }

      // moment_added | moment_edited | moment_deleted — pick up the
      // partner's change quietly.
      void refresh();
    };

    // Foreground delivery.
    const receivedSubscription = Notifications.addNotificationReceivedListener(
      (notification) => routePushData(notification.request.content.data)
    );

// The user tapped a notification that arrived while the app was
    // backgrounded/killed — light up the same routing.
    const responseSubscription =
      Notifications.addNotificationResponseReceivedListener((response) =>
        routePushData(response.notification.request.content.data)
      );

    return () => {
      receivedSubscription.remove();
      responseSubscription.remove();
    };
  }, [
    handlePartnerStopped,
    receiveRequest,
    receiveSqueeze,
    refresh,
    refreshPartnerLocation,
  ]);

  return <>{children}</>;
}
