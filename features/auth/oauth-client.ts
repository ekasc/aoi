import * as AppleAuthentication from 'expo-apple-authentication';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { isAuthStubMode } from './auth-config';
import type {
  AuthApi,
  AuthProvider,
  AuthSessionPayload,
  WorkOSCallbackRequest,
} from './types';

WebBrowser.maybeCompleteAuthSession();

type OAuthErrorCode =
  | 'cancelled'
  | 'invalid_callback'
  | 'network'
  | 'unsupported_platform'
  | 'unknown';

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

function resolvePlatform(): 'ios' | 'android' {
  if (Platform.OS === 'ios') {
    return 'ios';
  }

  if (Platform.OS === 'android') {
    return 'android';
  }

  throw new OAuthClientError(
    'OAuth sign in is supported only on iOS and Android.',
    'unsupported_platform'
  );
}

async function createRedirectUri() {
  if (isAuthStubMode()) {
    return Linking.createURL('/auth/oauth-callback');
  }

  const authSession = await import('expo-auth-session');
  return authSession.makeRedirectUri({
    scheme: 'aoi',
    path: 'auth/oauth-callback',
  });
}

function extractWorkOSCallback(url: string): WorkOSCallbackRequest {
  const parsedUrl = Linking.parse(url);
  const queryParams = parsedUrl.queryParams ?? {};
  const code = getFirstValue(queryParams.code as string | string[] | undefined);

  if (!code) {
    throw new OAuthClientError('Missing OAuth code from WorkOS.', 'invalid_callback');
  }

  return { code };
}

async function openBrowserSession(authorizationUrl: string, redirectUri: string) {
  let result: WebBrowser.WebBrowserAuthSessionResult;

  try {
    result = await WebBrowser.openAuthSessionAsync(authorizationUrl, redirectUri);
  } catch {
    throw new OAuthClientError('Unable to open authentication screen.', 'network');
  }

  if (result.type !== 'success') {
    throw new OAuthClientError('Sign in was canceled.', 'cancelled');
  }

  return extractWorkOSCallback(result.url);
}

async function signInWithBrowser(
  provider: AuthProvider,
  authApi: AuthApi
): Promise<AuthSessionPayload> {
  const redirectUri = await createRedirectUri();
  const { authorizationUrl } = await authApi.workosAuthorize({ provider, redirectUri });

  if (isAuthStubMode()) {
    return authApi.workosCallback({ code: 'stub_code' });
  }

  const { code } = await openBrowserSession(authorizationUrl, redirectUri);
  return authApi.workosCallback({ code });
}

async function signInWithAppleIOSNative(authApi: AuthApi): Promise<AuthSessionPayload> {
  const nonce = randomString(32);

  if (isAuthStubMode()) {
    return authApi.workosAppleNative({
      idToken: `stub_apple_id_token_${Date.now()}`,
      nonce,
    });
  }

  const isAvailable = await AppleAuthentication.isAvailableAsync();
  if (!isAvailable) {
    throw new OAuthClientError('Apple sign in is unavailable on this device.', 'unknown');
  }

  let credential: AppleAuthentication.AppleAuthenticationCredential;

  try {
    credential = await AppleAuthentication.signInAsync({
      nonce,
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ERR_REQUEST_CANCELED'
    ) {
      throw new OAuthClientError('Sign in was canceled.', 'cancelled');
    }

    throw new OAuthClientError('Unable to complete Apple sign in.', 'unknown');
  }

  const idToken = credential.identityToken?.trim();
  if (!idToken) {
    throw new OAuthClientError('Apple did not return an identity token.', 'invalid_callback');
  }

  const first = credential.fullName?.givenName?.trim();
  const last = credential.fullName?.familyName?.trim();
  const displayName = [first, last].filter(Boolean).join(' ').trim() || undefined;

  return authApi.workosAppleNative({ idToken, nonce, displayName });
}

function randomString(length: number) {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const crypto = globalThis.crypto;

  if (!crypto?.getRandomValues) {
    let fallback = '';
    for (let index = 0; index < length; index += 1) {
      fallback += charset[Math.floor(Math.random() * charset.length)];
    }
    return fallback;
  }

  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);

  let output = '';
  for (const value of bytes) {
    output += charset[value % charset.length];
  }

  return output;
}

export async function signInWithOAuthProvider(
  provider: AuthProvider,
  authApi: AuthApi
): Promise<AuthSessionPayload> {
  const platform = resolvePlatform();

  if (provider === 'apple' && platform === 'ios') {
    return signInWithAppleIOSNative(authApi);
  }

  return signInWithBrowser(provider, authApi);
}
