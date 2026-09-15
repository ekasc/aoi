import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, waitFor } from '@testing-library/react';

import { setApiTokens } from '@/features/api-client';
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

const deleteAccountSpy = vi.fn();

function createAuthApiMock(): AuthApi {
  return {
    signInWithAppleIdToken: vi.fn(async () => ({ user: USER, tokens: { accessToken: '' } })),
    signInWithGoogleIdToken: vi.fn(async () => ({ user: USER, tokens: { accessToken: '' } })),
    getSession: vi.fn(async () => USER),
    logout: vi.fn(async () => {}),
    deleteAccount: deleteAccountSpy,
  };
}

function DeleteProbe() {
  const { status, deleteAccount } = useSession();
  // Production callers (settings/space) await + catch; mirror that so a
  // server failure never escapes as an unhandled rejection.
  return (
    <button data-testid="delete" onClick={() => void deleteAccount().catch(() => {})}>
      {status}
    </button>
  );
}

function renderSession() {
  return render(
    <SessionProvider>
      <DeleteProbe />
    </SessionProvider>
  );
}

beforeEach(() => {
  setApiTokens(null);
  deleteAccountSpy.mockReset();
  deleteAccountSpy.mockResolvedValue(undefined);
  secureStoreMock.getItemAsync.mockReset();
  secureStoreMock.setItemAsync.mockClear();
  secureStoreMock.deleteItemAsync.mockClear();
  pushApiMock.unregisterPushToken.mockClear();
});

describe('deleteAccount lifecycle', () => {
  it('calls the server delete, then lands signed_out with storage cleared', async () => {
    const authApi = createAuthApiMock();
    setAuthApi(authApi);
    secureStoreMock.getItemAsync.mockResolvedValue(STORED_SESSION);

    const view = renderSession();
    await waitFor(() =>
      expect(view.getByTestId('delete').textContent).toBe('signed_in')
    );

    await act(async () => {
      fireEvent.click(view.getByTestId('delete'));
    });

    expect(deleteAccountSpy).toHaveBeenCalledWith('access-token-123');
    // Local state clears even though the server owns the deletion — and the
    // P0B subscription effect observes this signed_out transition to call
    // Purchases.logOut (pinned in subscription-context tests).
    expect(secureStoreMock.deleteItemAsync).toHaveBeenCalledWith('aoi.session.v1');
    expect(view.getByTestId('delete').textContent).toBe('signed_out');
    view.unmount();
  });

  it('still signs out locally when the server delete fails', async () => {
    const authApi = createAuthApiMock();
    setAuthApi(authApi);
    deleteAccountSpy.mockRejectedValueOnce(new Error('network down'));
    secureStoreMock.getItemAsync.mockResolvedValue(STORED_SESSION);

    const view = renderSession();
    await waitFor(() =>
      expect(view.getByTestId('delete').textContent).toBe('signed_in')
    );

    await act(async () => {
      fireEvent.click(view.getByTestId('delete'));
    });

    // Never trap the user in a half-deleted local session.
    expect(secureStoreMock.deleteItemAsync).toHaveBeenCalledWith('aoi.session.v1');
    expect(view.getByTestId('delete').textContent).toBe('signed_out');
    view.unmount();
  });
});
