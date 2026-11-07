import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react';

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
    revokeAllSessions: vi.fn(async () => {
      callOrder.push('revokeAllSessions');
    }),
    deleteAccount: vi.fn(async () => {}),
  };
}

function SignOutProbe() {
  const { status, signOut, signOutEverywhere } = useSession();
  return (
    <>
      <button data-testid="sign-out" onClick={() => void signOut()}>
        {status}
      </button>
      <button data-testid="sign-out-everywhere" onClick={() => void signOutEverywhere()}>
        everywhere
      </button>
    </>
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
      'refresh-token-123',
      undefined
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

  it('revokes every session and clears local state on sign out everywhere', async () => {
    const authApi = createAuthApiMock();
    setAuthApi(authApi);
    secureStoreMock.getItemAsync.mockResolvedValue(STORED_SESSION);

    const view = renderSession();
    await waitForSignedIn(view);

    await act(async () => {
      fireEvent.click(view.getByTestId('sign-out-everywhere'));
    });

    expect(pushApiMock.unregisterPushToken).not.toHaveBeenCalled();
    expect(authApi.revokeAllSessions).toHaveBeenCalledWith('access-token-123');
    expect(callOrder).toEqual(['revokeAllSessions']);
    expect(secureStoreMock.deleteItemAsync).toHaveBeenCalledWith('aoi.session.v1');
    expect(view.getByTestId('sign-out').textContent).toBe('signed_out');
    view.unmount();
  });

  it('keeps the session and push registration when sign out everywhere fails', async () => {
    const authApi = createAuthApiMock();
    vi.mocked(authApi.revokeAllSessions).mockRejectedValueOnce(new Error('offline'));
    setAuthApi(authApi);
    secureStoreMock.getItemAsync.mockResolvedValue(STORED_SESSION);
    const { result, unmount } = renderHook(() => useSession(), { wrapper: SessionProvider });
    await waitFor(() => expect(result.current.status).toBe('signed_in'));
    await act(async () => { await expect(result.current.signOutEverywhere()).rejects.toThrow('offline'); });
    expect(result.current.status).toBe('signed_in');
    expect(pushApiMock.unregisterPushToken).not.toHaveBeenCalled();
    expect(secureStoreMock.deleteItemAsync).not.toHaveBeenCalled();
    unmount();
  });

  it('uses the live credential rather than an obsolete session snapshot for revocation', async () => {
    const authApi = createAuthApiMock();
    setAuthApi(authApi);
    secureStoreMock.getItemAsync.mockResolvedValue(STORED_SESSION);
    const { result, unmount } = renderHook(() => useSession(), { wrapper: SessionProvider });
    await waitFor(() => expect(result.current.status).toBe('signed_in'));
    setApiTokens({ accessToken: 'renewed-token', refreshToken: 'renewed-token' });
    await act(async () => { await result.current.signOutEverywhere(); });
    expect(authApi.revokeAllSessions).toHaveBeenCalledWith('renewed-token');
    unmount();
  });

  it('does not delete the next account when sign-in starts during credential deletion', async () => {
    const authApi = createAuthApiMock();
    setAuthApi(authApi);
    secureStoreMock.getItemAsync.mockResolvedValue(STORED_SESSION);
    let saved: string | null = STORED_SESSION;
    let finishDelete: () => void = () => {};
    secureStoreMock.deleteItemAsync.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { finishDelete = resolve; });
      saved = null;
    });
    secureStoreMock.setItemAsync.mockImplementation(async (_key: string, value: string) => { saved = value; });
    const { signInWithOAuthProvider } = await import('@/features/auth/oauth-client');
    const nextUser = { ...USER, id: 'user-2' };
    vi.mocked(signInWithOAuthProvider).mockResolvedValueOnce({ user: nextUser, tokens: { accessToken: 'token-2' } });
    const { result, unmount } = renderHook(() => useSession(), { wrapper: SessionProvider });
    await waitFor(() => expect(result.current.status).toBe('signed_in'));
    let leaving: Promise<void>;
    act(() => { leaving = result.current.signOut(); });
    await waitFor(() => expect(secureStoreMock.deleteItemAsync).toHaveBeenCalled());
    await act(async () => {
      const joining = result.current.signInWithProvider('google');
      finishDelete();
      await Promise.all([joining, leaving]);
    });
    expect(result.current.user?.id).toBe('user-2');
    expect(JSON.parse(saved ?? '{}').user?.id).toBe('user-2');
    unmount();
  });

  it('reports failure and keeps the session when offline sign-out cannot delete saved credentials', async () => {
    const authApi = createAuthApiMock();
    vi.mocked(authApi.logout).mockRejectedValueOnce(new Error('offline'));
    setAuthApi(authApi);
    secureStoreMock.getItemAsync.mockResolvedValue(STORED_SESSION);
    secureStoreMock.deleteItemAsync.mockRejectedValueOnce(new Error('keychain unavailable'));
    const { result, unmount } = renderHook(() => useSession(), { wrapper: SessionProvider });
    await waitFor(() => expect(result.current.status).toBe('signed_in'));
    await act(async () => { await expect(result.current.signOut()).rejects.toThrow('keychain unavailable'); });
    expect(result.current.status).toBe('signed_in');
    expect(result.current.user?.id).toBe(USER.id);
    expect(getApiTokens()?.accessToken).toBe('access-token-123');
    unmount();
  });

  it.each(['signOut', 'signOutEverywhere', 'deleteAccount'] as const)('does not restore revoked credentials when local cleanup fails after %s', async (action) => {
    setAuthApi(createAuthApiMock());
    secureStoreMock.getItemAsync.mockResolvedValue(STORED_SESSION);
    secureStoreMock.deleteItemAsync.mockRejectedValueOnce(new Error('keychain unavailable'));
    const { result, unmount } = renderHook(() => useSession(), { wrapper: SessionProvider });
    await waitFor(() => expect(result.current.status).toBe('signed_in'));
    await act(async () => { await result.current[action](); });
    expect(result.current.status).toBe('signed_out');
    expect(getApiTokens()).toBeNull();
    unmount();
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
