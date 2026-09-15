import * as Notifications from 'expo-notifications';
import { parsePushNotificationData } from '@aoi/shared';
import { useEffect, type PropsWithChildren } from 'react';

import { isStubMode } from '@/features/api-client';
import { useCalendar } from '@/features/calendar/calendar-context';
import { useLetters } from '@/features/letters/letters-context';
import { useMoments } from '@/features/moments/moments-context';
import { useProposals } from '@/features/proposals/proposals-context';
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
 *   the timeline so partner changes appear without waiting for app focus;
 *   `letter_sealed` quietly refreshes the letters shelf; `event_*`
 *   refreshes the calendar (a partner planned / shifted / let go of a plan
 *   — the push never says which); `proposal_*` reloads the suggestions
 *   (and the calendar too when one was accepted, since acceptance creates
 *   a real event).
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
  const { refresh: refreshCalendar } = useCalendar();
  const { reload: reloadProposals } = useProposals();
  const { reload: reloadLetters } = useLetters();

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

      // v1: location sharing is not in the release runtime. Location push
      // kinds are parsed (shared contracts) but intentionally ignored here —
      // they never open location UI or touch location state.
      if (
        data.kind === 'location_request' ||
        data.kind === 'location_granted' ||
        data.kind === 'location_stopped'
      ) {
        return;
      }

      if (data.kind === 'letter_sealed') {
        // They sealed something — the shelf picks it up quietly. The push
        // itself never says what, or when.
        void reloadLetters();
        return;
      }

      if (
        data.kind === 'event_added' ||
        data.kind === 'event_updated' ||
        data.kind === 'event_deleted'
      ) {
        // They planned something / a plan shifted / a plan was let go —
        // re-read the calendar quietly. The push never says which event.
        void refreshCalendar();
        return;
      }

      if (data.kind === 'proposal_received' || data.kind === 'proposal_declined') {
        // A new suggestion, or a gentle pass on one of yours — reload the
        // list quietly.
        void reloadProposals();
        return;
      }

      if (data.kind === 'proposal_accepted') {
        // They said yes — the suggestion became a real event, so both the
        // list and the calendar refresh.
        void reloadProposals();
        void refreshCalendar();
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
    receiveSqueeze,
    refresh,
    refreshCalendar,
    reloadLetters,
    reloadProposals,
  ]);

  return <>{children}</>;
}
