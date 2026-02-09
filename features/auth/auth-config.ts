const STUB_MODE_FLAG = process.env.EXPO_PUBLIC_AUTH_STUB_MODE;

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
