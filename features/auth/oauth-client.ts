import * as AppleAuthentication from 'expo-apple-authentication';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import {
  getAppleAndroidClientId,
  getGoogleClientId,
  isAuthStubMode,
} from './auth-config';
import type {
  AuthApi,
  AuthProvider,
  OAuthPlatform,
  AuthSessionPayload,
} from './types';

WebBrowser.maybeCompleteAuthSession();

const PKCE_CHARSET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
const NONCE_CHARSET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

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

function resolvePlatform(): OAuthPlatform {
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

function randomString(length: number, charset: string) {
  const crypto = globalThis.crypto;

  if (!crypto?.getRandomValues) {
    if (isAuthStubMode()) {
      let fallback = '';
      for (let index = 0; index < length; index += 1) {
        fallback += charset[Math.floor(Math.random() * charset.length)];
      }
      return fallback;
    }

    throw new OAuthClientError(
      'Secure random generation is unavailable on this device.',
      'unknown'
    );
  }

  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);

  let output = '';
  for (const value of bytes) {
    output += charset[value % charset.length];
  }

  return output;
}

function bytesToBase64Url(bytes: Uint8Array) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let encoded = '';

  for (let index = 0; index < bytes.length; index += 3) {
    const byte1 = bytes[index];
    const byte2 = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const byte3 = index + 2 < bytes.length ? bytes[index + 2] : 0;
    const hasByte2 = index + 1 < bytes.length;
    const hasByte3 = index + 2 < bytes.length;

    const chunk = (byte1 << 16) | (byte2 << 8) | byte3;
    const char1 = alphabet[(chunk >> 18) & 0x3f];
    const char2 = alphabet[(chunk >> 12) & 0x3f];
    const char3 = hasByte2 ? alphabet[(chunk >> 6) & 0x3f] : '=';
    const char4 = hasByte3 ? alphabet[chunk & 0x3f] : '=';

    encoded += `${char1}${char2}${char3}${char4}`;
  }

  return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function utf8Encode(value: string) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value);
  }

  const encoded = unescape(encodeURIComponent(value));
  const bytes = new Uint8Array(encoded.length);
  for (let index = 0; index < encoded.length; index += 1) {
    bytes[index] = encoded.charCodeAt(index);
  }
  return bytes;
}

async function createCodeChallenge(codeVerifier: string) {
  const subtle = globalThis.crypto?.subtle;

  if (!subtle) {
    throw new OAuthClientError(
      'Secure hashing is unavailable on this device.',
      'unknown'
    );
  }

  const digest = await subtle.digest('SHA-256', utf8Encode(codeVerifier));
  return bytesToBase64Url(new Uint8Array(digest));
}

function createNonce() {
  return randomString(32, NONCE_CHARSET);
}

function createRedirectUri() {
  return Linking.createURL('/auth/oauth-callback');
}

function extractOAuthCallback(url: string) {
  const parsedUrl = Linking.parse(url);
  const queryParams = parsedUrl.queryParams ?? {};
  const code = getFirstValue(queryParams.code as string | string[] | undefined);
  const state = getFirstValue(queryParams.state as string | string[] | undefined);

  if (!code || !state) {
    throw new OAuthClientError('Missing OAuth callback values.', 'invalid_callback');
  }

  return { code, state };
}

async function openBrowserOAuthSession(authorizationUrl: string, redirectUri: string) {
  let result: WebBrowser.WebBrowserAuthSessionResult;

  try {
    result = await WebBrowser.openAuthSessionAsync(authorizationUrl, redirectUri);
  } catch {
    throw new OAuthClientError('Unable to open authentication screen.', 'network');
  }

  if (result.type !== 'success') {
    throw new OAuthClientError('Sign in was canceled.', 'cancelled');
  }

  return extractOAuthCallback(result.url);
}

function toDisplayName(credential: AppleAuthentication.AppleAuthenticationCredential) {
  const first = credential.fullName?.givenName?.trim();
  const last = credential.fullName?.familyName?.trim();
  return [first, last].filter(Boolean).join(' ').trim();
}

async function signInWithGoogle(authApi: AuthApi): Promise<AuthSessionPayload> {
  const platform = resolvePlatform();
  const redirectUri = createRedirectUri();
  const isStubMode = isAuthStubMode();
  const codeVerifier = randomString(64, PKCE_CHARSET);
  const codeChallenge = isStubMode
    ? randomString(64, PKCE_CHARSET)
    : await createCodeChallenge(codeVerifier);
  const startResponse = await authApi.oauthStart({
    provider: 'google',
    platform,
    clientId: getGoogleClientId(platform),
    redirectUri,
    codeChallenge,
    codeChallengeMethod: 'S256',
  });

  if (isStubMode) {
    return authApi.oauthCallback({
      provider: 'google',
      platform,
      code: 'stub_code_google',
      state: startResponse.state,
      codeVerifier,
    });
  }

  const { code, state } = await openBrowserOAuthSession(
    startResponse.authorizationUrl,
    redirectUri
  );

  return authApi.oauthCallback({
    provider: 'google',
    platform,
    code,
    state,
    codeVerifier,
  });
}

async function signInWithAppleIOSNative(authApi: AuthApi): Promise<AuthSessionPayload> {
  const nonce = createNonce();

  if (isAuthStubMode()) {
    return authApi.oauthNativeCallback({
      provider: 'apple',
      platform: 'ios',
      idToken: `stub_apple_id_token_${Date.now()}`,
      nonce,
      displayName: 'Apple User',
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

  const displayName = toDisplayName(credential);

  return authApi.oauthNativeCallback({
    provider: 'apple',
    platform: 'ios',
    idToken,
    nonce,
    displayName: displayName || undefined,
  });
}

async function signInWithAppleAndroid(authApi: AuthApi): Promise<AuthSessionPayload> {
  const redirectUri = createRedirectUri();
  const nonce = createNonce();
  const startResponse = await authApi.oauthStart({
    provider: 'apple',
    platform: 'android',
    clientId: getAppleAndroidClientId(),
    redirectUri,
    nonce,
  });

  if (isAuthStubMode()) {
    return authApi.oauthCallback({
      provider: 'apple',
      platform: 'android',
      code: 'stub_code_apple',
      state: startResponse.state,
    });
  }

  const { code, state } = await openBrowserOAuthSession(
    startResponse.authorizationUrl,
    redirectUri
  );

  return authApi.oauthCallback({
    provider: 'apple',
    platform: 'android',
    code,
    state,
  });
}

export async function signInWithOAuthProvider(
  provider: AuthProvider,
  authApi: AuthApi
): Promise<AuthSessionPayload> {
  const platform = resolvePlatform();

  if (provider === 'google') {
    return signInWithGoogle(authApi);
  }

  if (provider === 'apple' && platform === 'ios') {
    return signInWithAppleIOSNative(authApi);
  }

  if (provider === 'apple' && platform === 'android') {
    return signInWithAppleAndroid(authApi);
  }

  throw new OAuthClientError('Unsupported OAuth provider/platform.', 'unsupported_platform');
}
