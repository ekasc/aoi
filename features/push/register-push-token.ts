import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { isExpoPushToken, type PushTokenPlatform } from '@aoi/shared';

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
 */
export async function registerDevicePushToken(): Promise<void> {
  try {
    const permission = await Notifications.requestPermissionsAsync();

    if (!permission.granted) {
      return;
    }

    // Throws on simulators and without a physical-device project — guarded
    // by the surrounding catch.
    const token = await Notifications.getExpoPushTokenAsync();

    if (!isExpoPushToken(token.data)) {
      return;
    }

    await registerPushToken(token.data, currentPlatform());
  } catch {
    // Deliberately silent (tender-error policy).
  }
}
