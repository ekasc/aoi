import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { isAuthStubMode } from '@/features/auth/auth-config';
import type {
  AuthApi,
  AuthProvider,
  AuthSessionPayload,
} from '@/features/auth/types';

type OAuthErrorCode = 'cancelled' | 'invalid_callback' | 'network' | 'unknown';

export class OAuthClientError extends Error {
  constructor(
    message: string,
    public readonly code: OAuthErrorCode
  ) {
    super(message);
  }
}

function getFirstValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

export async function signInWithOAuthProvider(
  provider: AuthProvider,
  authApi: AuthApi
): Promise<AuthSessionPayload> {
  const redirectUri = Linking.createURL('/auth/oauth-callback');
  const startResponse = await authApi.oauthStart({ provider, redirectUri });

  if (isAuthStubMode()) {
    return authApi.oauthCallback({
      provider,
      code: `stub_code_${provider}`,
      state: startResponse.state,
      redirectUri,
      codeVerifier: startResponse.codeVerifier,
    });
  }

  let result: WebBrowser.WebBrowserAuthSessionResult;

  try {
    result = await WebBrowser.openAuthSessionAsync(
      startResponse.authorizationUrl,
      redirectUri
    );
  } catch {
    throw new OAuthClientError('Unable to open authentication screen.', 'network');
  }

  if (result.type !== 'success') {
    throw new OAuthClientError('Sign in was canceled.', 'cancelled');
  }

  const parsedUrl = Linking.parse(result.url);
  const queryParams = parsedUrl.queryParams ?? {};
  const code = getFirstValue(queryParams.code as string | string[] | undefined);
  const state = getFirstValue(queryParams.state as string | string[] | undefined);

  if (!code || !state) {
    throw new OAuthClientError('Missing OAuth callback values.', 'invalid_callback');
  }

  return authApi.oauthCallback({
    provider,
    code,
    state,
    redirectUri,
    codeVerifier: startResponse.codeVerifier,
  });
}
