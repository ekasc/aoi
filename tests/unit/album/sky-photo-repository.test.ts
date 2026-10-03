import { describe, expect, it, vi } from 'vitest';

import { chooseSkyPhoto, createSkyPhotoRepository, parseSkyPhotoRecords, releaseSelectedSkyPhotos, skyPhotoScopeKey, type SkyPhotoRecord, type SkyPhotoStorage } from '@/features/album/sky-photo-repository';

const record = (id = 'photo-1'): SkyPhotoRecord => ({ id, addedAt: '2026-01-01T00:00:00.000Z', width: 800, height: 600 });

function fixture(key = 'scope') {
  let raw: string | null = null;
  let nextId = 0;
  const files = new Set<string>();
  const storage: SkyPhotoStorage = {
    read: vi.fn(async () => raw),
    write: vi.fn(async (records) => { raw = JSON.stringify(records); }),
    importPhoto: vi.fn(async () => {
      const value = record(`photo-${++nextId}`);
      files.add(value.id);
      return value;
    }),
    uriFor: vi.fn(async (id) => files.has(id) ? `file:///${id}.jpg` : null),
    removeFile: vi.fn(async (id) => { files.delete(id); }),
    dispose: vi.fn(),
  };
  return { storage, files, repository: createSkyPhotoRepository(key, storage), readRaw: () => raw };
}

describe('local sky photo repository', () => {
  it('starts empty and restores imported photos through a new repository instance', async () => {
    const { repository, storage, readRaw } = fixture();
    expect(await repository.list()).toEqual([]);
    const photos = await repository.importPhotos([{ uri: 'picker://chosen' }]);
    expect(photos[0].uri).toBe('file:///photo-1.jpg');
    expect(readRaw()).not.toContain('picker://');
    const restored = createSkyPhotoRepository('scope', storage);
    expect(await restored.list()).toEqual(photos);
  });

  it('rolls back staged files when the index cannot be saved', async () => {
    const { repository, storage, files } = fixture();
    vi.mocked(storage.write).mockRejectedValueOnce(new Error('disk full'));
    await expect(repository.importPhotos([{ uri: 'picker://a' }, { uri: 'picker://b' }])).rejects.toThrow('disk full');
    expect(files.size).toBe(0);
    expect(await repository.list()).toEqual([]);
    expect((await repository.importPhotos([{ uri: 'picker://a' }])).length).toBe(1);
  });

  it('does not discard previously imported photos when a batch fails', async () => {
    const { repository, storage, files } = fixture();
    await repository.importPhotos([{ uri: 'picker://first' }]);
    const existing = await repository.list();
    vi.mocked(storage.importPhoto).mockRejectedValueOnce(new Error('decode failed'));
    await expect(repository.importPhotos([{ uri: 'picker://bad' }])).rejects.toThrow();
    expect(await repository.list()).toEqual(existing);
    expect(files.size).toBe(1);
  });

  it('does not duplicate or delete an existing photo when the same content is selected again', async () => {
    const { repository, storage, files } = fixture();
    await repository.importPhotos([{ uri: 'picker://first' }]);
    vi.mocked(storage.importPhoto).mockResolvedValue(record('photo-1'));
    expect((await repository.importPhotos([{ uri: 'picker://same' }])).length).toBe(1);
    vi.mocked(storage.write).mockRejectedValueOnce(new Error('disk full'));
    await expect(repository.importPhotos([{ uri: 'picker://same' }])).rejects.toThrow();
    expect(files.has('photo-1')).toBe(true);
    expect(storage.removeFile).not.toHaveBeenCalled();
  });

  it('cleans earlier staged photos when a later photo cannot be imported', async () => {
    const { repository, storage, files } = fixture();
    vi.mocked(storage.importPhoto).mockImplementationOnce(async () => { files.add('staged'); return record('staged'); }).mockRejectedValueOnce(new Error('bad image'));
    await expect(repository.importPhotos([{ uri: 'picker://a' }, { uri: 'picker://b' }])).rejects.toThrow();
    expect(files.size).toBe(0);
    expect(await repository.list()).toEqual([]);
  });

  it('removes only the app copy, never the selected source URI', async () => {
    const { repository, storage, files } = fixture();
    await repository.importPhotos([{ uri: 'picker://original' }]);
    await repository.remove('photo-1');
    expect(storage.removeFile).toHaveBeenCalledWith('photo-1');
    expect(files.size).toBe(0);
    expect(await repository.list()).toEqual([]);
  });

  it('keeps a removable missing-photo record if the index write fails after deletion', async () => {
    const { repository, storage, files } = fixture();
    await repository.importPhotos([{ uri: 'picker://original' }]);
    vi.mocked(storage.write).mockRejectedValueOnce(new Error('disk full'));
    await expect(repository.remove('photo-1')).rejects.toThrow();
    expect(files.has('photo-1')).toBe(false);
    expect((await repository.list()).length).toBe(1);
    expect((await repository.list())[0].uri).toBeNull();
    await repository.remove('photo-1');
    expect(await repository.list()).toEqual([]);
  });

  it('retains the record and copy if deletion fails, then succeeds on retry', async () => {
    const { repository, storage, files } = fixture();
    await repository.importPhotos([{ uri: 'picker://original' }]);
    vi.mocked(storage.removeFile).mockRejectedValueOnce(new Error('file busy'));
    await expect(repository.remove('photo-1')).rejects.toThrow();
    expect(files.has('photo-1')).toBe(true);
    expect((await repository.list()).length).toBe(1);
    await repository.remove('photo-1');
    expect(files.size).toBe(0);
    expect(await repository.list()).toEqual([]);
  });

  it('keeps missing copies in the list so they can be removed', async () => {
    const { repository, files } = fixture();
    await repository.importPhotos([{ uri: 'picker://original' }]);
    files.clear();
    expect((await repository.list())[0].uri).toBeNull();
    await repository.remove('photo-1');
    expect(await repository.list()).toEqual([]);
  });

  it('serializes imports across repository instances to avoid losing a batch', async () => {
    const { repository, storage } = fixture('concurrent');
    const second = createSkyPhotoRepository('concurrent', storage);
    await Promise.all([repository.importPhotos([{ uri: 'picker://a' }]), second.importPhotos([{ uri: 'picker://b' }])]);
    expect((await repository.list()).length).toBe(2);
  });

  it('releases only display resources when disposed', () => {
    const { repository, storage } = fixture();
    repository.dispose();
    expect(storage.dispose).toHaveBeenCalledOnce();
    expect(storage.removeFile).not.toHaveBeenCalled();
  });
});

describe('sky source contracts', () => {
  it('releases picker blob handles without touching native originals', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    try {
      releaseSelectedSkyPhotos([{ uri: 'blob:picker' }, { uri: 'file:///original.jpg' }, { uri: 'content://original' }]);
      expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:picker');
    } finally { revoke.mockRestore(); }
  });
  it('has distinct keys per account and space, without raw identifiers or path components', () => {
    const first = skyPhotoScopeKey({ userId: 'you', spaceId: 'a' });
    expect(first).not.toBe(skyPhotoScopeKey({ userId: 'you', spaceId: 'b' }));
    expect(first).not.toBe(skyPhotoScopeKey({ userId: 'other', spaceId: 'a' }));
    expect(skyPhotoScopeKey({ userId: '../private', spaceId: '../elsewhere' })).toMatch(/^[a-f0-9]{64}$/);
  });

  it('treats corrupt indexes as failures, not an empty album', () => {
    expect(parseSkyPhotoRecords(null)).toEqual([]);
    expect(() => parseSkyPhotoRecords('{')).toThrow();
    expect(() => parseSkyPhotoRecords('{}')).toThrow();
    expect(() => parseSkyPhotoRecords(JSON.stringify([record('../escape')]))).toThrow();
    expect(() => parseSkyPhotoRecords(JSON.stringify([{ ...record(), width: 0 }]))).toThrow();
  });

  it('never repeats the last available photo when alternatives exist', () => {
    const photos = ['a', 'b', 'c'].map((id) => ({ ...record(id), uri: `file:///${id}` }));
    expect(chooseSkyPhoto(photos, 'a', () => 0)?.id).toBe('b');
    expect(chooseSkyPhoto(photos, 'c', () => 0.99)?.id).toBe('b');
    expect(chooseSkyPhoto([photos[0]], 'a')?.id).toBe('a');
    expect(chooseSkyPhoto([{ ...record(), uri: null }], null)).toBeNull();
    expect(chooseSkyPhoto([], null)).toBeNull();
  });
});
