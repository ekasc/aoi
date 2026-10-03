import { sha256 } from '@noble/hashes/sha2.js';

export type SkyPhotoScope = { userId: string; spaceId: string };
export type SkyPhotoRecord = { id: string; addedAt: string; width: number; height: number };
export type SkyPhoto = SkyPhotoRecord & { uri: string | null };
export type SelectedSkyPhoto = { uri: string };
export const SKY_PHOTO_BATCH_LIMIT = 12;

/** The web system picker hands ownership of its temporary blob URLs to us. */
export function releaseSelectedSkyPhotos(photos: SelectedSkyPhoto[]): void {
  for (const photo of photos) {
    if (photo.uri.startsWith('blob:') && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(photo.uri);
  }
}

export interface SkyPhotoStorage {
  read: () => Promise<string | null>;
  write: (records: SkyPhotoRecord[]) => Promise<void>;
  importPhoto: (photo: SelectedSkyPhoto) => Promise<SkyPhotoRecord>;
  uriFor: (id: string) => Promise<string | null>;
  removeFile: (id: string) => Promise<void>;
  readExcluded?: () => Promise<string[]>;
  writeExcluded?: (ids: string[]) => Promise<void>;
  dispose?: () => void;
}

export interface SkyPhotoRepository {
  list: () => Promise<SkyPhoto[]>;
  importPhotos: (photos: SelectedSkyPhoto[], excludedIds?: readonly string[]) => Promise<SkyPhoto[]>;
  remove: (id: string) => Promise<void>;
  dispose: () => void;
}

export function skyPhotoScopeKey(scope: SkyPhotoScope): string {
  const bytes = sha256(new TextEncoder().encode(JSON.stringify([scope.userId, scope.spaceId])));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function skyPhotoContentId(bytes: Uint8Array): string {
  return Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function parseSkyPhotoRecords(raw: string | null): SkyPhotoRecord[] {
  if (raw === null) return [];
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error('Invalid local photo index');
  return data.map((value: unknown) => {
    if (!value || typeof value !== 'object' || !('id' in value) || !('addedAt' in value) || !('width' in value) || !('height' in value)
      || typeof value.id !== 'string' || !/^[a-zA-Z0-9-]+$/.test(value.id)
      || typeof value.addedAt !== 'string' || !Number.isFinite(Date.parse(value.addedAt))
      || typeof value.width !== 'number' || !Number.isFinite(value.width) || value.width <= 0
      || typeof value.height !== 'number' || !Number.isFinite(value.height) || value.height <= 0) {
      throw new Error('Invalid local photo index');
    }
    return { id: value.id, addedAt: value.addedAt, width: value.width, height: value.height };
  });
}

export function chooseSkyPhoto(photos: SkyPhoto[], lastId: string | null, random = Math.random): SkyPhoto | null {
  const available = photos.filter((photo) => photo.uri !== null);
  const pool = available.length > 1 ? available.filter((photo) => photo.id !== lastId) : available;
  return pool[Math.floor(random() * pool.length)] ?? null;
}

/** One writer per device-local scope, including across screen remounts. */
const writers = new Map<string, Promise<unknown>>();

export function createSkyPhotoRepository(key: string, storage: SkyPhotoStorage): SkyPhotoRepository {
  const run = <T,>(task: () => Promise<T>): Promise<T> => {
    const job = (writers.get(key) ?? Promise.resolve()).catch(() => {}).then(task);
    writers.set(key, job);
    void job.finally(() => { if (writers.get(key) === job) writers.delete(key); }).catch(() => {});
    return job;
  };
  const read = async () => parseSkyPhotoRecords(await storage.read());
  const display = async (records: SkyPhotoRecord[]) => Promise.all(records.map(async (record) => ({ ...record, uri: await storage.uriFor(record.id) })));

  return {
    dispose: () => storage.dispose?.(),
    list: () => run(async () => display(await read())),
    importPhotos: (photos, excludedIds) => run(async () => {
      const existing = await read();
      const exclusions = new Set(excludedIds === undefined ? [] : [...excludedIds, ...await storage.readExcluded?.() ?? []]);
      const imported: SkyPhotoRecord[] = [];
      const ids = new Set(existing.map((record) => record.id));
      try {
        for (const photo of photos) {
          const record = await storage.importPhoto(photo);
          if (!ids.has(record.id) && exclusions.has(record.id)) { await storage.removeFile(record.id); continue; }
          if (!ids.has(record.id)) { imported.push(record); ids.add(record.id); }
        }
        const next = [...existing, ...imported];
        const visible = await display(next);
        await storage.write(next);
        return visible;
      } catch (error) {
        await Promise.all(imported.map((record) => storage.removeFile(record.id)));
        throw error;
      }
    }),
    remove: (id) => run(async () => {
      const records = await read();
      if (storage.writeExcluded && storage.readExcluded) {
        const excluded = await storage.readExcluded();
        await storage.writeExcluded([...new Set([...excluded, id])]);
      }
      await storage.removeFile(id);
      await storage.write(records.filter((record) => record.id !== id));
    }),
  };
}
