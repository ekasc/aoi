import AsyncStorage from '@react-native-async-storage/async-storage';

import type { AlbumMedia, AlbumRepository, SpaceBackup } from '@/features/album/types';

/**
 * The album, on this device only.
 *
 * This is the stub-mode implementation and it is also the honest floor: if
 * the app is unusable without a server it cannot be developed, and the local
 * path is what the tests and the dev preview run against.
 *
 * It deliberately does not attempt to be private. There is no key material
 * here and no encryption of the stored rows, because the whole point of the
 * design is that the *server* copy is the one that has to be unreadable, and
 * pretending this directory is encrypted would mean encrypting and then
 * decrypting on the same device for no gain. What is worth protecting on
 * this device is the key, and that lives in the keystore, not here.
 */
const MEDIA_KEY = 'aoi.album.media.v1.';
const BACKUP_KEY = 'aoi.album.backup.v1.';

function isUsableMedia(value: unknown): value is AlbumMedia {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const row = value as Partial<AlbumMedia>;
  return (
    typeof row.id === 'string' &&
    typeof row.createdAt === 'string' &&
    typeof row.byteLength === 'number' &&
    typeof row.mimeType === 'string' &&
    typeof row.sealed?.nonce === 'string' &&
    typeof row.sealed?.ciphertext === 'string' &&
    typeof row.wrappedKey?.nonce === 'string' &&
    typeof row.wrappedKey?.ciphertext === 'string'
  );
}

export function createLocalAlbumRepository(spaceId: string): AlbumRepository {
  const mediaKey = `${MEDIA_KEY}${spaceId}`;
  const backupKey = `${BACKUP_KEY}${spaceId}`;

  return {
    async listMedia() {
      const raw = await AsyncStorage.getItem(mediaKey);
      if (!raw) {
        return [];
      }
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
          return [];
        }
        return parsed.filter(isUsableMedia);
      } catch {
        return [];
      }
    },

    async putMedia(media) {
      const all = (await this.listMedia()).filter((row) => row.id !== media.id);
      all.push(media);
      await AsyncStorage.setItem(mediaKey, JSON.stringify(all));
    },

    async deleteMedia(mediaId) {
      const all = (await this.listMedia()).filter((row) => row.id !== mediaId);
      await AsyncStorage.setItem(mediaKey, JSON.stringify(all));
    },

    async getBackup() {
      const raw = await AsyncStorage.getItem(backupKey);
      if (!raw) {
        return null;
      }
      try {
        return JSON.parse(raw) as SpaceBackup;
      } catch {
        return null;
      }
    },

    async putBackup(backup) {
      await AsyncStorage.setItem(backupKey, JSON.stringify(backup));
    },
  };
}
