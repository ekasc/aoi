import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('EXPO_PUBLIC_AUTH_STUB_MODE', 'false');
  vi.stubEnv('EXPO_PUBLIC_AUTH_API_BASE_URL', 'https://api.test.local');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('API deadline wiring', () => {
  it.each(['json', 'bytes'] as const)('bounds a stalled %s response body', async (kind) => {
    const { apiFetch, apiFetchBytes } = await import('@/features/api-client');
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      signal = init.signal;
      return new Response(new ReadableStream());
    }));
    const pending = kind === 'json' ? apiFetch('/slow') : apiFetchBytes('/slow');
    const rejected = expect(pending).rejects.toMatchObject({ code: 'NETWORK_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never publishes tokens or retries when refresh resolves after its deadline', async () => {
    const { apiFetch, setApiTokens, getApiTokens } = await import('@/features/api-client');
    vi.useFakeTimers();
    const original = { accessToken: 'old', refreshToken: 'refresh' };
    setApiTokens(original);
    let finishRefresh: (response: Response) => void = () => {};
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/v1/auth/refresh')) {
        return new Promise<Response>((resolve) => { finishRefresh = resolve; });
      }
      return Response.json({ error: { message: 'expired' } }, { status: 401 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const rejected = expect(apiFetch('/slow')).rejects.toMatchObject({ code: 'NETWORK_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    finishRefresh(Response.json({ accessToken: 'late', refreshToken: 'late-refresh', expiresInSec: 3600 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(getApiTokens()).toEqual(original);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not publish malformed refresh responses', async () => {
    const { apiFetch, setApiTokens, getApiTokens } = await import('@/features/api-client');
    const original = { accessToken: 'old', refreshToken: 'refresh' };
    setApiTokens(original);
    const fetchMock = vi.fn(async (url: string) => url.endsWith('/v1/auth/refresh')
      ? Response.json({ accessToken: 5, expiresInSec: 'invalid' })
      : Response.json({ error: { message: 'expired' } }, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(apiFetch('/slow')).rejects.toThrow('expired');
    expect(getApiTokens()).toEqual(original);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
