const STUB_MODE_FLAG = process.env.EXPO_PUBLIC_AUTH_STUB_MODE;
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const GOOGLE_ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;
const APPLE_ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_APPLE_ANDROID_CLIENT_ID;

export function isAuthStubMode() {
  if (STUB_MODE_FLAG == null) {
    return true;
  }

  return STUB_MODE_FLAG !== 'false';
}

export function getAuthApiBaseUrl() {
  const baseUrl = process.env.EXPO_PUBLIC_AUTH_API_BASE_URL?.trim();

  if (!baseUrl && !isAuthStubMode()) {
    throw new Error(
      'EXPO_PUBLIC_AUTH_API_BASE_URL is required when EXPO_PUBLIC_AUTH_STUB_MODE=false.'
    );
  }

  return baseUrl ?? '';
}

export function getGoogleClientId(platform: 'ios' | 'android') {
  const clientId =
    platform === 'ios' ? GOOGLE_IOS_CLIENT_ID?.trim() : GOOGLE_ANDROID_CLIENT_ID?.trim();

  if (!clientId && !isAuthStubMode()) {
    throw new Error(
      `Google OAuth client id missing for ${platform}. Set EXPO_PUBLIC_GOOGLE_${platform.toUpperCase()}_CLIENT_ID.`
    );
  }

  return clientId ?? '';
}

export function getAppleAndroidClientId() {
  const clientId = APPLE_ANDROID_CLIENT_ID?.trim();

  if (!clientId && !isAuthStubMode()) {
    throw new Error(
      'EXPO_PUBLIC_APPLE_ANDROID_CLIENT_ID is required when EXPO_PUBLIC_AUTH_STUB_MODE=false.'
    );
  }

  return clientId ?? '';
}
