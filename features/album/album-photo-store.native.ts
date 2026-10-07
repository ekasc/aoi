import { Directory, File, Paths } from 'expo-file-system';

import type { AlbumMediaRecord } from '@aoi/shared';

import type { SkyPhoto } from '@/features/album/sky-photo-repository';
import type { AlbumPhotoStore, AlbumPhotoStoreInput } from '@/features/album/album-photo-store';

/**
 * Turn sealed records into displayable photos, on native.
 *
 * The decrypted copy is written once to the app's own Documents directory and
 * reused for the life of the install: re-fetching and re-decrypting a library
 * on every screen visit is the difference between a sky that opens and one
 * that stutters. The cache is device-local plaintext, which is the same trust
 * boundary as the rest of the app sandbox.
 *
 * One unreadable photo must not empty the sky, so a failure is skipped, not
 * thrown.
 */
export function createAlbumPhotoStore({
  spaceId,
  fetchObject,
  open,
}: AlbumPhotoStoreInput): AlbumPhotoStore {
  const directory = new Directory(Paths.document, 'album-cache', spaceId);
  const fileFor = (id: string) => new File(directory, `${id}.jpg`);

  return {
    async list(records) {
      const photos: SkyPhoto[] = [];
      for (const record of records) {
        try {
          const file = fileFor(record.id);
          if (!file.exists) {
            const sealed = await fetchObject(record.id);
            const opened = open(record, sealed);
            directory.create({ idempotent: true, intermediates: true });
            file.write(opened);
          }
          photos.push({
            id: record.id,
            addedAt: record.createdAt,
            uri: file.uri,
            width: record.width ?? 1,
            height: record.height ?? 1,
          });
        } catch {
          // A photo that cannot be fetched or opened is left out of the sky.
        }
      }
      return photos;
    },

    async removeCached(id) {
      const file = fileFor(id);
      if (file.exists) {
        file.delete();
      }
    },

    dispose() {
      // Nothing to release: the cache is on disk and outlives the screen.
    },
  };
}
