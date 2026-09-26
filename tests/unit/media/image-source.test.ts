import { beforeEach, describe, expect, it, vi } from 'vitest';

const getApiBaseUrl = vi.fn();
const getApiTokens = vi.fn();
const resolveStagedUri = vi.fn((value: string) => `file:///documents/${value}`);

vi.mock('@/features/api-client', () => ({ getApiBaseUrl, getApiTokens }));
vi.mock('@/features/composer/staged-uri', () => ({ resolveStagedUri }));

describe('imageSourceForUri', () => {
  beforeEach(() => {
    getApiBaseUrl.mockReturnValue('https://api.example.test');
    getApiTokens.mockReturnValue({ accessToken: 'secret-token' });
    resolveStagedUri.mockClear();
  });

  it('resolves protected media paths against the configured API with auth', async () => {
    const { imageSourceForUri } = await import('@/features/media/image-source');
    expect(imageSourceForUri('/v1/media/id/object?variant=display')).toEqual({
      uri: 'https://api.example.test/v1/media/id/object?variant=display',
      headers: { Authorization: 'Bearer secret-token' },
    });
  });

  it('does not send credentials to a foreign public image', async () => {
    const { imageSourceForUri } = await import('@/features/media/image-source');
    expect(imageSourceForUri('https://cdn.example.test/seed.jpg')).toEqual({
      uri: 'https://cdn.example.test/seed.jpg',
    });
  });

  it('authenticates an absolute URL on the configured media origin', async () => {
    const { imageSourceForUri } = await import('@/features/media/image-source');
    expect(imageSourceForUri('https://api.example.test/v1/media/id/object?variant=display')).toEqual({
      uri: 'https://api.example.test/v1/media/id/object?variant=display',
      headers: { Authorization: 'Bearer secret-token' },
    });
  });

  it('does not authenticate a foreign URL that resembles a protected media path', async () => {
    const { imageSourceForUri } = await import('@/features/media/image-source');
    expect(imageSourceForUri('https://cdn.example.test/v1/media/id/object?variant=display')).toEqual({
      uri: 'https://cdn.example.test/v1/media/id/object?variant=display',
    });
  });

  it('keeps staged local paths local', async () => {
    const { imageSourceForUri } = await import('@/features/media/image-source');
    expect(imageSourceForUri('composer/user/space/staged/photo.jpg')).toEqual({
      uri: 'file:///documents/composer/user/space/staged/photo.jpg',
    });
    expect(resolveStagedUri).toHaveBeenCalledWith('composer/user/space/staged/photo.jpg');
  });

  it('omits protected media when session auth or API configuration is unavailable', async () => {
    const { imageSourceForUri } = await import('@/features/media/image-source');
    getApiTokens.mockReturnValue(null);
    expect(imageSourceForUri('/v1/media/id/object?variant=display')).toBeNull();
    getApiTokens.mockReturnValue({ accessToken: 'secret-token' });
    getApiBaseUrl.mockReturnValue('');
    expect(imageSourceForUri('/v1/media/id/object?variant=display')).toBeNull();
  });
});
