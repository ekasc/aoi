import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform } from 'react-native';

import {
  getGoogleClientId,
  getGoogleIosClientId,
  isAuthStubMode,
} from './auth-config';
import type {
  AuthApi,
  AuthProvider,
  AuthSessionPayload,
} from './types';

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

/**
 * Apple native sign-in (iOS only). The identity token from
 * expo-apple-authentication is posted to the worker's `/v1/auth/apple`
 * adapter; Better Auth verifies its signature before minting a session.
 */
async function signInWithAppleIOSNative(authApi: AuthApi): Promise<AuthSessionPayload> {
  const nonce = randomString(32);

  if (isAuthStubMode()) {
    return authApi.signInWithAppleIdToken({
      provider: 'apple',
      platform: 'ios',
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

  return authApi.signInWithAppleIdToken({
    provider: 'apple',
    platform: 'ios',
    idToken,
    nonce,
    displayName,
  });
}

/**
 * Google sign-in (iOS + Android) via the native Google Sign-In SDK
 * (@react-native-google-signin/google-signin). No redirect URI is involved:
 * the SDK returns an idToken directly from the system account sheet.
 *
 * The idToken's `aud` is the WEB client id (passed as `webClientId` —
 * verified in the package's native code: iOS `GIDConfiguration(clientID,
 * serverClientID: webClientId)`, Android `requestIdToken(webClientId)`),
 * which is exactly what the server verifies against its GOOGLE_CLIENT_ID.
 * The SDK mints no nonce; Better Auth skips the nonce check when none is
 * sent (`if (nonce && jwtClaims.nonce !== nonce) return null` in
 * @better-auth/core/dist/social-providers/google.mjs).
 */
async function signInWithGoogle(authApi: AuthApi): Promise<AuthSessionPayload> {
  if (isAuthStubMode()) {
    return authApi.signInWithGoogleIdToken({
      provider: 'google',
      idToken: `stub_google_id_token_${Date.now()}`,
    });
  }

  const { GoogleSignin } = await import('@react-native-google-signin/google-signin');

  GoogleSignin.configure({
    iosClientId: getGoogleIosClientId(),
    webClientId: getGoogleClientId(),
    scopes: ['email', 'profile'],
  });

  let response;
  try {
    response = await GoogleSignin.signIn();
  } catch {
    throw new OAuthClientError('Unable to complete Google sign in.', 'unknown');
  }

  if (response.type !== 'success') {
    throw new OAuthClientError('Sign in was canceled.', 'cancelled');
  }

  const idToken = response.data.idToken?.trim();
  if (!idToken) {
    throw new OAuthClientError('Google did not return an identity token.', 'invalid_callback');
  }

  return authApi.signInWithGoogleIdToken({
    provider: 'google',
    idToken,
    displayName: response.data.user?.name?.trim() || undefined,
  });
}

export async function signInWithOAuthProvider(
  provider: AuthProvider,
  authApi: AuthApi
): Promise<AuthSessionPayload> {
  const platform = resolvePlatform();

  if (provider === 'apple' && platform === 'ios') {
    return signInWithAppleIOSNative(authApi);
  }

  if (provider === 'google') {
    return signInWithGoogle(authApi);
  }

  // Apple on Android: the native Apple sheet is iOS-only, and Better Auth's
  // web redirect flow hands the session back as a cookie — a mobile
  // WebBrowser session cannot surface that cookie to the app. The idToken
  // exchange path (this module) is the supported mobile flow; Android users
  // sign in with Google. Stub mode still works so the UI is exercisable.
  if (isAuthStubMode()) {
    return authApi.signInWithAppleIdToken({
      provider: 'apple',
      platform: 'ios',
      idToken: `stub_apple_id_token_${Date.now()}`,
      nonce: randomString(32),
    });
  }

  throw new OAuthClientError(
    'Apple sign in is only available on iOS. Use Google instead.',
    'unsupported_platform'
  );
}
