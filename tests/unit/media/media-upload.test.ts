import { act, renderHook } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

describe('useMediaUpload', () => {
  test('stub mode returns the local URI directly with no media id', async () => {
    vi.resetModules();
    vi.stubEnv('EXPO_PUBLIC_AUTH_STUB_MODE', 'true');

    const { useMediaUpload } = await import(
      '../../../features/media/use-media-upload'
    );

    const { result } = renderHook(() => useMediaUpload());
    const uri = 'file:///test/photo.jpg';
    const mimeType = 'image/jpeg';

    await act(async () => {
      const resultUrl = await result.current.uploadImage({ uri, mimeType });
      expect(resultUrl).toEqual({ mediaId: null, url: uri });
    });

    expect(result.current.mediaUrl).toBe(uri);
    expect(result.current.error).toBeNull();
  });

  test('remote mode uploads via intent → presigned PUT → complete and returns a stable media id + URL', async () => {
    vi.resetModules();
    vi.stubEnv('EXPO_PUBLIC_AUTH_STUB_MODE', 'false');
    vi.stubEnv(
      'EXPO_PUBLIC_AUTH_API_BASE_URL',
      'https://api.test.local'
    );

    const mediaId = '00000000-0000-4000-8000-0000000000a1';
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    // Session tokens are present so apiFetch sends Authorization.
    const apiClient = await import('../../../features/api-client');
    apiClient.setApiTokens({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    // Blob for the local file fetch.
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      if (String(input) === 'file:///test/photo.jpg') {
        return new Response(blob);
      }
      if (String(input) === 'https://api.test.local/v1/media/upload-url') {
        return Response.json({
          mediaId,
          uploadUrl: 'https://r2.test.local/presigned-put',
          expiresInSec: 3600,
          headers: { 'Content-Type': 'image/jpeg' },
        });
      }
      if (String(input) === 'https://r2.test.local/presigned-put') {
        return new Response(null, { status: 200 });
      }
      if (String(input) === 'https://api.test.local/v1/media/00000000-0000-4000-8000-0000000000a1/complete') {
        return Response.json({ ok: true });
      }
      throw new Error(`unexpected fetch: ${String(input)}`);
    }));

    const { useMediaUpload } = await import(
      '../../../features/media/use-media-upload'
    );

    const { result } = renderHook(() => useMediaUpload());

    await act(async () => {
      const outcome = await result.current.uploadImage({
        uri: 'file:///test/photo.jpg',
        mimeType: 'image/jpeg',
      });

      // The ONLY thing persisted is the stable media id + app URL — never a
      // presigned URL.
      expect(outcome).toEqual({
        mediaId,
        url: `/v1/media/${mediaId}/object?variant=display`,
      });
    });

    // The flow hit the three contract endpoints in order.
    const urls = calls.map((c) => c.url);
    expect(urls[0]).toBe('file:///test/photo.jpg');
    expect(urls[1]).toBe('https://api.test.local/v1/media/upload-url');
    expect(urls[2]).toBe('https://r2.test.local/presigned-put');
    expect(urls[3]).toBe(
      `https://api.test.local/v1/media/${mediaId}/complete`
    );
    // There is no download-url call anywhere (removed contract).
    expect(urls.some((u) => u.includes('download-url'))).toBe(false);
    expect(result.current.mediaUrl).toBe(
      `/v1/media/${mediaId}/object?variant=display`
    );
    expect(result.current.state).toBe('done');
    expect(result.current.error).toBeNull();

    apiClient.setApiTokens(null);
    vi.unstubAllGlobals();
  });

  test('quota rejection throws the coded error for upgrade interception', async () => {
    vi.resetModules();
    vi.stubEnv('EXPO_PUBLIC_AUTH_STUB_MODE', 'false');
    vi.stubEnv(
      'EXPO_PUBLIC_AUTH_API_BASE_URL',
      'https://api.test.local'
    );

    const apiClient = await import('../../../features/api-client');
    apiClient.setApiTokens({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === 'file:///test/photo.jpg') {
        return new Response(blob);
      }
      return Response.json(
        {
          error: {
            code: 'LIMIT_EXCEEDED',
            message: 'This space is out of media room',
            details: { kind: 'media_quota', usedBytes: 1, limitBytes: 2, plusLimitBytes: 3 },
          },
        },
        { status: 403 }
      );
    }));

    const { useMediaUpload, isQuotaExceededError } = await import(
      '../../../features/media/use-media-upload'
    );

    const { result } = renderHook(() => useMediaUpload());

    let thrown: unknown = null;
    await act(async () => {
      try {
        await result.current.uploadImage({ uri: 'file:///test/photo.jpg', mimeType: 'image/jpeg' });
      } catch (err) {
        thrown = err;
      }
    });

    expect(isQuotaExceededError(thrown)).toBe(true);
    expect(result.current.state).toBe('error');
    expect(result.current.error).toBe('This space is out of media room');

    apiClient.setApiTokens(null);
    vi.unstubAllGlobals();
  });
});
