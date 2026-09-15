import { Platform } from 'react-native';

export const PLUS_ENTITLEMENT_ID =
  process.env.EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID?.trim() || 'plus';

function readKey(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Fail-closed platform key selection (P0B):
 * - iOS uses ONLY the iOS public SDK key.
 * - Android uses ONLY the Android public SDK key.
 * - Web (and any other platform) has no store → null.
 * Never substitutes the other platform's key. Missing/invalid → null.
 */
export function getRevenueCatApiKey(platformOverride?: string): string | null {
  const platform = platformOverride ?? Platform.OS;
  const iosKey = readKey(process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY);
  const androidKey = readKey(process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY);
  if (platform === 'android') {
    return androidKey;
  }
  if (platform === 'ios') {
    return iosKey;
  }
  return null;
}

export function isPaywallEnabled(): boolean {
  return getRevenueCatApiKey() !== null;
}
