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
  avatarUrl?: string;
};

export type OAuthCallbackResponse = {
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
  oauthStart: (input: OAuthStartRequest) => Promise<OAuthStartResponse>;
  oauthCallback: (input: OAuthCallbackRequest) => Promise<AuthSessionPayload>;
  oauthNativeCallback: (
    input: OAuthNativeCallbackRequest
  ) => Promise<AuthSessionPayload>;
  getSession: (accessToken: string) => Promise<AuthSessionUser>;
  logout: (accessToken: string, refreshToken?: string) => Promise<void>;
};
