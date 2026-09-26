import { Platform } from 'react-native';
import { isExpoPushToken, type PushTokenPlatform } from '@aoi/shared';

import { notificationsModule } from '@/features/notifications/notifications-module';
import { registerPushToken } from '@/features/push/push-api';

function currentPlatform(): PushTokenPlatform {
  if (Platform.OS === 'ios') {
    return 'ios';
  }

  if (Platform.OS === 'android') {
    return 'android';
  }

  if (Platform.OS === 'web') {
    return 'web';
  }

  return 'unknown';
}

/**
 * Quietly register this device for push: request permission, fetch the Expo
 * push token, and hand it to the API. Every failure is swallowed —
 * simulators, missing push configuration, denied permission, and offline
 * moments all just mean no pushes, never an error.
 *
 * Returns whether the token was actually registered, so callers can retry
 * after a failure (e.g. an offline boot) instead of giving up for the
 * session.
 */
export async function registerDevicePushToken(): Promise<boolean> {
  // The module itself is the gate: it is null wherever notifications are off,
  // and importing it on Android in Expo Go throws before any of this runs.
  const notifications = notificationsModule();

  if (!notifications) {
    return false;
  }

  try {
    const permission = await notifications.requestPermissionsAsync();

    if (!permission.granted) {
      return false;
    }

    // Throws on simulators and without a physical-device project — guarded
    // by the surrounding catch.
    const token = await notifications.getExpoPushTokenAsync();

    if (!isExpoPushToken(token.data)) {
      return false;
    }

    await registerPushToken(token.data, currentPlatform());
    return true;
  } catch {
    // Deliberately silent (tender-error policy).
    return false;
  }
}
