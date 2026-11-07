import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ComponentType, type ReactNode } from 'react';

import type { AuthApi } from '@/features/auth/types';

const secureStoreMock = vi.hoisted(() => ({
  getItemAsync: vi.fn(async () => null as string | null),
  setItemAsync: vi.fn(async () => {}),
  deleteItemAsync: vi.fn(async () => {}),
}));

vi.mock('expo-secure-store', () => secureStoreMock);
const appState = vi.hoisted(() => ({ change: (_state: string) => {} }));
vi.mock('react-native', () => ({ AppState: {
  addEventListener: (_event: string, listener: (state: string) => void) => {
    appState.change = listener;
    return { remove: () => {} };
  },
} }));
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
    revokeAllSessions: vi.fn(async () => {}),
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
  vi.unstubAllGlobals();
});

describe('session restore (stored credentials)', () => {
  it('finishes credential deletion after repeated sign-out and foregrounding behind a blocked write', async () => {
    const app = await loadStack();
    app.setAuthApi(createAuthApiMock(async () => USER));
    let saved: string | null = JSON.stringify({ user: USER, tokens: STORED_TOKENS });
    let finishWrite: () => void = () => {};
    const gate = new Promise<void>((resolve) => { finishWrite = resolve; });
    secureStoreMock.setItemAsync.mockImplementation(async (_key: string, value: string) => { await gate; saved = value; });
    secureStoreMock.deleteItemAsync.mockImplementation(async () => { saved = null; });
    const view = renderHook(() => app.useSession(), { wrapper: app.SessionProvider });
    await waitFor(() => expect(secureStoreMock.setItemAsync).toHaveBeenCalled());
    let first: Promise<void>;
    act(() => { first = view.result.current.signOut(); });
    await waitFor(() => expect(app.getApiTokens()).toBeNull());
    await act(async () => {
      appState.change('active');
      const second = view.result.current.signOut();
      finishWrite();
      await Promise.all([first, second]);
    });
    expect(saved).toBeNull();
    expect(view.result.current.status).toBe('signed_out');
    expect(view.result.current.isHydrated).toBe(true);
    expect(secureStoreMock.getItemAsync).toHaveBeenCalledOnce();
    view.unmount();
  });

  it('keeps web entry available without calling native SecureStore', async () => {
    vi.stubEnv('EXPO_OS', 'web');
    const stack = await loadStack();
    stack.setAuthApi(createAuthApiMock(async () => USER));
    const view = renderStatus(stack.SessionProvider, stack.useSession);
    await waitFor(() => expect(view.getByTestId('status').textContent).toBe('signed_out'));
    expect(secureStoreMock.getItemAsync).not.toHaveBeenCalled();
    view.unmount();
  });

  it('orders credential deletion after an already-running storage write', async () => {
    const stack = await loadStack();
    stack.setAuthApi(createAuthApiMock(async () => USER));
    let saved: string | null = JSON.stringify({ user: USER, tokens: STORED_TOKENS });
    let finishWrite: () => void = () => {};
    const gate = new Promise<void>((resolve) => { finishWrite = resolve; });
    secureStoreMock.setItemAsync.mockImplementation(async (_key: string, value: string) => { await gate; saved = value; });
    secureStoreMock.deleteItemAsync.mockImplementation(async () => { saved = null; });
    const view = renderHook(() => stack.useSession(), { wrapper: stack.SessionProvider });
    await waitFor(() => expect(secureStoreMock.setItemAsync).toHaveBeenCalled());
    let pending: Promise<void>;
    await act(async () => {
      pending = view.result.current.signOut();
      finishWrite();
      await pending;
    });
    expect(saved).toBeNull();
    expect(view.result.current.status).toBe('signed_out');
    view.unmount();
  });

  it('persists refreshed credentials and restores them after a provider restart', async () => {
    const stack = await loadStack();
    stack.setAuthApi(createAuthApiMock(async () => USER));
    let saved = JSON.stringify({ user: USER, tokens: STORED_TOKENS });
    secureStoreMock.getItemAsync.mockImplementation(async () => saved);
    secureStoreMock.setItemAsync.mockImplementation(async (_key: string, value: string) => { saved = value; });
    const view = renderHook(() => stack.useSession(), { wrapper: stack.SessionProvider });
    await waitFor(() => expect(view.result.current.status).toBe('signed_in'));
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({}, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ accessToken: 'renewed', refreshToken: 'renewed-refresh', expiresInSec: 3600 }))
      .mockResolvedValueOnce(Response.json({ ok: true })));
    await act(async () => { await stack.apiFetch('/v1/spaces/current'); });
    expect(view.result.current.tokens?.accessToken).toBe('renewed');
    expect(JSON.parse(saved).tokens).toEqual(view.result.current.tokens);
    view.unmount();
    stack.setApiTokens(null);
    const restarted = renderHook(() => stack.useSession(), { wrapper: stack.SessionProvider });
    await waitFor(() => expect(restarted.result.current.status).toBe('signed_in'));
    expect(stack.getApiTokens()?.accessToken).toBe('renewed');
    restarted.unmount();
  });

  it('does not resurrect a signed-out session when startup validation finishes late', async () => {
    const stack = await loadStack();
    let finish: (user: typeof USER) => void = () => {};
    stack.setAuthApi(createAuthApiMock(() => new Promise((resolve) => { finish = resolve; })));
    const view = renderHook(() => stack.useSession(), { wrapper: stack.SessionProvider });
    await waitFor(() => expect(view.result.current.status).toBe('signed_in'));
    await act(async () => { await view.result.current.signOut(); });
    secureStoreMock.setItemAsync.mockClear();
    await act(async () => { finish(USER); });
    expect(view.result.current.status).toBe('signed_out');
    expect(stack.getApiTokens()).toBeNull();
    expect(secureStoreMock.setItemAsync).not.toHaveBeenCalled();
    view.unmount();
  });

  it('removes access after the server explicitly rejects the current refresh credential', async () => {
    const stack = await loadStack();
    stack.setAuthApi(createAuthApiMock(async () => USER));
    const view = renderHook(() => stack.useSession(), { wrapper: stack.SessionProvider });
    await waitFor(() => expect(view.result.current.status).toBe('signed_in'));
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code: 'UNAUTHORIZED', message: 'Revoked' } }, { status: 401 })));
    await act(async () => { await expect(stack.apiFetch('/v1/spaces/current')).rejects.toThrow('Revoked'); });
    expect(view.result.current.status).toBe('signed_out');
    expect(stack.getApiTokens()).toBeNull();
    expect(secureStoreMock.deleteItemAsync).toHaveBeenCalled();
    view.unmount();
  });

  it('keeps stored credentials when a session check returns 401', async () => {
    const { SessionProvider, useSession, setAuthApi, getApiTokens } = await loadStack();
    setAuthApi(createAuthApiMock(async () => {
      throw statusError(401);
    }));

    const view = renderStatus(SessionProvider, useSession);
    await waitFor(() =>
      expect(view.getByTestId('status').textContent).toBe('signed_in')
    );

    expect(secureStoreMock.deleteItemAsync).not.toHaveBeenCalled();
    expect(getApiTokens()).toEqual(STORED_TOKENS);
    view.unmount();
  });

  it('waits for unlock and retries instead of showing sign-in when SecureStore is unreadable', async () => {
    const { SessionProvider, useSession, setAuthApi } = await loadStack();
    setAuthApi(createAuthApiMock(async () => USER));
    secureStoreMock.getItemAsync.mockRejectedValueOnce(new Error('device locked'));
    const view = renderStatus(SessionProvider, useSession);
    await act(async () => {});
    expect(view.getByTestId('status').textContent).toBe('loading');
    expect(secureStoreMock.deleteItemAsync).not.toHaveBeenCalled();
    await act(async () => { appState.change('active'); });
    await waitFor(() => expect(view.getByTestId('status').textContent).toBe('signed_in'));
    view.unmount();
  });

  it('does not sign out after a session metadata write fails', async () => {
    const { SessionProvider, useSession, setAuthApi } = await loadStack();
    setAuthApi(createAuthApiMock(async () => USER));
    secureStoreMock.setItemAsync.mockRejectedValueOnce(new Error('storage unavailable'));
    const view = renderStatus(SessionProvider, useSession);
    await waitFor(() => expect(view.getByTestId('status').textContent).toBe('signed_in'));
    expect(secureStoreMock.deleteItemAsync).not.toHaveBeenCalled();
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
