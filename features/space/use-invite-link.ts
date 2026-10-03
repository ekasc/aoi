import { useEffect, useState } from 'react';
import { Linking } from 'react-native';

import { inviteCodeFromLink } from '@/features/space/invite-code';

/**
 * An invite code that arrived as a link, held until the app can act on it.
 *
 * A shared invite can open the app three ways: cold, into a running app, or
 * while the reader is mid-sign-in. The first is `getInitialUrl`, the second is
 * an event, and the third arrives before the session exists, so none of them
 * can navigate on the spot. Each is read here and parked; the root layout
 * takes it up once there is a signed-in reader to give it to.
 *
 * The last code wins. Someone tapping a second invite means the second one.
 */
export function useInviteLink(): string | null {
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    let live = true;

    const take = (url: string | null) => {
      if (!live) return;
      const found = inviteCodeFromLink(url);
      // The state setter is idempotent, so a cold-start URL and the launch
      // event that repeats it only cause one render.
      if (found) setCode(found);
    };

    // Cold start: the link is what launched the app.
    void Linking.getInitialURL().then(take, () => {});
    // Warm: the app was already open when the link arrived.
    const subscription = Linking.addEventListener('url', (event: { url: string }) =>
      take(event.url),
    );

    return () => {
      live = false;
      subscription.remove();
    };
  }, []);

  return code;
}
