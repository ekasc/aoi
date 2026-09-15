import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Token-plumbing regression pins for `features/api-client.ts`.
 *
 * The api-client reads auth mode from module scope, so these tests re-import
 * the module with EXPO_PUBLIC_AUTH_STUB_MODE=false (real remote mode) after
 * stubbing the env. They pin the exact behavior that previously broke remote
 * mode: session-context now calls setApiTokens on restore/sign-in, and
 * apiFetch sends the Bearer header + 401-refresh-retry.
 */

async function loadApiClient() {
  vi.resetModules();
  return import('@/features/api-client');
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('api-client token plumbing (remote mode)', () => {
  beforeEach(() => {
    vi.stubEnv('EXPO_PUBLIC_AUTH_STUB_MODE', 'false');
    vi.stubEnv('EXPO_PUBLIC_AUTH_API_BASE_URL', 'https://api.test.local');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('sends the Authorization header when tokens are set', async () => {
    const { setApiTokens, apiFetch } = await loadApiClient();
    setApiTokens({ accessToken: 'token-1', refreshToken: 'refresh-1' });

    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/v1/spaces/current');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.test.local/v1/spaces/current');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer token-1');
  });

  it('sends no Authorization header when no tokens are set', async () => {
    const { apiFetch } = await loadApiClient();

    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/v1/spaces/current');

    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init.headers).get('Authorization')).toBeNull();
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    const { setApiTokens, apiFetch } = await loadApiClient();
    setApiTokens({ accessToken: 'stale-token', refreshToken: 'refresh-1' });

    // Record url + Authorization at call time: apiFetch reuses one headers
    // object across the retry, so asserting on mock.calls after the fact
    // would see the mutated (fresh) header on every call.
    const calls: Array<{ url: string; authorization: string | null; body: unknown }> = [];
    const responses = [
      jsonResponse({ error: { message: 'expired' } }, 401),
      jsonResponse({
        accessToken: 'fresh-token',
        refreshToken: 'refresh-2',
        expiresInSec: 3600,
      }),
      jsonResponse({ ok: true }),
    ];
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      calls.push({
        url: String(url),
        authorization: new Headers(init?.headers).get('Authorization'),
        body: init?.body,
      });
      const next = responses.shift();
      if (!next) {
        throw new Error('unexpected extra fetch');
      }
      return next;
    });

    vi.stubGlobal('fetch', fetchMock);

    const result = await apiFetch<{ ok: boolean }>('/v1/spaces/current');

    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(3);

    // First call carries the stale token; the retry carries the fresh one.
    expect(calls[0].url).toBe('https://api.test.local/v1/spaces/current');
    expect(calls[0].authorization).toBe('Bearer stale-token');

    expect(calls[1].url).toBe('https://api.test.local/v1/auth/refresh');
    expect(calls[1].body).toEqual(JSON.stringify({ refreshToken: 'refresh-1' }));

    expect(calls[2].url).toBe('https://api.test.local/v1/spaces/current');
    expect(calls[2].authorization).toBe('Bearer fresh-token');
  });

  it('does not retry a 401 when there is no refresh token', async () => {
    const { setApiTokens, apiFetch } = await loadApiClient();
    setApiTokens({ accessToken: 'token-1' });

    const fetchMock = vi.fn(async () => jsonResponse({ error: { message: 'expired' } }, 401));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiFetch('/v1/spaces/current')).rejects.toThrow('expired');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('request A 401 with switch to B never refreshes/retries on B credentials', async () => {
    const { setApiTokens, apiFetch, getApiTokens } = await loadApiClient();
    setApiTokens({ accessToken: 'token-A', refreshToken: 'refresh-A' });

    const calls: Array<{ url: string; authorization: string | null }> = [];
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get('Authorization');
      calls.push({ url: String(url), authorization: auth });
      // First call (A) 401s. Switch to B before any refresh could run, then
      // assert no refresh/retry touches B credentials.
      if (calls.length === 1) {
        setApiTokens({ accessToken: 'token-B', refreshToken: 'refresh-B' });
        return jsonResponse({ error: { message: 'expired' } }, 401);
      }
      throw new Error(`unexpected extra fetch: ${String(url)} ${auth}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiFetch('/v1/spaces/current')).rejects.toThrow('expired');
    // Only the original A request ran — zero refresh, zero retry on B.
    expect(calls).toHaveLength(1);
    expect(calls[0].authorization).toBe('Bearer token-A');
    // Live session is still B (stale A refresh never published).
    expect(getApiTokens()).toEqual({ accessToken: 'token-B', refreshToken: 'refresh-B' });
  });

  it('refresh A finishing after switch to B never publishes stale tokens', async () => {
    const { setApiTokens, apiFetch, getApiTokens } = await loadApiClient();
    setApiTokens({ accessToken: 'token-A', refreshToken: 'refresh-A' });

    let resolveRefresh!: (r: Response) => void;
    const refreshGate = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    const calls: Array<{ url: string; authorization: string | null }> = [];
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, authorization: new Headers(init?.headers).get('Authorization') });
      if (u.endsWith('/v1/spaces/current')) {
        return jsonResponse({ error: { message: 'expired' } }, 401);
      }
      if (u.endsWith('/v1/auth/refresh')) {
        // Hold the refresh open so the test can switch accounts mid-flight.
        return refreshGate;
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const pending = apiFetch('/v1/spaces/current').catch((e: Error) => e);
    // Let the initial 401 + refresh start, then switch to B mid-refresh.
    await new Promise((r) => setTimeout(r, 10));
    setApiTokens({ accessToken: 'token-B', refreshToken: 'refresh-B' });
    // Refresh A finally resolves with fresh-A tokens — must be dropped.
    resolveRefresh(
      jsonResponse({ accessToken: 'fresh-A', refreshToken: 'refresh-A2', expiresInSec: 3600 })
    );
    const err = (await pending) as Error;
    expect(String((err as Error).message)).toContain('expired');
    // No retry after the switch (only initial + refresh ran).
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.test.local/v1/spaces/current',
      'https://api.test.local/v1/auth/refresh',
    ]);
    // B untouched by stale A refresh.
    expect(getApiTokens()).toEqual({ accessToken: 'token-B', refreshToken: 'refresh-B' });
  });
});
