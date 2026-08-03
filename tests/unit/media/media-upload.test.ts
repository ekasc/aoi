import { act, renderHook } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

describe('useMediaUpload', () => {
  test('stub mode returns the local URI directly', async () => {
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
      expect(resultUrl).toBe(uri);
    });

    expect(result.current.mediaUrl).toBe(uri);
    expect(result.current.error).toBeNull();
  });
});
