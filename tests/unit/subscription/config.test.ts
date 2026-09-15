import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { getRevenueCatApiKey, isPaywallEnabled } from '@/features/subscription/config';

const IOS_KEY = 'rc_ios_test_key';
const ANDROID_KEY = 'rc_android_test_key';

let savedIos: string | undefined;
let savedAndroid: string | undefined;

beforeEach(() => {
  savedIos = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
  savedAndroid = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
});

afterEach(() => {
  if (savedIos === undefined) delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
  else process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = savedIos;
  if (savedAndroid === undefined) delete process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
  else process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY = savedAndroid;
});

describe('subscription config (fail-closed platform keys)', () => {
  it('iOS uses only the iOS key and never falls back to Android', () => {
    process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = IOS_KEY;
    process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY = ANDROID_KEY;
    expect(getRevenueCatApiKey('ios')).toBe(IOS_KEY);

    delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
    process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY = ANDROID_KEY;
    expect(getRevenueCatApiKey('ios')).toBeNull();
  });

  it('Android uses only the Android key and never falls back to iOS', () => {
    process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = IOS_KEY;
    process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY = ANDROID_KEY;
    expect(getRevenueCatApiKey('android')).toBe(ANDROID_KEY);

    process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = IOS_KEY;
    delete process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
    expect(getRevenueCatApiKey('android')).toBeNull();
  });

  it('web has no store even when keys are present', () => {
    process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = IOS_KEY;
    process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY = ANDROID_KEY;
    expect(getRevenueCatApiKey('web')).toBeNull();
  });

  it('missing/blank config is unavailable, not development', () => {
    delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
    delete process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
    expect(getRevenueCatApiKey('ios')).toBeNull();
    expect(getRevenueCatApiKey('android')).toBeNull();

    process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = '   ';
    expect(getRevenueCatApiKey('ios')).toBeNull();
  });

  it('isPaywallEnabled reflects the current platform key', () => {
    // Test env Platform.OS is ios (tests/setup.ts mock).
    process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = IOS_KEY;
    expect(isPaywallEnabled()).toBe(true);

    delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
    delete process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
    expect(isPaywallEnabled()).toBe(false);
  });
});
