import type {
  AppleIdTokenSignInRequest,
  AuthApi,
  AuthSessionPayload,
  AuthSessionUser,
  GoogleIdTokenSignInRequest,
} from './types';

const sessionStore = new Map<string, AuthSessionUser>();

function createUser(provider: 'apple' | 'google'): AuthSessionUser {
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

function createStubSession(provider: 'apple' | 'google'): AuthSessionPayload {
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
  async signInWithAppleIdToken(input: AppleIdTokenSignInRequest) {
    if (!input.idToken.trim() || !input.nonce.trim()) {
      throw new Error('idToken and nonce are required.');
    }

    return createStubSession('apple');
  },

  async signInWithGoogleIdToken(input: GoogleIdTokenSignInRequest) {
    if (!input.idToken.trim()) {
      throw new Error('idToken is required.');
    }

    return createStubSession('google');
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
