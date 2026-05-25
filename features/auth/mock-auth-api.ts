import type {
  AuthApi,
  AuthSessionPayload,
  AuthSessionUser,
  OAuthNativeCallbackRequest,
  OAuthStartRequest,
} from './types';

const stateStore = new Set<string>();
const sessionStore = new Map<string, AuthSessionUser>();

function createStateToken() {
  return `st_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

function createAccessToken(provider: OAuthStartRequest['provider']) {
  return `stub_${provider}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

function createUser(
  provider: OAuthStartRequest['provider'],
  overrides?: Partial<AuthSessionUser>
): AuthSessionUser {
  return {
    id: overrides?.id ?? `mock_${provider}_user`,
    email:
      overrides?.email ??
      (provider === 'apple' ? 'ios-user@aoi.local' : 'google-user@aoi.local'),
    displayName:
      overrides?.displayName ??
      (provider === 'apple' ? 'iOS User' : 'Google User'),
    avatarUrl: overrides?.avatarUrl,
  };
}

function createStubSession(
  provider: OAuthStartRequest['provider'],
  userOverrides?: Partial<AuthSessionUser>
): AuthSessionPayload {
  const accessToken = createAccessToken(provider);
  const user = createUser(provider, userOverrides);
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
    stateStore.add(state);

    return {
      authorizationUrl: `https://mock-auth.aoi.local/oauth/${provider}?state=${state}`,
      state,
    };
  },

  async oauthCallback({ provider, state }) {
    if (!stateStore.has(state)) {
      throw new Error('Invalid auth state. Please try again.');
    }

    stateStore.delete(state);
    return createStubSession(provider);
  },

  async oauthNativeCallback(input: OAuthNativeCallbackRequest) {
    if (input.provider !== 'apple' || input.platform !== 'ios') {
      throw new Error('Native callback only supports Apple on iOS.');
    }

    if (!input.idToken.trim() || !input.nonce.trim()) {
      throw new Error('idToken and nonce are required.');
    }

    return createStubSession('apple', {
      displayName: input.displayName?.trim() || 'Apple User',
      avatarUrl: input.avatarUrl?.trim() || undefined,
    });
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
};
