import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthApi } from '@/features/auth/types';

const user = { id: 'synthetic-user-A', email: 'a@swarm.invalid', displayName: 'A' };
const tokens = { accessToken: 'synthetic-A', refreshToken: 'synthetic-refresh-A' };
const storage = vi.hoisted(() => ({ getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn() }));
vi.mock('expo-secure-store', () => storage);
vi.mock('@/features/auth/oauth-client', () => ({
  OAuthClientError: class extends Error {},
  signInWithOAuthProvider: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('EXPO_PUBLIC_AUTH_STUB_MODE', 'false');
  vi.stubEnv('EXPO_PUBLIC_AUTH_API_BASE_URL', 'https://api.swarm.invalid');
  storage.getItemAsync.mockReset().mockResolvedValue(JSON.stringify({ user, tokens }));
  storage.setItemAsync.mockReset().mockResolvedValue(undefined);
  storage.deleteItemAsync.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function stack() {
  const client = await import('@/features/api-client');
  const push = await import('@/features/push/push-api');
  const session = await import('@/features/session/session-context');
  const auth = await import('@/features/auth/auth-api');
  return { ...client, ...push, ...session, ...auth };
}

describe('push operations through the real session and transport modules', () => {
  it.each(['normal', 'renewal', 'unregister-failure'] as const)('passes the device token and live credential to logout, mode=%s', async (mode) => {
    const renewal = mode === 'renewal';
    const app = await stack();
    const requests: { method: string; authorization: string | null }[] = [];
    let tokenAtLogout: string | undefined;
    let methodAtLogout: string | undefined;
    let rejectedDelete = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
      requests.push({ method: options.method ?? 'GET', authorization: new Headers(options.headers).get('Authorization') });
      if (mode === 'unregister-failure' && options.method === 'DELETE') return Response.json({}, { status: 503 });
      if (url.endsWith('/v1/auth/refresh')) {
        return Response.json({ accessToken: 'synthetic-renewed-A', refreshToken: 'synthetic-renewed-refresh-A', expiresInSec: 3600 });
      }
      if (renewal && options.method === 'DELETE' && !rejectedDelete) {
        rejectedDelete = true;
        return Response.json({}, { status: 401 });
      }
      return Response.json({ ok: true });
    }));
    const authApi: AuthApi = {
      getSession: vi.fn(async () => user),
      signInWithAppleIdToken: vi.fn(async () => ({ user, tokens })),
      signInWithGoogleIdToken: vi.fn(async () => ({ user, tokens })),
      logout: vi.fn(async () => {
        methodAtLogout = requests.at(-1)?.method;
        tokenAtLogout = app.getApiTokens()?.accessToken;
      }),
      revokeAllSessions: vi.fn(async () => {}),
      deleteAccount: vi.fn(async () => {}),
    };
    app.setAuthApi(authApi);
    const view = renderHook(() => app.useSession(), { wrapper: app.SessionProvider });
    await waitFor(() => expect(view.result.current.status).toBe('signed_in'));
    const generation = app.getApiSessionGeneration();
    await app.registerPushToken('ExpoPushToken[synthetic-device-token]', 'ios');
    await act(async () => { await view.result.current.signOut(); });
    expect(requests.map((request) => request.method)).toEqual(renewal ? ['POST', 'DELETE', 'POST', 'DELETE'] : ['POST', 'DELETE']);
    expect(requests[1].authorization).toBe('Bearer synthetic-A');
    expect(methodAtLogout).toBe('DELETE');
    const expectedAccess = renewal ? 'synthetic-renewed-A' : tokens.accessToken;
    const expectedRefresh = renewal ? 'synthetic-renewed-refresh-A' : tokens.refreshToken;
    expect(tokenAtLogout).toBe(expectedAccess);
    expect(authApi.logout).toHaveBeenCalledWith(expectedAccess, expectedRefresh, 'ExpoPushToken[synthetic-device-token]');
    expect(authApi.logout).toHaveBeenCalledOnce();
    expect(view.result.current.status).toBe('signed_out');
    expect(app.getApiTokens()).toBeNull();
    expect(app.getApiSessionGeneration()).toBeGreaterThan(generation);
    view.unmount();
  });

  it('never changes an already-dispatched push POST from A credentials to B credentials', async () => {
    const app = await stack();
    app.setApiTokens(tokens);
    let authorization: string | null = null;
    let finish: (response: Response) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
      authorization = new Headers(options.headers).get('Authorization');
      return new Promise<Response>((resolve) => { finish = resolve; });
    }));
    const pending = expect(app.registerPushToken('ExpoPushToken[synthetic-device-token]', 'ios')).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    await waitFor(() => expect(authorization).toBe('Bearer synthetic-A'));
    app.setApiTokens({ accessToken: 'synthetic-B' });
    finish(Response.json({ ok: true }));
    await pending;
    expect(authorization).toBe('Bearer synthetic-A');
    expect(app.getApiTokens()?.accessToken).toBe('synthetic-B');
    expect(app.getLastRegisteredPushToken()).toBeNull();
  });
});
