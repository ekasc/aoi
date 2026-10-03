import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';

import { prepareSkyPhoto } from '@/features/album/sky-photo-import';
import { createSkyPhotoRepository, skyPhotoContentId, skyPhotoScopeKey, type SkyPhotoScope } from '@/features/album/sky-photo-repository';

export function getSkyPhotoRepository(scope: SkyPhotoScope) {
  const key = skyPhotoScopeKey(scope);
  const directory = new Directory(Paths.document, 'sky-photos', key);
  const indexKey = `aoi.sky-photos.v1.${key}`;
  const excludedKey = `${indexKey}.excluded`;
  const photoFile = (id: string) => new File(directory, `${id}.jpg`);

  return createSkyPhotoRepository(key, {
    read: () => AsyncStorage.getItem(indexKey),
    write: (records) => AsyncStorage.setItem(indexKey, JSON.stringify(records)),
    async readExcluded() {
      const raw = await AsyncStorage.getItem(excludedKey);
      if (!raw) return [];
      const ids: unknown = JSON.parse(raw);
      if (!Array.isArray(ids) || !ids.every((id: unknown) => typeof id === 'string')) throw new Error('Invalid photo exclusions');
      return ids;
    },
    writeExcluded: (ids) => AsyncStorage.setItem(excludedKey, JSON.stringify(ids)),
    async importPhoto(photo) {
      const prepared = await prepareSkyPhoto(photo.uri);
      const temporary = new File(prepared.uri);
      let destination: File | undefined;
      let existed = false;
      try {
        const id = skyPhotoContentId(await temporary.bytes());
        destination = photoFile(id);
        existed = destination.exists;
        directory.create({ idempotent: true, intermediates: true });
        if (!existed) temporary.copy(destination);
        return { id, addedAt: new Date().toISOString(), width: prepared.width, height: prepared.height };
      } catch (error) {
        if (destination && !existed && destination.exists) destination.delete();
        throw error;
      } finally {
        if (temporary.exists) temporary.delete();
      }
    },
    async uriFor(id) { const file = photoFile(id); return file.exists ? file.uri : null; },
    async removeFile(id) {
      const file = photoFile(id);
      if (file.exists) file.delete();
    },
  });
}
