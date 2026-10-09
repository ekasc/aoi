import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The seeded sky uploads through the real seal path, so the number it declares
 * to the server has to be the sealed ciphertext's length. It used to declare the
 * plaintext's, which is short by the GCM tag: the reservation, the completion
 * head-check, and the stored metadata all silently disagreed with the object.
 *
 * The assertion is against the bytes actually handed to `putObject`, not against
 * a tag size, so it stays true if the framing ever changes.
 */

const PLAINTEXT_LENGTH = new TextEncoder().encode('jpeg-bytes').length;

vi.mock('expo-asset', () => ({
  Asset: {
    fromModule: () => ({
      downloadAsync: async () => undefined,
      localUri: 'file://seed.jpg',
      uri: 'file://seed.jpg',
    }),
  },
}));

vi.mock('@/features/album/photo-bytes', () => ({
  readPhotoBytes: async () => new TextEncoder().encode('jpeg-bytes'),
}));

const client = vi.hoisted(() => ({
  createIntent: vi.fn(async () => ({ mediaId: 'm-1', uploadUrl: 'stub://u', expiresInSec: 3600 })),
  putObject: vi.fn(async () => undefined),
  complete: vi.fn(async () => undefined),
  list: vi.fn(async () => [] as unknown[]),
}));

vi.mock('@/features/album/album-session', () => ({
  establishAlbumSession: async () => ({
    status: 'ready',
    spaceKey: new Uint8Array(32).fill(7),
    device: {},
    client: {
      createIntent: client.createIntent,
      putObject: client.putObject,
      complete: client.complete,
      list: client.list,
    },
  }),
}));

const { seedDevSkyPhotos } = await import('@/features/dev/dev-seed-sky');

describe('the dev sky seed', () => {
  beforeEach(() => {
    client.createIntent.mockClear();
    client.putObject.mockClear();
    client.complete.mockClear();
    client.list.mockClear();
    client.list.mockResolvedValue([]);
  });

  it('declares the sealed ciphertext length, not the plaintext length', async () => {
    await seedDevSkyPhotos('space-1', 'user-1');

    const intents = client.createIntent.mock.calls;
    const uploads = client.putObject.mock.calls;
    expect(intents.length).toBeGreaterThan(0);
    expect(uploads).toHaveLength(intents.length);

    for (let index = 0; index < intents.length; index += 1) {
      const declared = (intents[index][0] as { byteLength: number }).byteLength;
      const uploaded = (uploads[index][1] as Uint8Array).length;
      expect(declared).toBe(uploaded);
      // The ciphertext is the plaintext plus the authentication tag, so a
      // plaintext length here is the specific bug this guards.
      expect(declared).toBeGreaterThan(PLAINTEXT_LENGTH);
    }
  });
});
