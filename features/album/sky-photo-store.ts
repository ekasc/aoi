import { prepareSkyPhoto } from '@/features/album/sky-photo-import';
import { createSkyPhotoRepository, skyPhotoContentId, skyPhotoScopeKey, type SkyPhotoScope } from '@/features/album/sky-photo-repository';

let database: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (database) return database;
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open('aoi-local-sky-photos', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('entries');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = null; reject(request.error); };
  });
  return database;
}

async function getValue(key: string): Promise<unknown> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('entries').objectStore('entries').get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function mutate(key: string, value?: string | Blob): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('entries', 'readwrite');
    const store = transaction.objectStore('entries');
    if (value === undefined) store.delete(key);
    else store.put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export function getSkyPhotoRepository(scope: SkyPhotoScope) {
  const displayUrls = new Map<string, string>();
  const key = skyPhotoScopeKey(scope);
  const fileKey = (id: string) => `${key}/photos/${id}`;
  return createSkyPhotoRepository(key, {
    async read() {
      const value = await getValue(`${key}/index`);
      if (value === undefined) return null;
      if (typeof value !== 'string') throw new Error('Invalid local photo index');
      return value;
    },
    write: (records) => mutate(`${key}/index`, JSON.stringify(records)),
    async readExcluded() {
      const raw = await getValue(`${key}/excluded`);
      if (raw === undefined) return [];
      if (typeof raw !== 'string') throw new Error('Invalid photo exclusions');
      const ids: unknown = JSON.parse(raw);
      if (!Array.isArray(ids) || !ids.every((id: unknown) => typeof id === 'string')) throw new Error('Invalid photo exclusions');
      return ids;
    },
    writeExcluded: (ids) => mutate(`${key}/excluded`, JSON.stringify(ids)),
    async importPhoto(photo) {
      const prepared = await prepareSkyPhoto(photo.uri);
      const response = await fetch(prepared.uri);
      const blob = await response.blob();
      const id = skyPhotoContentId(new Uint8Array(await blob.arrayBuffer()));
      await mutate(fileKey(id), blob);
      return { id, addedAt: new Date().toISOString(), width: prepared.width, height: prepared.height };
    },
    async uriFor(id) {
      const storedKey = fileKey(id);
      const existing = displayUrls.get(storedKey);
      if (existing) return existing;
      const value = await getValue(storedKey);
      if (!(value instanceof Blob)) return null;
      const uri = URL.createObjectURL(value);
      displayUrls.set(storedKey, uri);
      return uri;
    },
    async removeFile(id) {
      const storedKey = fileKey(id);
      await mutate(storedKey);
      const uri = displayUrls.get(storedKey);
      if (uri) URL.revokeObjectURL(uri);
      displayUrls.delete(storedKey);
    },
    dispose() {
      for (const uri of displayUrls.values()) URL.revokeObjectURL(uri);
      displayUrls.clear();
    },
  });
}
