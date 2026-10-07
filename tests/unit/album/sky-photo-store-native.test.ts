import { expect, it, vi } from 'vitest';

import { getSkyPhotoRepository } from '@/features/album/sky-photo-store.native';

const state = vi.hoisted(() => ({
  files: new Set<string>(['cache://prepared.jpg']),
  started: () => {},
  finish: () => {},
  write: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null, setItem: state.write } }));
vi.mock('@/features/album/sky-photo-import', () => ({ prepareSkyPhoto: async () => ({ uri: 'cache://prepared.jpg', width: 100, height: 100 }) }));
vi.mock('expo-file-system', () => {
  class Directory {
    uri: string;
    constructor(...parts: string[]) { this.uri = parts.join('/'); }
    create() {}
  }
  class File {
    uri: string;
    constructor(parent: Directory | string, name?: string) { this.uri = name ? `${typeof parent === 'string' ? parent : parent.uri}/${name}` : String(parent); }
    get exists() { return state.files.has(this.uri); }
    async bytes() { return new Uint8Array([1, 2, 3]); }
    copy(destination: File) {
      // Expo SDK 56+ documents copy() as asynchronous; hold it pending.
      return new Promise<void>((resolve) => {
        state.finish = () => { state.files.add(destination.uri); resolve(); };
        state.started();
      });
    }
    delete() { state.files.delete(this.uri); }
  }
  return { Directory, File, Paths: { document: 'documents' } };
});

it('waits for the native copy before deleting its source or publishing the photo', async () => {
  const copyStarted = new Promise<void>((resolve) => { state.started = resolve; });
  const repository = getSkyPhotoRepository({ userId: 'test-user', spaceId: 'test-space' });
  const importing = repository.importPhotos([{ uri: 'picker://photo' }]);
  try {
    await copyStarted;
    expect(state.files.has('cache://prepared.jpg')).toBe(true);
    expect(state.write).not.toHaveBeenCalled();
    state.finish();
    const photos = await importing;
    expect(photos).toHaveLength(1);
    expect(photos[0].uri).not.toBeNull();
    expect(state.write).toHaveBeenCalledOnce();
    expect(state.files.has('cache://prepared.jpg')).toBe(false);
  } finally {
    state.finish();
    await importing;
  }
});
