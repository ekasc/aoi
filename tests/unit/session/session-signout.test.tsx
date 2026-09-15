import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, waitFor } from '@testing-library/react';

import { setApiTokens, getApiTokens } from '@/features/api-client';
import { setAuthApi } from '@/features/auth/auth-api';
import type { AuthApi } from '@/features/auth/types';
import { SessionProvider, useSession } from '@/features/session/session-context';

const secureStoreMock = vi.hoisted(() => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(async () => {}),
  deleteItemAsync: vi.fn(async () => {}),
}));

const pushApiMock = vi.hoisted(() => ({
  unregisterPushToken: vi.fn(async () => {}),
}));

// Cut the native chain (expo-apple-authentication & co.) — the sign-out
// flow never touches OAuth.
vi.mock('@/features/auth/oauth-client', () => ({
  OAuthClientError: class OAuthClientError extends Error {
    constructor(
      message: string,
      public readonly code: string
    ) {
      super(message);
    }
  },
  signInWithOAuthProvider: vi.fn(),
}));

vi.mock('expo-secure-store', () => secureStoreMock);
vi.mock('@/features/push/push-api', () => pushApiMock);

const USER = { id: 'user-1', email: 'aoi@example.com', displayName: 'Aoi' };

const STORED_SESSION = JSON.stringify({
  user: USER,
  tokens: { accessToken: 'access-token-123', refreshToken: 'refresh-token-123' },
});

// Records the order in which sign-out steps run.
const callOrder: string[] = [];

function createAuthApiMock(): AuthApi {
  return {
    signInWithAppleIdToken: vi.fn(async () => ({ user: USER, tokens: { accessToken: '' } })),
    signInWithGoogleIdToken: vi.fn(async () => ({ user: USER, tokens: { accessToken: '' } })),
    getSession: vi.fn(async () => USER),
    logout: vi.fn(async () => {
      callOrder.push('logout');
    }),
    deleteAccount: vi.fn(async () => {}),
  };
}

function SignOutProbe() {
  const { status, signOut } = useSession();
  return (
    <button data-testid="sign-out" onClick={() => void signOut()}>
      {status}
    </button>
  );
}

function renderSession() {
  return render(
    <SessionProvider>
      <SignOutProbe />
    </SessionProvider>
  );
}

async function waitForSignedIn(view: ReturnType<typeof renderSession>) {
  await waitFor(() =>
    expect(view.getByTestId('sign-out').textContent).toBe('signed_in')
  );
}

async function clickSignOut(view: ReturnType<typeof renderSession>) {
  await act(async () => {
    fireEvent.click(view.getByTestId('sign-out'));
  });
}

beforeEach(() => {
  callOrder.length = 0;
  setApiTokens(null);
  secureStoreMock.getItemAsync.mockReset();
  secureStoreMock.setItemAsync.mockClear();
  secureStoreMock.deleteItemAsync.mockClear();
  pushApiMock.unregisterPushToken.mockClear();
  pushApiMock.unregisterPushToken.mockImplementation(async () => {
    callOrder.push('unregisterPushToken');
  });
});

describe('signOut push-token cleanup (single choke point)', () => {
  it('unregisters the push token before logging out', async () => {
    const authApi = createAuthApiMock();
    setAuthApi(authApi);
    secureStoreMock.getItemAsync.mockResolvedValue(STORED_SESSION);

    const view = renderSession();
    await waitForSignedIn(view);

    await clickSignOut(view);

    expect(pushApiMock.unregisterPushToken).toHaveBeenCalledTimes(1);
    expect(authApi.logout).toHaveBeenCalledWith(
      'access-token-123',
      'refresh-token-123'
    );
    // The token is unregistered while the access token is still valid —
    // strictly before the logout call.
    expect(callOrder).toEqual(['unregisterPushToken', 'logout']);
    expect(secureStoreMock.deleteItemAsync).toHaveBeenCalledWith('aoi.session.v1');
    expect(view.getByTestId('sign-out').textContent).toBe('signed_out');
    view.unmount();
  });

  it('still completes sign-out when unregister fails (tender-error policy)', async () => {
    const authApi = createAuthApiMock();
    setAuthApi(authApi);
    secureStoreMock.getItemAsync.mockResolvedValue(STORED_SESSION);
    pushApiMock.unregisterPushToken.mockImplementation(async () => {
      throw new Error('network down');
    });

    const view = renderSession();
    await waitForSignedIn(view);

    await expect(clickSignOut(view)).resolves.toBeUndefined();

    expect(authApi.logout).toHaveBeenCalledTimes(1);
    expect(secureStoreMock.deleteItemAsync).toHaveBeenCalledWith('aoi.session.v1');
    expect(view.getByTestId('sign-out').textContent).toBe('signed_out');
    view.unmount();
  });

  it('republishes the stored tokens to the api-client on restore (token plumbing)', async () => {
    const authApi = createAuthApiMock();
    setAuthApi(authApi);
    secureStoreMock.getItemAsync.mockResolvedValue(STORED_SESSION);

    const view = renderSession();
    await waitForSignedIn(view);

    // Session restore must publish tokens to the api-client, or remote mode
    // sends requests without an Authorization header (regression pin).
    expect(getApiTokens()).toEqual({
      accessToken: 'access-token-123',
      refreshToken: 'refresh-token-123',
    });

    await clickSignOut(view);
    expect(getApiTokens()).toBeNull();
    view.unmount();
  });
});
