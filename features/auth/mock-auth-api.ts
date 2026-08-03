import type {
  AuthApi,
  AuthSessionPayload,
  AuthSessionUser,
  WorkOSAppleNativeRequest,
  WorkOSAuthorizeRequest,
} from './types';

const sessionStore = new Map<string, AuthSessionUser>();

function createUser(provider: WorkOSAuthorizeRequest['provider']): AuthSessionUser {
  const email = provider === 'apple' ? 'jordan@icloud.com' : 'alex@gmail.com';
  const localPart = email.split('@')[0];
  const displayName = localPart
    .split(/[._-]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

  return {
    id: `mock_${provider}_user`,
    email,
    displayName,
  };
}

function createStubSession(provider: WorkOSAuthorizeRequest['provider']): AuthSessionPayload {
  const accessToken = `stub_${provider}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const user = createUser(provider);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();

  sessionStore.set(accessToken, user);

  return {
    user,
    tokens: {
      accessToken,
      refreshToken: `refresh_${accessToken}`,
      expiresAt,
    },
  };
}

export const mockAuthApi: AuthApi = {
  async workosAuthorize(input: WorkOSAuthorizeRequest) {
    return {
      authorizationUrl: `https://mock-auth.aoi.local/workos/${input.provider}?redirect=${encodeURIComponent(input.redirectUri)}`,
    };
  },

  async workosCallback() {
    return createStubSession('google');
  },

  async workosAppleNative(input: WorkOSAppleNativeRequest) {
    if (!input.idToken.trim() || !input.nonce.trim()) {
      throw new Error('idToken and nonce are required.');
    }

    return createStubSession('apple');
  },

  async getSession(accessToken) {
    const user = sessionStore.get(accessToken);

    if (!user) {
      throw new Error('Session not found.');
    }

    return user;
  },

  async logout(accessToken, _refreshToken) {
    sessionStore.delete(accessToken);
  },

  async deleteAccount(accessToken) {
    sessionStore.delete(accessToken);
  },
};
