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
