import type {
  AuthApi,
  AuthSessionPayload,
  AuthSessionUser,
  OAuthStartRequest,
} from '@/features/auth/types';

const stateStore = new Set<string>();
const sessionStore = new Map<string, AuthSessionUser>();

function createStateToken() {
  return `st_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

function createCodeVerifier() {
  return `ver_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

function createAccessToken(provider: OAuthStartRequest['provider']) {
  return `stub_${provider}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

function createUser(provider: OAuthStartRequest['provider']): AuthSessionUser {
  return {
    id: `mock_${provider}_user`,
    email: provider === 'apple' ? 'ios-user@aoi.local' : 'google-user@aoi.local',
    displayName: provider === 'apple' ? 'iOS User' : 'Google User',
  };
}

function createStubSession(provider: OAuthStartRequest['provider']): AuthSessionPayload {
  const accessToken = createAccessToken(provider);
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
  async oauthStart({ provider }) {
    const state = createStateToken();
    const codeVerifier = createCodeVerifier();
    stateStore.add(state);

    return {
      authorizationUrl: `https://mock-auth.aoi.local/oauth/${provider}?state=${state}`,
      state,
      codeVerifier,
    };
  },

  async oauthCallback({ provider, state }) {
    if (!stateStore.has(state)) {
      throw new Error('Invalid auth state. Please try again.');
    }

    stateStore.delete(state);
    return createStubSession(provider);
  },

  async getSession(accessToken) {
    const user = sessionStore.get(accessToken);

    if (!user) {
      throw new Error('Session not found.');
    }

    return user;
  },

  async logout(accessToken) {
    sessionStore.delete(accessToken);
  },
};
