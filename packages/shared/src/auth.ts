import type { User } from './user.js';

export type AuthProvider = 'apple' | 'google';
export type OAuthPlatform = 'ios' | 'android';

export type OAuthStartRequest = {
  provider: AuthProvider;
  platform: OAuthPlatform;
  clientId: string;
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: 'S256';
  nonce?: string;
};

export type OAuthStartResponse = {
  authorizationUrl: string;
  state: string;
  codeVerifier?: string;
};

export type OAuthCallbackRequest = {
  provider: AuthProvider;
  platform: OAuthPlatform;
  code: string;
  state: string;
  codeVerifier?: string;
};

export type OAuthNativeCallbackRequest = {
  provider: 'apple';
  platform: 'ios';
  idToken: string;
  nonce: string;
  displayName?: string;
};

export type OAuthCallbackResponse = {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
  user: User;
};

export type SessionResponse = {
  authenticated: boolean;
  user: User;
  expiresAt: string;
};

export type RefreshRequest = {
  refreshToken: string;
};

export type RefreshResponse = {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
};

export type LogoutRequest = {
  refreshToken?: string;
};
