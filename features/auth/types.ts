export type AuthProvider = 'apple' | 'google';

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
  redirectUri: string;
};

export type OAuthStartResponse = {
  authorizationUrl: string;
  state: string;
  codeVerifier?: string;
};

export type OAuthCallbackRequest = {
  provider: AuthProvider;
  code: string;
  state: string;
  redirectUri: string;
  codeVerifier?: string;
};

export type AuthApi = {
  oauthStart: (input: OAuthStartRequest) => Promise<OAuthStartResponse>;
  oauthCallback: (input: OAuthCallbackRequest) => Promise<AuthSessionPayload>;
  getSession: (accessToken: string) => Promise<AuthSessionUser>;
  logout: (accessToken: string) => Promise<void>;
};
