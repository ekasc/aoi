const STUB_MODE_FLAG = process.env.EXPO_PUBLIC_AUTH_STUB_MODE;

// Fail fast: auth mode must be an explicit choice, never an accidental default.
if (STUB_MODE_FLAG == null) {
  throw new Error(
    'EXPO_PUBLIC_AUTH_STUB_MODE is required. Set "true" for mock auth or "false" for the real API.'
  );
}

export function isAuthStubMode() {
  return STUB_MODE_FLAG === 'true';
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

/**
 * Google OAuth web client id for the idToken flow.
 *
 * Verified against the installed better-auth@1.6.26 source
 * (`@better-auth/core/dist/social-providers/google.mjs`): the server verifies
 * the idToken with `audience: options.clientId` (jose `aud` check), so the
 * client must present a token whose audience equals the server's
 * `GOOGLE_CLIENT_ID` — i.e. the same web client id. (Platform-specific
 * iOS/Android client ids produce tokens with a different `aud` and would
 * fail verification.) Fail-fast in real mode; stub mode never needs it.
 */
export function getGoogleClientId(): string {
  const clientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID?.trim();

  if (!clientId && !isAuthStubMode()) {
    throw new Error(
      'EXPO_PUBLIC_GOOGLE_CLIENT_ID (web client) is required when EXPO_PUBLIC_AUTH_STUB_MODE=false. It must match the server GOOGLE_CLIENT_ID.'
    );
  }

  return clientId ?? '';
}

/**
 * Google iOS client id for the native sign-in SDK
 * (`@react-native-google-signin/google-signin`). The SDK presents the
 * system account sheet with this client (registered against the app's
 * bundle id); the idToken's `aud` still comes from the web client id passed
 * as `webClientId`. Fail-fast in real mode; stub mode never needs it.
 */
export function getGoogleIosClientId(): string {
  const clientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();

  if (!clientId && !isAuthStubMode()) {
    throw new Error(
      'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID is required when EXPO_PUBLIC_AUTH_STUB_MODE=false.'
    );
  }

  return clientId ?? '';
}
