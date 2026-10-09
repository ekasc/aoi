import { beforeEach, describe, expect, it, vi } from 'vitest';

import { albumObjectUrl, type AlbumUploadIntentRequest } from '@aoi/shared';

import { toArrayBuffer } from '@/features/album/crypto';

const api = vi.hoisted(() => ({ apiFetch: vi.fn(), apiFetchBytes: vi.fn(), isStubMode: vi.fn() }));
vi.mock('@/features/api-client', () => api);

const {
  createLocalAlbumMediaClient,
  createRemoteAlbumMediaClient,
  getAlbumMediaClient,
} = await import('@/features/album/album-media-client');

const intentInput: AlbumUploadIntentRequest = {
  mimeType: 'image/jpeg',
  byteLength: 4,
  sealedNonce: 'sealed-nonce',
  wrappedKey: { nonce: 'wrapped-nonce', ciphertext: 'wrapped-ciphertext' },
  width: 10,
  height: 20,
};

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.__mockAsyncStorage.clear();
});

describe('the local album client', () => {
  it('round-trips one photo through intent, object, and record', async () => {
    const client = createLocalAlbumMediaClient('space-1');
    const bytes = new Uint8Array([1, 2, 3, 4]);

    const intent = await client.createIntent(intentInput);
    await client.putObject(intent, bytes);
    await client.complete(intent.mediaId);

    const records = await client.list();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: intent.mediaId,
      sealedNonce: 'sealed-nonce',
      wrappedKey: intentInput.wrappedKey,
      byteLength: 4,
      mimeType: 'image/jpeg',
      width: 10,
      height: 20,
    });
    expect(Array.from(await client.fetchObject(intent.mediaId))).toEqual([1, 2, 3, 4]);
  });

  it('keeps two spaces apart', async () => {
    const client = createLocalAlbumMediaClient('space-1');
    const intent = await client.createIntent(intentInput);
    await client.putObject(intent, new Uint8Array([9]));
    await client.complete(intent.mediaId);

    const other = createLocalAlbumMediaClient('space-2');
    expect(await other.list()).toEqual([]);
    expect(await other.fetchObject(intent.mediaId)).toEqual(new Uint8Array());
  });

  it('removes the record and its sealed bytes together', async () => {
    const client = createLocalAlbumMediaClient('space-1');
    const intent = await client.createIntent(intentInput);
    await client.putObject(intent, new Uint8Array([5]));
    await client.complete(intent.mediaId);

    await client.remove(intent.mediaId);
    expect(await client.list()).toEqual([]);
    expect(await client.fetchObject(intent.mediaId)).toEqual(new Uint8Array());
  });

  it('seeds a deterministic partner so a preview can agree a stable space key', async () => {
    const client = createLocalAlbumMediaClient('space-1');
    const backup = await client.getBackup();
    expect(backup.identities).toHaveLength(1);
    expect(backup.identities[0].deviceId).toBe('stub-partner-device');
    expect(backup.identities[0].agreementPublicKey).toBe('E75P6uryBMf9M1j8nAByGIHRdCeBKCJ+xnTzf3/pe20=');

    // And it is replaceable: a written backup is read back verbatim.
    const stored = { ...backup, identities: [...backup.identities] };
    await client.putBackup(stored);
    expect(await client.getBackup()).toEqual(stored);
  });
});

describe('the remote album client', () => {
  it('creates intents over JSON and uploads ciphertext to the presigned URL', async () => {
    const client = createRemoteAlbumMediaClient();
    const intent = { mediaId: 'm-1', uploadUrl: 'https://objects.test/put', expiresInSec: 60, headers: { 'x-extra': 'yes' } };
    api.apiFetch.mockResolvedValueOnce(intent);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200 } as Response);
    try {
      expect(await client.createIntent(intentInput)).toEqual(intent);
      expect(api.apiFetch).toHaveBeenCalledWith('/v1/spaces/current/album/media', {
        method: 'POST',
        body: JSON.stringify(intentInput),
      });

      const bytes = new Uint8Array([1, 2]);
      await client.putObject(intent, bytes);
      expect(fetchSpy).toHaveBeenCalledWith('https://objects.test/put', {
        method: 'PUT',
        body: toArrayBuffer(bytes),
        headers: { 'Content-Type': 'application/octet-stream', 'x-extra': 'yes' },
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('reads object bytes through the authenticated binary read', async () => {
    const client = createRemoteAlbumMediaClient();
    api.apiFetchBytes.mockResolvedValueOnce({ bytes: new Uint8Array([7]), contentType: 'application/octet-stream', status: 200 });
    expect(await client.fetchObject('m-1')).toEqual(new Uint8Array([7]));
    expect(api.apiFetchBytes).toHaveBeenCalledWith(albumObjectUrl('m-1'));
  });

  it('normalises an absent backup to an empty one', async () => {
    const client = createRemoteAlbumMediaClient();
    api.apiFetch.mockResolvedValueOnce(null);
    expect(await client.getBackup()).toEqual({ identities: [], deviceKeys: [], envelopes: [] });
  });
});

describe('selecting the album client', () => {
  it('uses the local stub in stub mode and the worker otherwise', async () => {
    api.isStubMode.mockReturnValue(true);
    const local = await getAlbumMediaClient('space-1').createIntent(intentInput);
    expect(local.uploadUrl).toContain('stub://');
    expect(api.apiFetch).not.toHaveBeenCalled();

    api.isStubMode.mockReturnValue(false);
    api.apiFetch.mockResolvedValueOnce({ mediaId: 'm-1', uploadUrl: 'https://objects.test/put', expiresInSec: 60 });
    await getAlbumMediaClient('space-1').createIntent(intentInput);
    expect(api.apiFetch).toHaveBeenCalledOnce();
  });
});
