import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('EXPO_PUBLIC_AUTH_STUB_MODE', 'false');
  vi.stubEnv('EXPO_PUBLIC_AUTH_API_BASE_URL', 'https://api.test.local');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('remote account lifecycle', () => {
  it('includes the device push token in logout so the server can clean up after a failed unregister', async () => {
    const { getAuthApi } = await import('@/features/auth/auth-api');
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await getAuthApi().logout('session-token', 'refresh-token', 'ExpoPushToken[synthetic-device]');
    expect(fetchMock).toHaveBeenCalledWith('https://api.test.local/v1/auth/logout', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ refreshToken: 'refresh-token', expoPushToken: 'ExpoPushToken[synthetic-device]' }),
    }));
  });

  it.each(['deleteAccount', 'revokeAllSessions', 'logout'] as const)('%s reports HTTP failure instead of false success', async (method) => {
    const { getAuthApi } = await import('@/features/auth/auth-api');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({}, { status: 503 })));
    await expect(getAuthApi()[method]('session-token')).rejects.toThrow('Unable to complete account request');
  });

  it('bounds a stalled global sign-out request so the user can retry', async () => {
    const { getAuthApi } = await import('@/features/auth/auth-api');
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
      signal = options.signal;
      return new Promise<Response>(() => {});
    }));
    const pending = expect(getAuthApi().revokeAllSessions('session-token')).rejects.toMatchObject({ code: 'NETWORK_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(30_000);
    await pending;
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
