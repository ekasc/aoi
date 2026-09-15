export type AuthProvider = 'apple' | 'google';
export type OAuthPlatform = 'ios' | 'android';

export type AuthSessionUser = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
};

export type AuthSessionTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
};

export type AuthSessionPayload = {
  user: AuthSessionUser;
  tokens: AuthSessionTokens;
};

/**
 * Apple native sign-in (iOS). The client obtains an identity token via
 * expo-apple-authentication and posts it to the worker's `/v1/auth/apple`
 * adapter, which verifies it through Better Auth's `sign-in/social`
 * idToken branch.
 */
export type AppleIdTokenSignInRequest = {
  provider: 'apple';
  platform: 'ios';
  idToken: string;
  nonce: string;
  displayName?: string;
};

/**
 * Google sign-in via an OAuth idToken (all platforms). The client obtains a
 * Google idToken through expo-auth-session and posts it to `/v1/auth/google`,
 * which verifies it against Google's keys via Better Auth.
 */
export type GoogleIdTokenSignInRequest = {
  provider: 'google';
  idToken: string;
  nonce?: string;
  displayName?: string;
};

/** Wire shape returned by the worker's sign-in adapters. */
export type IdTokenSignInResponse = {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
  user: AuthSessionUser;
};

export type SessionResponse = {
  authenticated: boolean;
  user: AuthSessionUser;
  expiresAt: string;
};

export type AuthApi = {
  signInWithAppleIdToken: (
    input: AppleIdTokenSignInRequest
  ) => Promise<AuthSessionPayload>;
  signInWithGoogleIdToken: (
    input: GoogleIdTokenSignInRequest
  ) => Promise<AuthSessionPayload>;
  getSession: (accessToken: string) => Promise<AuthSessionUser>;
  logout: (accessToken: string, refreshToken?: string) => Promise<void>;
  deleteAccount: (accessToken: string) => Promise<void>;
};
