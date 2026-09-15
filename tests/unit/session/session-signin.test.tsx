import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { useCallback } from 'react';

import { setApiTokens, getApiTokens } from '@/features/api-client';
import { setAuthApi } from '@/features/auth/auth-api';
import type { AuthApi } from '@/features/auth/types';
import { SessionProvider, useSession } from '@/features/session/session-context';

const secureStoreMock = vi.hoisted(() => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => {}),
  deleteItemAsync: vi.fn(async () => {}),
}));

const oauthClientMock = vi.hoisted(() => ({
  signInWithOAuthProvider: vi.fn(),
}));

vi.mock('expo-secure-store', () => secureStoreMock);
vi.mock('@/features/push/push-api', () => ({ unregisterPushToken: vi.fn(async () => {}) }));
vi.mock('@/features/auth/oauth-client', () => ({
  OAuthClientError: class OAuthClientError extends Error {
    constructor(
      message: string,
      public readonly code: string
    ) {
      super(message);
    }
  },
  signInWithOAuthProvider: oauthClientMock.signInWithOAuthProvider,
}));

const USER = { id: 'user-1', email: 'aoi@example.com', displayName: 'Aoi' };
const SIGN_IN_TOKENS = {
  accessToken: 'fresh-access-token',
  refreshToken: 'fresh-refresh-token',
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
};

function createAuthApiMock(): AuthApi {
  return {
    signInWithAppleIdToken: vi.fn(async () => ({ user: USER, tokens: SIGN_IN_TOKENS })),
    signInWithGoogleIdToken: vi.fn(async () => ({ user: USER, tokens: SIGN_IN_TOKENS })),
    getSession: vi.fn(async () => USER),
    logout: vi.fn(async () => {}),
    deleteAccount: vi.fn(async () => {}),
  };
}

function SignInProbe() {
  const { status, signInWithProvider } = useSession();
  const signIn = useCallback(() => signInWithProvider('google'), [signInWithProvider]);
  return (
    <button data-testid="sign-in" onClick={() => void signIn()}>
      {status}
    </button>
  );
}

beforeEach(() => {
  setApiTokens(null);
  secureStoreMock.getItemAsync.mockReset();
  secureStoreMock.getItemAsync.mockResolvedValue(null);
  oauthClientMock.signInWithOAuthProvider.mockReset();
  oauthClientMock.signInWithOAuthProvider.mockResolvedValue({
    user: USER,
    tokens: SIGN_IN_TOKENS,
  });
});

describe('sign-in token plumbing (api-client)', () => {
  it('publishes fresh tokens to the api-client after sign-in', async () => {
    const authApi = createAuthApiMock();
    setAuthApi(authApi);
    setApiTokens(null);

    const view = render(
      <SessionProvider>
        <SignInProbe />
      </SessionProvider>
    );

    await act(async () => {
      view.getByTestId('sign-in').click();
    });

    await waitFor(() =>
      expect(view.getByTestId('sign-in').textContent).toBe('signed_in')
    );

    // The regression: tokens were persisted to SecureStore but never
    // published to the api-client, so remote requests went out with no
    // Authorization header. The api-client must see the same tokens.
    expect(getApiTokens()).toEqual(SIGN_IN_TOKENS);
    expect(oauthClientMock.signInWithOAuthProvider).toHaveBeenCalledWith('google', authApi);
    expect(secureStoreMock.setItemAsync).toHaveBeenCalledWith(
      'aoi.session.v1',
      JSON.stringify({ user: USER, tokens: SIGN_IN_TOKENS })
    );

    view.unmount();
  });
});
