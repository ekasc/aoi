import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AlbumMediaRecord } from '@aoi/shared';

import { createAlbumPhotoStore } from '@/features/album/album-photo-store';

const record = (id: string): AlbumMediaRecord => ({
  id,
  wrappedKey: { nonce: 'n', ciphertext: 'c' },
  sealedNonce: 'sealed-n',
  createdAt: '2026-01-01T00:00:00.000Z',
  byteLength: 3,
  mimeType: 'image/jpeg',
  width: 40,
  height: 30,
});

afterEach(() => vi.restoreAllMocks());

describe('the album photo store', () => {
  it('decrypts once and reuses the cached copy on the next list', async () => {
    const fetchObject = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const open = vi.fn(() => new Uint8Array([9, 9]));
    const store = createAlbumPhotoStore({ spaceId: 'space-1', fetchObject, open });

    const first = await store.list([record('p1')]);
    expect(first).toEqual([{ id: 'p1', addedAt: '2026-01-01T00:00:00.000Z', uri: expect.stringContaining('blob:'), width: 40, height: 30 }]);
    expect(fetchObject).toHaveBeenCalledOnce();

    const second = await store.list([record('p1')]);
    expect(second[0].uri).toBe(first[0].uri);
    expect(fetchObject).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledOnce();
  });

  it('skips a photo it cannot fetch or open without emptying the sky', async () => {
    const fetchObject = vi.fn(async (id: string) => {
      if (id === 'bad') throw new Error('corrupt');
      return new Uint8Array([1]);
    });
    const open = vi.fn(() => new Uint8Array([2]));
    const store = createAlbumPhotoStore({ spaceId: 'space-1', fetchObject, open });

    const photos = await store.list([record('good'), record('bad')]);
    expect(photos.map((photo) => photo.id)).toEqual(['good']);
  });

  it('throws when records exist but none could be opened', async () => {
    // An unreadable archive and an empty one must not look the same. The screen
    // turns this throw into a visible failure with a retry; a returned empty
    // list would show "no photos" over an archive it could not decrypt.
    const store = createAlbumPhotoStore({
      spaceId: 'space-1',
      fetchObject: async () => { throw new Error('unreachable'); },
      open: () => new Uint8Array([2]),
    });

    await expect(store.list([record('p1')])).rejects.toThrow();
  });

  it('stays an empty list for a genuinely empty album', async () => {
    const store = createAlbumPhotoStore({
      spaceId: 'space-1',
      fetchObject: async () => new Uint8Array([1]),
      open: () => new Uint8Array([2]),
    });

    expect(await store.list([])).toEqual([]);
  });

  it('revokes the cached URL on removal and on dispose', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const store = createAlbumPhotoStore({ spaceId: 'space-1', fetchObject: async () => new Uint8Array([1]), open: () => new Uint8Array([2]) });

    const [one, two] = await store.list([record('p1'), record('p2')]);
    await store.removeCached('p1');
    expect(revoke).toHaveBeenCalledWith(one.uri);

    store.dispose();
    expect(revoke).toHaveBeenCalledWith(two.uri);
  });
});
