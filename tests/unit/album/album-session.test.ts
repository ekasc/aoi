import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AlbumMediaRecord, SpaceBackup } from '@aoi/shared';

vi.mock('@/features/album/photo-bytes', () => ({
  readPhotoBytes: async () => new TextEncoder().encode('jpeg-bytes'),
}));
vi.mock('@/features/album/device-id', () => ({ getOrCreateDeviceId: async () => 'device-1' }));
vi.mock('@/features/album/local-key-store', () => ({
  createLocalKeyStore: () => ({ ensureDevice: vi.fn(), loadDevice: vi.fn(), forgetDevice: vi.fn() }),
}));

const { establishAlbumSession, sealAndUploadPhoto, openPhoto } = await import('@/features/album/album-session');
const { generateDeviceKeys, identityOf, spaceKeyFor, toWire } = await import('@/features/album/keys');

const when = new Date('2026-01-01T00:00:00.000Z');
const deviceId = 'device-1';

function keyStoreFor(device: ReturnType<typeof generateDeviceKeys>) {
  return { ensureDevice: async () => device, loadDevice: async () => device, forgetDevice: async () => {} };
}

function fakeClient(backup: SpaceBackup) {
  const putBackup = vi.fn(async (next: SpaceBackup) => next);
  return {
    createIntent: vi.fn(async () => ({ mediaId: 'm-1', uploadUrl: 'stub://u', expiresInSec: 3600 })),
    putObject: vi.fn(async () => {}),
    complete: vi.fn(async () => {}),
    list: vi.fn(async () => [] as AlbumMediaRecord[]),
    fetchObject: vi.fn(async () => new Uint8Array()),
    remove: vi.fn(async () => {}),
    getBackup: vi.fn(async () => backup),
    putBackup,
  };
}

describe('establishing the album session', () => {
  let device: ReturnType<typeof generateDeviceKeys>;
  let partner: ReturnType<typeof generateDeviceKeys>;

  beforeEach(() => {
    device = generateDeviceKeys(deviceId, when);
    partner = generateDeviceKeys('partner-1', when);
  });

  it('publishes this device, agrees with the partner, and is ready', async () => {
    const backup: SpaceBackup = {
      identities: [toWire(identityOf(partner))],
      deviceKeys: [],
      envelopes: [],
    };
    const client = fakeClient(backup);
    const session = await establishAlbumSession({ userId: 'you', spaceId: 'space-1', client, keyStore: keyStoreFor(device) });

    expect(session.status).toBe('ready');
    if (session.status !== 'ready') return;
    expect(Buffer.from(session.spaceKey)).toEqual(
      Buffer.from(spaceKeyFor(device, partner.agreement.publicKey)),
    );

    // Both identities and this device's signed key are in the merged backup.
    const merged = client.putBackup.mock.calls[0][0];
    expect(merged.identities.map((identity) => identity.deviceId).sort()).toEqual([deviceId, 'partner-1']);
    expect(merged.deviceKeys.some((key) => key.deviceId === deviceId)).toBe(true);
  });

  it('waits, rather than failing, when no partner has joined yet', async () => {
    const client = fakeClient({ identities: [], deviceKeys: [], envelopes: [] });
    const session = await establishAlbumSession({ userId: 'you', spaceId: 'space-1', client, keyStore: keyStoreFor(device) });
    expect(session).toEqual({ status: 'waiting' });
    // The device still publishes itself, so the partner can find it later.
    expect(client.putBackup).toHaveBeenCalledOnce();
  });

  it('merges without duplicating an identity already in the backup', async () => {
    const backup: SpaceBackup = {
      identities: [toWire(identityOf(device)), toWire(identityOf(partner))],
      deviceKeys: [],
      envelopes: [],
    };
    const client = fakeClient(backup);
    await establishAlbumSession({ userId: 'you', spaceId: 'space-1', client, keyStore: keyStoreFor(device) });
    const merged = client.putBackup.mock.calls[0][0];
    expect(merged.identities).toHaveLength(2);
    expect(merged.identities.filter((identity) => identity.deviceId === deviceId)).toHaveLength(1);
  });

  it('seals a photo so only the space key can open it', async () => {
    const backup: SpaceBackup = { identities: [toWire(identityOf(partner))], deviceKeys: [], envelopes: [] };
    const client = fakeClient(backup);
    const session = await establishAlbumSession({ userId: 'you', spaceId: 'space-1', client, keyStore: keyStoreFor(device) });
    if (session.status !== 'ready') throw new Error('expected a ready session');

    await sealAndUploadPhoto(session, { uri: 'prepared://photo.jpg', width: 100, height: 200 });

    const input = client.createIntent.mock.calls[0][0];
    expect(input).toMatchObject({ mimeType: 'image/jpeg', byteLength: 10, width: 100, height: 200 });
    expect(input.sealedNonce).toBeTruthy();
    expect(client.putObject).toHaveBeenCalledOnce();
    expect(client.complete).toHaveBeenCalledWith('m-1');

    const sealedBytes = client.putObject.mock.calls[0][1];
    const record: AlbumMediaRecord = {
      id: 'm-1',
      wrappedKey: input.wrappedKey,
      sealedNonce: input.sealedNonce,
      createdAt: when.toISOString(),
      byteLength: input.byteLength,
      mimeType: input.mimeType,
      width: 100,
      height: 200,
    };
    const opened = openPhoto(session.spaceKey, record, sealedBytes);
    expect(new TextDecoder().decode(opened)).toBe('jpeg-bytes');
  });
});
