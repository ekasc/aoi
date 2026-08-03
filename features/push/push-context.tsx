import * as Notifications from 'expo-notifications';
import { parsePushNotificationData } from '@aoi/shared';
import { useEffect, type PropsWithChildren } from 'react';

import { isStubMode } from '@/features/api-client';
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
 * - Listens for received pushes and routes them: `squeeze` lights up the
 *   real overlay through the squeeze context; `moment_*` gently refreshes
 *   the timeline so partner changes appear without waiting for app focus.
 *
 * The foreground handler (banner visible, never sound) is set globally in
 * `app/_layout.tsx`. Stub mode is a complete no-op — the simulated squeeze
 * loop stays intact for offline dev.
 */
export function PushProvider({ children }: PropsWithChildren) {
  const { receiveSqueeze } = useSqueeze();
  const { refresh } = useMoments();

  useEffect(() => {
    if (isStubMode() || registeredThisSession) {
      return;
    }

    registeredThisSession = true;
    void registerDevicePushToken();
  }, []);

  useEffect(() => {
    if (isStubMode()) {
      return;
    }

    const subscription = Notifications.addNotificationReceivedListener(
      (notification) => {
        const data = parsePushNotificationData(notification.request.content.data);

        if (!data) {
          return; // Unknown kinds are never acted on.
        }

        if (data.kind === 'squeeze') {
          receiveSqueeze();
          return;
        }

        // moment_added | moment_edited | moment_deleted — pick up the
        // partner's change quietly.
        void refresh();
      }
    );

    return () => subscription.remove();
  }, [receiveSqueeze, refresh]);

  return <>{children}</>;
}
