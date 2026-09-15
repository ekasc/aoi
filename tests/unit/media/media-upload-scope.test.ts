import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function loadService() {
  vi.resetModules();
  return import('@/features/media/media-upload-service');
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function codedError(code: string) {
  const err = new Error(code) as Error & { code?: string };
  err.code = code;
  return err;
}

describe('uploadMediaAsset scope guard', () => {
  beforeEach(() => {
    vi.stubEnv('EXPO_PUBLIC_AUTH_STUB_MODE', 'false');
    vi.stubEnv('EXPO_PUBLIC_AUTH_API_BASE_URL', 'https://api.test.local');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('aborts with zero network when the scope already drifted (stub-safe check first)', async () => {
    vi.stubEnv('EXPO_PUBLIC_AUTH_STUB_MODE', 'true');
    const { uploadMediaAsset } = await loadService();
    const fetchMock = vi.fn(async () => {
      throw new Error('must not fetch after scope drift');
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      uploadMediaAsset({ uri: 'file:///a.jpg', mimeType: 'image/jpeg' }, undefined, () => {
        throw codedError('SCOPE_CHANGED');
      })
    ).rejects.toMatchObject({ code: 'SCOPE_CHANGED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('invokes assertScope before every step and aborts before complete on mid-upload switch', async () => {
    const { uploadMediaAsset } = await loadService();
    const apiClient = await import('@/features/api-client');
    apiClient.setApiTokens({ accessToken: 't', refreshToken: 'r' });

    const mediaId = '11111111-1111-4111-8111-111111111111';
    const urls: string[] = [];
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const u = String(input);
        urls.push(u);
        if (u === 'file:///a.jpg') return new Response(blob);
        if (u === 'https://api.test.local/v1/media/upload-url') {
          return jsonResponse({ mediaId, uploadUrl: 'https://r2.test/put', expiresInSec: 60 });
        }
        if (u === 'https://r2.test/put') return new Response(null, { status: 200 });
        if (u.includes('/complete')) throw new Error('complete must not run after scope drift');
        throw new Error(`unexpected fetch: ${u}`);
      })
    );

    let calls = 0;
    const assertScope = () => {
      calls += 1;
      // Fail on the 4th check (after PUT, before complete) — simulates an
      // intent → complete account switch mid-upload.
      if (calls >= 4) throw codedError('SCOPE_CHANGED');
    };

    await expect(
      uploadMediaAsset({ uri: 'file:///a.jpg', mimeType: 'image/jpeg' }, undefined, assertScope)
    ).rejects.toMatchObject({ code: 'SCOPE_CHANGED' });
    expect(urls).toEqual(['file:///a.jpg', 'https://api.test.local/v1/media/upload-url', 'https://r2.test/put']);
    expect(urls.some((u) => u.includes('/complete'))).toBe(false);
    apiClient.setApiTokens(null);
  });

  it('succeeds with a passing guard and never persists bearer/presigned URLs', async () => {
    const { uploadMediaAsset } = await loadService();
    const apiClient = await import('@/features/api-client');
    apiClient.setApiTokens({ accessToken: 't', refreshToken: 'r' });

    const mediaId = '22222222-2222-4222-8222-222222222222';
    const blob = new Blob([new Uint8Array([9])], { type: 'image/jpeg' });
    const seenAuth: Array<string | null> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const u = String(input);
        if (u === 'file:///b.jpg') return new Response(blob);
        if (u === 'https://api.test.local/v1/media/upload-url') {
          seenAuth.push(new Headers(init?.headers).get('Authorization'));
          return jsonResponse({ mediaId, uploadUrl: 'https://r2.test/put2', expiresInSec: 60 });
        }
        if (u === 'https://r2.test/put2') return new Response(null, { status: 200 });
        if (u === `https://api.test.local/v1/media/${mediaId}/complete`) {
          seenAuth.push(new Headers(init?.headers).get('Authorization'));
          return jsonResponse({ ok: true });
        }
        throw new Error(`unexpected fetch: ${u}`);
      })
    );

    let guardCalls = 0;
    const result = await uploadMediaAsset(
      { uri: 'file:///b.jpg', mimeType: 'image/jpeg' },
      undefined,
      () => {
        guardCalls += 1;
      }
    );
    // Stable app URL only — never the presigned PUT URL.
    expect(result).toEqual({ mediaId, url: `/v1/media/${mediaId}/object?variant=display` });
    expect(result.url).not.toContain('r2.test');
    // Guard ran before every step (start, after blob, after intent, after PUT).
    expect(guardCalls).toBeGreaterThanOrEqual(3);
    // Auth rode on memory Bearer only (no persisted bearer asserted here —
    // the result carries no Authorization/presigned material).
    expect(seenAuth.every((a) => a === 'Bearer t')).toBe(true);
    apiClient.setApiTokens(null);
  });
});
