import type { AlbumMediaRecord } from '@aoi/shared';

import { toArrayBuffer } from '@/features/album/crypto';
import type { SkyPhoto } from '@/features/album/sky-photo-repository';

/**
 * Turn sealed records into displayable photos, on web.
 *
 * A record is metadata; the pixels arrive only after a fetch-then-decrypt.
 * That work is cached per session as an in-memory Blob URL — the browser has
 * no sandboxed photo directory the way the app does, and the bytes are already
 * in memory at the moment of decryption anyway. `dispose` revokes what it
 * created so a scope change does not leak every object URL.
 *
 * One unreadable photo must not empty the sky, so a failure is skipped, not
 * thrown: the alternative is that a single corrupt row hides every other one.
 */
export type AlbumPhotoStore = {
  list: (records: AlbumMediaRecord[]) => Promise<SkyPhoto[]>;
  removeCached: (id: string) => Promise<void>;
  dispose: () => void;
};

export type AlbumPhotoStoreInput = {
  spaceId: string;
  fetchObject: (id: string) => Promise<Uint8Array>;
  open: (record: AlbumMediaRecord, bytes: Uint8Array) => Uint8Array;
};

export function createAlbumPhotoStore({
  fetchObject,
  open,
}: AlbumPhotoStoreInput): AlbumPhotoStore {
  const urls = new Map<string, string>();

  return {
    async list(records) {
      const photos: SkyPhoto[] = [];
      for (const record of records) {
        try {
          let uri = urls.get(record.id);
          if (!uri) {
            const sealed = await fetchObject(record.id);
            const opened = open(record, sealed);
            uri = URL.createObjectURL(new Blob([toArrayBuffer(opened)], { type: record.mimeType }));
            urls.set(record.id, uri);
          }
          photos.push({
            id: record.id,
            addedAt: record.createdAt,
            uri,
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
      const uri = urls.get(id);
      if (uri) {
        URL.revokeObjectURL(uri);
        urls.delete(id);
      }
    },

    dispose() {
      for (const uri of urls.values()) {
        URL.revokeObjectURL(uri);
      }
      urls.clear();
    },
  };
}
