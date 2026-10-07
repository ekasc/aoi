import { expect, it, vi } from 'vitest';

import type { AlbumMediaRecord } from '@aoi/shared';

const state = vi.hoisted(() => ({ files: new Set<string>() }));

vi.mock('expo-file-system', () => {
  class Directory {
    uri: string;
    constructor(...parts: string[]) {
      this.uri = parts.join('/');
    }
    create() {}
  }
  class File {
    uri: string;
    constructor(parent: Directory | string, name?: string) {
      this.uri = name ? `${typeof parent === 'string' ? parent : parent.uri}/${name}` : String(parent);
    }
    get exists() {
      return state.files.has(this.uri);
    }
    write() {
      state.files.add(this.uri);
    }
  }
  return { Directory, File, Paths: { document: 'documents' } };
});

const { createAlbumPhotoStore } = await import('@/features/album/album-photo-store.native');

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

it('throws when records exist but none could be opened, so the sky can say so', async () => {
  const store = createAlbumPhotoStore({
    spaceId: 'space-1',
    fetchObject: async () => {
      throw new Error('wrong key');
    },
    open: () => new Uint8Array([1]),
  });

  await expect(store.list([record('p1')])).rejects.toThrow();
});

it('stays an empty list for a genuinely empty album', async () => {
  const store = createAlbumPhotoStore({
    spaceId: 'space-2',
    fetchObject: async () => new Uint8Array([1]),
    open: () => new Uint8Array([2]),
  });

  expect(await store.list([])).toEqual([]);
});

it('keeps the readable photos when only some records fail', async () => {
  const store = createAlbumPhotoStore({
    spaceId: 'space-3',
    fetchObject: async (id: string) => {
      if (id === 'bad') {
        throw new Error('wrong key');
      }
      return new Uint8Array([1]);
    },
    open: () => new Uint8Array([2]),
  });

  const photos = await store.list([record('good'), record('bad')]);
  expect(photos.map((photo) => photo.id)).toEqual(['good']);
});
