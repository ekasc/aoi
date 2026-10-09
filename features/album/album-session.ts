import { type AlbumMediaRecord, type SpaceBackup } from '@aoi/shared';

import { sealAlbumMedia, openAlbumMedia } from '@/features/album/album';
import {
  getAlbumMediaClient,
  type AlbumMediaClient,
} from '@/features/album/album-media-client';
import { generateMediaKey, fromBase64, toBase64 } from '@/features/album/crypto';
import { getOrCreateDeviceId } from '@/features/album/device-id';
import {
  identityOf,
  signDeviceKey,
  spaceKeyFor,
  toWire,
  type DeviceKeys,
} from '@/features/album/keys';
import { createLocalKeyStore, type LocalKeyStore } from '@/features/album/local-key-store';
import { readPhotoBytes } from '@/features/album/photo-bytes';
import type { AlbumMedia } from '@/features/album/types';

/**
 * Joining the shared album, silently.
 *
 * A device has its own keys and knows nothing else. It publishes its identity,
 * reads the space backup, and agrees the space key with whoever is not it.
 * There is no ceremony and no prompt: if a partner is there, the session is
 * ready; if there is not yet an identity that is not this device, the album is
 * simply waiting for one, which is not an error.
 *
 * The backup is the one piece of shared state. Merging rather than overwriting
 * is deliberate: a device writes its own identity and its own signed device
 * key, and leaves every other entry alone, so two devices coming online at the
 * same moment cannot delete each other.
 */

export type AlbumSessionReady = {
  status: 'ready';
  device: DeviceKeys;
  spaceKey: Uint8Array;
  client: AlbumMediaClient;
};

export type AlbumSession = AlbumSessionReady | { status: 'waiting' };

export type EstablishAlbumSessionInput = {
  userId: string;
  spaceId: string;
  /** Test seams; production uses the stub/remote selector and the key store. */
  client?: AlbumMediaClient;
  keyStore?: LocalKeyStore;
};

export async function establishAlbumSession({
  spaceId,
  client,
  keyStore,
}: EstablishAlbumSessionInput): Promise<AlbumSession> {
  const mediaClient = client ?? getAlbumMediaClient(spaceId);
  const store = keyStore ?? createLocalKeyStore();

  const deviceId = await getOrCreateDeviceId();
  const device = await store.ensureDevice(spaceId, deviceId);

  const backup = await mediaClient.getBackup();
  const mine = toWire(identityOf(device));
  const merged: SpaceBackup = {
    identities: mergeByIdentity(backup.identities, mine),
    deviceKeys: mergeDeviceKeys(
      backup.deviceKeys,
      signDeviceKey(device.signing, device.deviceId, device.agreement.publicKey),
    ),
    envelopes: backup.envelopes,
  };
  await mediaClient.putBackup(merged);

  const mySigningKey = toBase64(device.signing.publicKey);
  const partner = merged.identities.find(
    (identity) => identity.signingPublicKey !== mySigningKey,
  );
  if (!partner) {
    // Nobody else has joined yet. That is a normal state, not a failure.
    return { status: 'waiting' };
  }

  return {
    status: 'ready',
    device,
    spaceKey: spaceKeyFor(device, fromBase64(partner.agreementPublicKey)),
    client: mediaClient,
  };
}

function mergeByIdentity(
  identities: SpaceBackup['identities'],
  mine: SpaceBackup['identities'][number],
): SpaceBackup['identities'] {
  const byDeviceId = new Map(identities.map((identity) => [identity.deviceId, identity]));
  byDeviceId.set(mine.deviceId, mine);
  return [...byDeviceId.values()];
}

function mergeDeviceKeys(
  deviceKeys: SpaceBackup['deviceKeys'],
  mine: SpaceBackup['deviceKeys'][number],
): SpaceBackup['deviceKeys'] {
  const byDeviceId = new Map(deviceKeys.map((key) => [key.deviceId, key]));
  byDeviceId.set(mine.deviceId, mine);
  return [...byDeviceId.values()];
}

/**
 * Seal one prepared photo and upload it.
 *
 * The photo is encrypted here; the server only ever sees ciphertext and the
 * wrapped media key. The non-secret metadata (when, how big, which MIME type,
 * and the dimensions) travels in the clear, because that is the real cost of
 * storing this anywhere but the phone.
 */
export async function sealAndUploadPhoto(
  session: AlbumSessionReady,
  prepared: { uri: string; width: number; height: number },
): Promise<void> {
  const bytes = await readPhotoBytes(prepared.uri);
  const media = sealAlbumMedia(
    session.spaceKey,
    bytes,
    {
      createdAt: new Date().toISOString(),
      mimeType: 'image/jpeg',
      width: prepared.width,
      height: prepared.height,
    },
    generateMediaKey,
  );

  const intent = await session.client.createIntent({
    mimeType: media.mimeType,
    // The ciphertext's length, because that is the object that will exist. The
    // reservation, the head check, and the stored metadata all mean the same
    // number now.
    byteLength: media.byteLength,
    sealedNonce: media.sealed.nonce,
    wrappedKey: media.wrappedKey,
    width: media.width,
    height: media.height,
  });

  await session.client.putObject(intent, fromBase64(media.sealed.ciphertext));
  await session.client.complete(intent.mediaId);
}

/**
 * Decrypt one photo's bytes. The record and the sealed blob are the two halves
 * the server holds separately; only the space key can join them.
 */
export function openPhoto(
  spaceKey: Uint8Array,
  record: AlbumMediaRecord,
  bytes: Uint8Array,
): Uint8Array {
  const media: AlbumMedia = {
    id: record.id,
    wrappedKey: record.wrappedKey,
    sealed: { nonce: record.sealedNonce, ciphertext: toBase64(bytes) },
    createdAt: record.createdAt,
    byteLength: record.byteLength,
    mimeType: record.mimeType,
    width: record.width,
    height: record.height,
    personTag: record.personTag,
  };
  return openAlbumMedia(spaceKey, media);
}
