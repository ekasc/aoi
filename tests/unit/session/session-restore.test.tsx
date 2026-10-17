import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { createElement, type ComponentType, type ReactNode } from 'react';

const secureStoreMock = vi.hoisted(() => ({
  getItemAsync: vi.fn(async () => null as string | null),
  setItemAsync: vi.fn(async () => {}),
  deleteItemAsync: vi.fn(async () => {}),
}));

vi.mock('expo-secure-store', () => secureStoreMock);
vi.mock('@/features/push/push-api', () => ({ unregisterPushToken: vi.fn(async () => {}) }));
vi.mock('@/features/auth/oauth-client', () => ({
  OAuthClientError: class OAuthClientError extends Error {},
  signInWithOAuthProvider: vi.fn(),
}));

const USER = { id: 'user-1', email: 'aoi@example.com', displayName: 'Aoi' };
const STORED_TOKENS = {
  accessToken: 'stored-access-token',
  refreshToken: 'stored-refresh-token',
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
};

function statusError(status: number) {
  return Object.assign(new Error('Unable to fetch session.'), { status });
}

// Restore reads auth mode at module load, so (like the api-client token
// suite) each test re-imports the stack with real remote mode stubbed in.
async function loadStack() {
  vi.resetModules();
  const session = await import('@/features/session/session-context');
  const auth = await import('@/features/auth/auth-api');
  const client = await import('@/features/api-client');
  return { ...session, ...auth, ...client };
}

function createAuthApiMock(getSession: () => Promise<typeof USER>): AuthApi {
  return {
    signInWithAppleIdToken: vi.fn(async () => ({ user: USER, tokens: STORED_TOKENS })),
    signInWithGoogleIdToken: vi.fn(async () => ({ user: USER, tokens: STORED_TOKENS })),
    getSession,
    logout: vi.fn(async () => {}),
    deleteAccount: vi.fn(async () => {}),
  };
}

function renderStatus(
  SessionProvider: ComponentType<{ children: ReactNode }>,
  useSession: () => { status: string },
) {
  const Probe = () =>
    createElement('button', { 'data-testid': 'status' }, useSession().status);
  return render(createElement(SessionProvider, null, createElement(Probe)));
}

beforeEach(() => {
  vi.stubEnv('EXPO_PUBLIC_AUTH_STUB_MODE', 'false');
  vi.stubEnv('EXPO_PUBLIC_AUTH_API_BASE_URL', 'https://api.test.local');
  secureStoreMock.getItemAsync.mockReset();
  secureStoreMock.setItemAsync.mockReset();
  secureStoreMock.deleteItemAsync.mockReset();
  secureStoreMock.getItemAsync.mockResolvedValue(
    JSON.stringify({ user: USER, tokens: STORED_TOKENS })
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('session restore (stored credentials)', () => {
  it('discards the stored session on an explicit 401', async () => {
    const { SessionProvider, useSession, setAuthApi, getApiTokens } = await loadStack();
    setAuthApi(createAuthApiMock(async () => {
      throw statusError(401);
    }));

    const view = renderStatus(SessionProvider, useSession);
    await waitFor(() =>
      expect(view.getByTestId('status').textContent).toBe('signed_out')
    );

    expect(secureStoreMock.deleteItemAsync).toHaveBeenCalledWith('aoi.session.v1');
    expect(getApiTokens()).toBeNull();
    view.unmount();
  });

  it('keeps the stored session on a server hiccup instead of stranding the sign-in', async () => {
    // The regression: ANY non-TypeError (including a transient 500)
    // deleted the stored credentials, so one Cloudflare/D1 blip during
    // reload forced a fresh login. Only a 401 means dead credentials.
    const { SessionProvider, useSession, setAuthApi, getApiTokens } = await loadStack();
    setAuthApi(createAuthApiMock(async () => {
      throw statusError(500);
    }));

    const view = renderStatus(SessionProvider, useSession);
    await waitFor(() =>
      expect(view.getByTestId('status').textContent).toBe('signed_in')
    );

    expect(secureStoreMock.deleteItemAsync).not.toHaveBeenCalled();
    expect(getApiTokens()).toEqual(STORED_TOKENS);
    view.unmount();
  });

  it('keeps the stored session on a network failure', async () => {
    const { SessionProvider, useSession, setAuthApi } = await loadStack();
    setAuthApi(createAuthApiMock(async () => {
      throw new TypeError('fetch failed');
    }));

    const view = renderStatus(SessionProvider, useSession);
    await waitFor(() =>
      expect(view.getByTestId('status').textContent).toBe('signed_in')
    );

    expect(secureStoreMock.deleteItemAsync).not.toHaveBeenCalled();
    view.unmount();
  });

  it('keeps the stored session when the failure carries no status', async () => {
    const { SessionProvider, useSession, setAuthApi } = await loadStack();
    setAuthApi(createAuthApiMock(async () => {
      throw new Error('boom');
    }));

    const view = renderStatus(SessionProvider, useSession);
    await waitFor(() =>
      expect(view.getByTestId('status').textContent).toBe('signed_in')
    );

    expect(secureStoreMock.deleteItemAsync).not.toHaveBeenCalled();
    view.unmount();
  });
});
