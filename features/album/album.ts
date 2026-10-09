import { ed25519 } from '@noble/curves/ed25519.js';

import {
  fromBase64,
  openMedia,
  sealMedia,
  toBase64,
  unwrapKey,
  wrapKey,
  type SealedMedia,
} from '@/features/album/crypto';
import {
  spaceKeyFor,
  verifyDeviceKey,
  type DeviceKeys,
  type SignedDeviceKey,
  type WireDeviceIdentity,
} from '@/features/album/keys';
import type { AlbumMedia, AlbumRepository, SpaceBackup, SpaceKeyEnvelope } from '@/features/album/types';

/**
 * The album, and what happens when a phone is replaced.
 *
 * The restore path is the one worth reading. A new device has its own keys
 * and knows nothing. It asks the partner to authorise it, once. The partner
 * wraps the space key for that device and publishes the envelope. From then
 * on the new phone restores from the server on its own, with nobody online
 * and no conversation, which is the difference between this and the rekey
 * ceremony it replaces.
 */

export type RestoreResult =
  | { ok: true; spaceKey: Uint8Array }
  | { ok: false; reason: 'no-envelope' | 'not-authorised' | 'wrong-partner' | 'corrupt' };

/**
 * Build the envelope that lets one device hold the space key.
 *
 * The wrapping key is an ECDH between the recipient's agreement key and the
 * authoriser's, so only those two can produce or open it. It is then signed
 * by the authoriser's identity, so the recipient can tell who let them in.
 */
export function authoriseDevice(
  authoriser: DeviceKeys,
  recipient: WireDeviceIdentity,
  spaceKey: Uint8Array,
  now: Date,
): SpaceKeyEnvelope {
  const wrappingKey = spaceKeyFor(authoriser, fromBase64(recipient.agreementPublicKey));
  const sealed = wrapKey(wrappingKey, spaceKey);
  const signatureBytes = envelopeBytes(recipient.deviceId, sealed, now.toISOString());
  return {
    deviceId: recipient.deviceId,
    sealed,
    authorisedBy: toBase64(authoriser.signing.publicKey),
    signature: toBase64(new Uint8Array(ed25519.sign(signatureBytes, authoriser.signing.privateKey))),
    createdAt: now.toISOString(),
  };
}

/** Canonical bytes for an envelope. Same reasoning as the device key. */
function envelopeBytes(deviceId: string, sealed: SealedMedia, createdAt: string): Uint8Array {
  const id = new TextEncoder().encode(deviceId);
  const nonce = fromBase64(sealed.nonce);
  const ciphertext = fromBase64(sealed.ciphertext);
  const stamp = new TextEncoder().encode(createdAt);
  const out = new Uint8Array(12 + id.length + nonce.length + ciphertext.length + stamp.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, id.length, false);
  out.set(id, 4);
  view.setUint32(4 + id.length, nonce.length, false);
  out.set(nonce, 8 + id.length);
  const at = 8 + id.length + nonce.length;
  view.setUint32(at, ciphertext.length, false);
  out.set(ciphertext, at + 4);
  out.set(stamp, at + 4 + ciphertext.length);
  return out;
}

/**
 * Recover the space key on a new device.
 *
 * Order matters and is the security property: the envelope must be one this
 * partner issued, for this device, before the key is unwrapped. A failure
 * returns a reason rather than throwing, because "no envelope yet" is the
 * normal state of a device that has not been authorised, not an error.
 */
export function restoreSpaceKey(
  device: DeviceKeys,
  backup: SpaceBackup | null,
  /**
   * The partner, by both halves of their key. The agreement key unwraps the
   * envelope and the signing key verifies it, and they are different keys for
   * different jobs. Passing the signing key to the ECDH is wrong and fails
   * closed rather than open, which is the only reason it was caught by a
   * test rather than in the field.
   */
  expectedPartner: { signingPublicKey: Uint8Array; agreementPublicKey: Uint8Array },
): RestoreResult {
  if (!backup) {
    return { ok: false, reason: 'not-authorised' };
  }
  const envelope = backup.envelopes.find((candidate) => candidate.deviceId === device.deviceId);
  if (!envelope) {
    return { ok: false, reason: 'no-envelope' };
  }
  if (envelope.authorisedBy !== toBase64(expectedPartner.signingPublicKey)) {
    return { ok: false, reason: 'wrong-partner' };
  }
  // The device's own key must be one the partner vouched for. Without this a
  // server could mint an envelope for a key it invented.
  const signed = backup.deviceKeys.find(
    (candidate): candidate is SignedDeviceKey => candidate.deviceId === device.deviceId,
  );
  if (!signed || verifyDeviceKey(signed, expectedPartner.signingPublicKey).ok !== true) {
    return { ok: false, reason: 'not-authorised' };
  }

  try {
    const wrappingKey = spaceKeyFor(device, expectedPartner.agreementPublicKey);
    return { ok: true, spaceKey: unwrapKey(wrappingKey, envelope.sealed) };
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
}

/**
 * Decrypt one photo. Needs the space key to unwrap the media key, and the
 * media key to open the photo. Neither ever leaves the device.
 */
export function openAlbumMedia(spaceKey: Uint8Array, media: AlbumMedia): Uint8Array {
  const mediaKey = unwrapKey(spaceKey, media.wrappedKey);
  return openMedia(mediaKey, media.sealed);
}

/** Seal a photo for storage: random media key, wrapped under the space key. */
export function sealAlbumMedia(
  spaceKey: Uint8Array,
  plaintext: Uint8Array,
  meta: Omit<AlbumMedia, 'id' | 'sealed' | 'wrappedKey'>,
  generateMediaKey: () => Uint8Array,
): AlbumMedia {
  const mediaKey = generateMediaKey();
  return {
    ...meta,
    id: `m-${meta.createdAt}-${mediaKey[0].toString(16)}${mediaKey[1].toString(16)}`,
    sealed: sealMedia(mediaKey, plaintext),
    wrappedKey: wrapKey(spaceKey, mediaKey),
  };
}

export type { AlbumMedia, AlbumRepository, SpaceBackup, SpaceKeyEnvelope };
