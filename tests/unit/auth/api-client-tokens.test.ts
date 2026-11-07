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

  it.each([503, 429, 'offline'])('keeps the session when refresh fails with %s', async (failure) => {
    const { setApiTokens, apiFetch, setUnauthorizedHandler } = await loadApiClient();
    const revoked = vi.fn();
    setUnauthorizedHandler(revoked);
    setApiTokens({ accessToken: 'old', refreshToken: 'refresh' });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/refresh')) {
        if (failure === 'offline') throw new TypeError('offline');
        return jsonResponse({}, failure);
      }
      return jsonResponse({ error: { message: 'expired' } }, 401);
    }));
    await expect(apiFetch('/v1/spaces/current')).rejects.toThrow();
    expect(revoked).not.toHaveBeenCalled();
  });

  it('does not sign out account B for a late account A 401', async () => {
    const { setApiTokens, apiFetch, setUnauthorizedHandler } = await loadApiClient();
    const revoked = vi.fn();
    setUnauthorizedHandler(revoked);
    setApiTokens({ accessToken: 'A', refreshToken: 'refresh-A' });
    vi.stubGlobal('fetch', vi.fn(async () => {
      setApiTokens({ accessToken: 'B', refreshToken: 'refresh-B' });
      return jsonResponse({}, 401);
    }));
    await expect(apiFetch('/v1/spaces/current')).rejects.toThrow();
    expect(revoked).not.toHaveBeenCalled();
  });

  it('rejects account A data that arrives after switching to account B', async () => {
    const { setApiTokens, apiFetch } = await loadApiClient();
    setApiTokens({ accessToken: 'A', refreshToken: 'refresh-A' });
    let finish: (response: Response) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
    const pending = apiFetch('/v1/spaces/current');
    setApiTokens({ accessToken: 'B', refreshToken: 'refresh-B' });
    finish(jsonResponse({ space: { id: 'private-space-A' } }));
    await expect(pending).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  });

  it('rejects an old request after an A-B-A switch even when the original token object is reused', async () => {
    const { setApiTokens, apiFetch } = await loadApiClient();
    const original = { accessToken: 'A', refreshToken: 'refresh-A' };
    setApiTokens(original);
    let finish: (response: Response) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
    const pending = apiFetch('/v1/spaces/current');
    setApiTokens({ accessToken: 'B', refreshToken: 'refresh-B' });
    setApiTokens(original);
    finish(jsonResponse({ space: { id: 'obsolete-A' } }));
    await expect(pending).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  });

  it('keeps in-flight successful reads valid when only the same session credential is renewed', async () => {
    const { setApiTokens, apiFetch } = await loadApiClient();
    setApiTokens({ accessToken: 'old', refreshToken: 'refresh' });
    let finish: (response: Response) => void = () => {};
    let renewalRequests = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/slow')) return new Promise<Response>((resolve) => { finish = resolve; });
      if (url.endsWith('/refresh')) return jsonResponse({ accessToken: 'fresh', refreshToken: 'fresh-refresh', expiresInSec: 3600 });
      renewalRequests += 1;
      return renewalRequests === 1 ? jsonResponse({}, 401) : jsonResponse({ ok: true });
    }));
    const pending = apiFetch('/v1/slow');
    await expect(apiFetch('/v1/renew')).resolves.toEqual({ ok: true });
    finish(jsonResponse({ ok: true }));
    await expect(pending).resolves.toEqual({ ok: true });
  });

  it('rejects account A bytes if the account switches while the response body is reading', async () => {
    const { setApiTokens, apiFetchBytes } = await loadApiClient();
    setApiTokens({ accessToken: 'A', refreshToken: 'refresh-A' });
    let finishBody: (value: Uint8Array) => void = () => {};
    const body = new ReadableStream<Uint8Array>({
      start(controller) { finishBody = (value) => { controller.enqueue(value); controller.close(); }; },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
    const pending = apiFetchBytes('/v1/media/private/object');
    await Promise.resolve();
    setApiTokens({ accessToken: 'B', refreshToken: 'refresh-B' });
    finishBody(new Uint8Array([1, 2, 3]));
    await expect(pending).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
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

  it('shares one refresh between concurrent 401s of the same session', async () => {
    // The regression: two requests 401ing together each POSTed a refresh.
    // The server reads a rotated-out refresh token presented twice as theft
    // and revokes every session. Concurrent losers must join one flight.
    const { setApiTokens, apiFetch, getApiTokens } = await loadApiClient();
    setApiTokens({ accessToken: 'stale-token', refreshToken: 'refresh-1' });

    let resolveRefresh!: (r: Response) => void;
    const refreshGate = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    const calls: Array<{ url: string; authorization: string | null }> = [];
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, authorization: new Headers(init?.headers).get('Authorization') });
      if (u.endsWith('/v1/auth/refresh')) {
        return refreshGate;
      }
      if (calls.filter((c) => !c.url.endsWith('/v1/auth/refresh')).length <= 2) {
        return jsonResponse({ error: { message: 'expired' } }, 401);
      }
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = apiFetch('/v1/a');
    const second = apiFetch('/v1/b');
    // Let both initial 401s land: the second must find the first's flight.
    // Registration is synchronous, so this ordering is deterministic.
    await new Promise((r) => setTimeout(r, 10));
    expect(calls.filter((c) => c.url.endsWith('/v1/auth/refresh'))).toHaveLength(1);

    resolveRefresh(
      jsonResponse({ accessToken: 'fresh-token', refreshToken: 'refresh-2', expiresInSec: 3600 })
    );
    await expect(first).resolves.toEqual({ ok: true });
    await expect(second).resolves.toEqual({ ok: true });

    const retries = calls.filter((c) => !c.url.endsWith('/v1/auth/refresh')).slice(2);
    expect(retries.map((c) => c.authorization)).toEqual(['Bearer fresh-token', 'Bearer fresh-token']);
    expect(getApiTokens()).toEqual({
      accessToken: 'fresh-token',
      refreshToken: 'refresh-2',
      expiresAt: expect.any(String),
    });
  });

  it('retries a loser whose 401 lands after our own rotation completed', async () => {
    // The reload race: space wins the refresh while moments is still in
    // flight; moments 401s after the rotation published. Without the
    // lineage record it would surface a stale 401 ("Offline") until a
    // manual retry, even though valid tokens exist.
    const { setApiTokens, apiFetch } = await loadApiClient();
    setApiTokens({ accessToken: 'stale-token', refreshToken: 'refresh-1' });

    let releaseSecond401!: () => void;
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond401 = resolve;
    });
    const counts = new Map<string, number>();
    const authorizations: Array<string | null> = [];
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      const n = (counts.get(u) ?? 0) + 1;
      counts.set(u, n);
      authorizations.push(new Headers(init?.headers).get('Authorization'));
      if (u.endsWith('/v1/auth/refresh')) {
        return jsonResponse({
          accessToken: 'fresh-token',
          refreshToken: 'refresh-2',
          expiresInSec: 3600,
        });
      }
      if (u.endsWith('/v1/second') && n === 1) {
        await secondGate;
        return jsonResponse({ error: { message: 'expired' } }, 401);
      }
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = apiFetch('/v1/first');
    const second = apiFetch('/v1/second');
    await expect(first).resolves.toEqual({ ok: true });
    // The rotation above completed while the second request was in flight.
    releaseSecond401();
    await expect(second).resolves.toEqual({ ok: true });

    // Exactly one refresh POST; the late loser retried with its lineage.
    expect(counts.get('https://api.test.local/v1/auth/refresh')).toBe(1);
    expect(counts.get('https://api.test.local/v1/second')).toBe(2);
  });

  it('still 401s after a switch even when a rotation record exists', async () => {
    // Rotation record proves lineage, not identity: after A rotates and the
    // reader switches to B, a stale in-flight A request must still fail
    // rather than replay anything anywhere.
    const { setApiTokens, apiFetch, getApiTokens } = await loadApiClient();
    setApiTokens({ accessToken: 'stale-A', refreshToken: 'refresh-A' });

    let releaseStale401!: () => void;
    const staleGate = new Promise<void>((resolve) => {
      releaseStale401 = resolve;
    });
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      calls.push(u);
      if (u.endsWith('/v1/auth/refresh')) {
        return jsonResponse({
          accessToken: 'fresh-A',
          refreshToken: 'refresh-A2',
          expiresInSec: 3600,
        });
      }
      if (u.endsWith('/v1/stale')) {
        if (calls.filter((c) => c.endsWith('/v1/stale')).length > 1) {
          throw new Error('stale request must never retry');
        }
        await staleGate;
        return jsonResponse({ error: { message: 'expired' } }, 401);
      }
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    const staleReq = apiFetch('/v1/stale').catch((e: Error) => e);
    // Rotate A's lineage fully while the stale request is in flight.
    await expect(apiFetch('/v1/rotator')).resolves.toEqual({ ok: true });
    // Then switch accounts before the stale 401 lands.
    setApiTokens({ accessToken: 'token-B', refreshToken: 'refresh-B' });
    releaseStale401();

    const err = (await staleReq) as Error;
    expect(String(err.message)).toContain('expired');
    expect(calls.filter((c) => c.endsWith('/v1/stale'))).toHaveLength(1);
    expect(getApiTokens()).toEqual({ accessToken: 'token-B', refreshToken: 'refresh-B' });
  });

  it('a joiner never replays when the account switches mid-refresh', async () => {
    // A1 initiates, A2 joins, then the reader switches to B before the
    // refresh lands: both must fail closed on the original 401s.
    const { setApiTokens, apiFetch, getApiTokens } = await loadApiClient();
    setApiTokens({ accessToken: 'stale-A', refreshToken: 'refresh-A' });

    let resolveRefresh!: (r: Response) => void;
    const refreshGate = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      calls.push(u);
      if (u.endsWith('/v1/auth/refresh')) {
        return refreshGate;
      }
      if (calls.filter((c) => !c.endsWith('/v1/auth/refresh')).length > 2) {
        throw new Error('must never retry after a switch');
      }
      return jsonResponse({ error: { message: 'expired' } }, 401);
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = apiFetch('/v1/a').catch((e: Error) => e);
    const second = apiFetch('/v1/b').catch((e: Error) => e);
    await new Promise((r) => setTimeout(r, 10));
    setApiTokens({ accessToken: 'token-B', refreshToken: 'refresh-B' });
    resolveRefresh(
      jsonResponse({ accessToken: 'fresh-A', refreshToken: 'refresh-A2', expiresInSec: 3600 })
    );

    expect(String((await first as Error).message)).toContain('expired');
    expect(String((await second as Error).message)).toContain('expired');
    expect(calls).toEqual([
      'https://api.test.local/v1/a',
      'https://api.test.local/v1/b',
      'https://api.test.local/v1/auth/refresh',
    ]);
    expect(getApiTokens()).toEqual({ accessToken: 'token-B', refreshToken: 'refresh-B' });
  });
});
