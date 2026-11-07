import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { notifyIn } from "@/features/dev/device-automation";

/**
 * Development-only notification trigger for end-to-end runs.
 *
 * Every real notification path is unavailable to a test: a resurface is pinned
 * to 09:30/14:30, a calendar reminder needs a signed-in space, and a remote
 * push needs the server. This route is the lever that makes delivery testable
 * on a device, which is the only place the OS half can be proven.
 *
 *   adb shell "am start -a android.intent.action.VIEW \
 *     -d 'aoi://dev-notify?seconds=6&title=notification%20e2e'"
 *
 * It schedules through the app's own `notificationsModule()` gating and then
 * returns to where the reader was, so a test never leaves the app sitting on
 * this screen. Genuinely development-only: production redirects to the root.
 */
export default function DevNotify() {
  const params = useLocalSearchParams<{ seconds?: string; title?: string }>();
  const [scheduled, setScheduled] = useState(false);

  const seconds = Number(params.seconds ?? '');
  const delaySeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 6;
  const title = params.title ?? 'aoi e2e';

  useEffect(() => {
    let live = true;

    void notifyIn(delaySeconds, {
      title,
      body: 'scheduled from the dev-notify route',
    }).finally(() => {
      if (live) setScheduled(true);
    });

    return () => {
      live = false;
    };
  }, [delaySeconds, title]);

  useEffect(() => {
    if (!scheduled) return;
    // Leave the route immediately: the notification is what the test is
    // waiting for, and this screen must not be what the reader lands on.
    router.replace('/');
  }, [scheduled]);

  if (!__DEV__) {
    return <Redirect href="/" />;
  }

  return <View testID="dev-notify" />;
}
