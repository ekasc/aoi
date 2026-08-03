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

export type WorkOSAuthorizeRequest = {
  provider: AuthProvider;
  redirectUri: string;
};

export type WorkOSAuthorizeResponse = {
  authorizationUrl: string;
};

export type WorkOSCallbackRequest = {
  code: string;
};

export type WorkOSAppleNativeRequest = {
  idToken: string;
  nonce: string;
  displayName?: string;
};

export type SessionResponse = {
  authenticated: boolean;
  user: AuthSessionUser;
  expiresAt: string;
};

export type AuthApi = {
  workosAuthorize: (input: WorkOSAuthorizeRequest) => Promise<WorkOSAuthorizeResponse>;
  workosCallback: (input: WorkOSCallbackRequest) => Promise<AuthSessionPayload>;
  workosAppleNative: (input: WorkOSAppleNativeRequest) => Promise<AuthSessionPayload>;
  getSession: (accessToken: string) => Promise<AuthSessionUser>;
  logout: (accessToken: string, refreshToken?: string) => Promise<void>;
  deleteAccount: (accessToken: string) => Promise<void>;
};
