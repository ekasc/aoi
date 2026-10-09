import { gcm } from '@noble/ciphers/aes.js';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

import {
  AES_GCM_NONCE_BYTES,
  MEDIA_KEY_BYTES,
  SPACE_KEY_BYTES,
  encodeDeviceRecord,
  encodeDeviceTombstone,
  encodeEnvelopeContext,
  encodeMediaManifest,
  encodeMediaTombstone,
  encodeRecoveryEnvelopeContext,
  encodeRecoverySigningContext,
  encodeRecoveryWrapContext,
  encodeSpaceTrustAnchor,
  type DeviceRecord,
  type DeviceRecordInput,
  type DeviceTombstone,
  type DeviceTombstoneInput,
  type MediaManifest,
  type MediaManifestInput,
  type MediaTombstone,
  type MediaTombstoneInput,
  type RecoveryEnvelope,
  type SealedBytes,
  type SpaceKeyEnvelope,
  type SpaceTrustAnchor,
  type SpaceTrustAnchorInput,
} from '@aoi/shared';

/**
 * The new protocol's cryptography.
 *
 * This sits beside `crypto.ts` rather than replacing it, because that module
 * implements the old protocol and the session path still depends on it. Nothing
 * here imports from it, and nothing here knows about base64: the wire spelling
 * belongs to `album-protocol-wire.ts`, and every function below takes and
 * returns `Uint8Array` and the protocol's own types.
 *
 * The shape of the whole protocol in one paragraph. A Space has one random
 * 32-byte key that never changes. X25519 does not derive that key, it only
 * carries it: an authorised device seals the key to a new device under an ECDH
 * between their agreement keys. The 24-word phrase is a key-encryption key for
 * the same stable key, so recovery restores the archive rather than starting a
 * new one. Every seal binds an encoded context as both its HKDF input and its
 * AEAD associated data, so an envelope cannot be moved to another Space, another
 * generation, another recipient, or another revision and still open.
 */

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

function assertLength(value: Uint8Array, expected: number, label: string): void {
  if (!(value instanceof Uint8Array) || value.length !== expected) {
    throw new Error(`${label} must be ${expected} bytes`);
  }
}

/**
 * X25519, with both degenerate cases refused.
 *
 * A small-order public key yields a shared secret that is effectively public,
 * and the curve library does not promise to refuse one, so this is checked
 * rather than assumed. The old protocol checked the same two things; the check
 * is the one part of it worth carrying forward unchanged.
 */
function sharedSecret(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  assertLength(privateKey, 32, 'agreement private key');
  assertLength(publicKey, 32, 'agreement public key');
  if (publicKey.every((byte) => byte === 0)) {
    throw new Error('Refusing a degenerate public key: it would make the space key public.');
  }
  const secret = x25519.getSharedSecret(privateKey, publicKey);
  if (secret.every((byte) => byte === 0)) {
    throw new Error('Refusing a degenerate shared secret.');
  }
  return secret;
}

/** One context, used as both the HKDF info and the AEAD aad. */
function wrappingKey(privateKey: Uint8Array, publicKey: Uint8Array, context: Uint8Array): Uint8Array {
  return hkdf(sha256, sharedSecret(privateKey, publicKey), undefined, context, SPACE_KEY_BYTES);
}

// ── the Space key ────────────────────────────────────────────────────────

/**
 * One random key for the life of the Space. Never derived from a device, which
 * is what makes a replaced phone a restore rather than a new archive.
 */
export function generateSpaceKey(): Uint8Array {
  return randomBytes(SPACE_KEY_BYTES);
}

// ── device keys ──────────────────────────────────────────────────────────

export type DeviceKeyMaterial = {
  signingPrivateKey: Uint8Array;
  signingPublicKey: Uint8Array;
  agreementPrivateKey: Uint8Array;
  agreementPublicKey: Uint8Array;
};

/** A fresh device's keys. Ed25519 signs, X25519 agrees. */
export function generateDeviceKeyMaterial(): DeviceKeyMaterial {
  const signingPrivateKey = ed25519.utils.randomSecretKey();
  const agreementPrivateKey = x25519.utils.randomSecretKey();
  return {
    signingPrivateKey,
    signingPublicKey: new Uint8Array(ed25519.getPublicKey(signingPrivateKey)),
    agreementPrivateKey,
    agreementPublicKey: new Uint8Array(x25519.getPublicKey(agreementPrivateKey)),
  };
}

// ── the device envelope ──────────────────────────────────────────────────

export type SealSpaceKeyForDeviceInput = {
  spaceKey: Uint8Array;
  spaceId: string;
  generation: number;
  recipientDeviceId: string;
  authoriserDeviceId: string;
  recipientRevision: number;
  /** The authorising device's X25519 private key. */
  authoriserAgreementPrivateKey: Uint8Array;
  /** The recipient device's X25519 public key. */
  recipientAgreementPublicKey: Uint8Array;
};

export function sealSpaceKeyForDevice(input: SealSpaceKeyForDeviceInput): SpaceKeyEnvelope {
  assertLength(input.spaceKey, SPACE_KEY_BYTES, 'spaceKey');
  const context = encodeEnvelopeContext({
    spaceId: input.spaceId,
    generation: input.generation,
    recipientDeviceId: input.recipientDeviceId,
    authoriserDeviceId: input.authoriserDeviceId,
    recipientRevision: input.recipientRevision,
  });
  const key = wrappingKey(input.authoriserAgreementPrivateKey, input.recipientAgreementPublicKey, context);
  const nonce = randomBytes(AES_GCM_NONCE_BYTES);
  return {
    spaceId: input.spaceId,
    generation: input.generation,
    recipientDeviceId: input.recipientDeviceId,
    authoriserDeviceId: input.authoriserDeviceId,
    recipientRevision: input.recipientRevision,
    nonce,
    ciphertext: gcm(key, nonce, context).encrypt(input.spaceKey),
  };
}

export type OpenSpaceKeyFromEnvelopeInput = {
  envelope: SpaceKeyEnvelope;
  /** The recipient device's X25519 private key. */
  recipientAgreementPrivateKey: Uint8Array;
  /** The authorising device's X25519 public key. */
  authoriserAgreementPublicKey: Uint8Array;
};

/**
 * Open an envelope, or throw. The context is rebuilt from the envelope's own
 * fields, so a field the authoriser did not seal for fails the tag check.
 */
export function openSpaceKeyFromEnvelope(input: OpenSpaceKeyFromEnvelopeInput): Uint8Array {
  const context = encodeEnvelopeContext({
    spaceId: input.envelope.spaceId,
    generation: input.envelope.generation,
    recipientDeviceId: input.envelope.recipientDeviceId,
    authoriserDeviceId: input.envelope.authoriserDeviceId,
    recipientRevision: input.envelope.recipientRevision,
  });
  const key = wrappingKey(
    input.recipientAgreementPrivateKey,
    input.authoriserAgreementPublicKey,
    context
  );
  const spaceKey = gcm(key, input.envelope.nonce, context).decrypt(input.envelope.ciphertext);
  assertLength(spaceKey, SPACE_KEY_BYTES, 'opened space key');
  return spaceKey;
}

// ── recovery ─────────────────────────────────────────────────────────────

/**
 * One entropy value, two derivations, separate labels.
 *
 * The wrap key encrypts the Space key and the signing key authorises devices.
 * They are different jobs, so they are different keys; a shared label would let
 * either be used where the other belongs.
 */
const RECOVERY_ENTROPY_BYTES = 32;

/**
 * The phrase layer guarantees 32 bytes, but these are exported and anyone can
 * call them. A short entropy value would derive a short-lived key and fail
 * later, ambiguously, which is the worst place to find out.
 */
function assertEntropy(entropy: Uint8Array): void {
  assertLength(entropy, RECOVERY_ENTROPY_BYTES, 'recovery entropy');
}

export function deriveRecoveryWrapKey(entropy: Uint8Array): Uint8Array {
  assertEntropy(entropy);
  return hkdf(sha256, entropy, undefined, encodeRecoveryWrapContext(), SPACE_KEY_BYTES);
}

export function deriveRecoverySigningKey(entropy: Uint8Array): Uint8Array {
  assertEntropy(entropy);
  return hkdf(sha256, entropy, undefined, encodeRecoverySigningContext(), SPACE_KEY_BYTES);
}

/** The public half published in the Space's creation record. */
export function recoverySigningPublicKey(entropy: Uint8Array): Uint8Array {
  return new Uint8Array(ed25519.getPublicKey(deriveRecoverySigningKey(entropy)));
}

export type SealSpaceKeyForRecoveryInput = {
  spaceKey: Uint8Array;
  spaceId: string;
  generation: number;
  /** The 32 bytes behind the 24-word phrase. */
  entropy: Uint8Array;
};

export function sealSpaceKeyForRecovery(input: SealSpaceKeyForRecoveryInput): RecoveryEnvelope {
  assertLength(input.spaceKey, SPACE_KEY_BYTES, 'spaceKey');
  const context = encodeRecoveryEnvelopeContext({
    spaceId: input.spaceId,
    generation: input.generation,
  });
  const nonce = randomBytes(AES_GCM_NONCE_BYTES);
  return {
    spaceId: input.spaceId,
    generation: input.generation,
    nonce,
    ciphertext: gcm(deriveRecoveryWrapKey(input.entropy), nonce, context).encrypt(input.spaceKey),
  };
}

export type OpenSpaceKeyFromRecoveryEnvelopeInput = {
  envelope: RecoveryEnvelope;
  entropy: Uint8Array;
};

export function openSpaceKeyFromRecoveryEnvelope(
  input: OpenSpaceKeyFromRecoveryEnvelopeInput
): Uint8Array {
  const context = encodeRecoveryEnvelopeContext({
    spaceId: input.envelope.spaceId,
    generation: input.envelope.generation,
  });
  const spaceKey = gcm(
    deriveRecoveryWrapKey(input.entropy),
    input.envelope.nonce,
    context
  ).decrypt(input.envelope.ciphertext);
  assertLength(spaceKey, SPACE_KEY_BYTES, 'opened space key');
  return spaceKey;
}

// ── signatures ───────────────────────────────────────────────────────────
//
// Every signature covers the canonical encoding of the object without its own
// signature field, which is why the encoders take the input shapes and the
// verifiers strip the signature before encoding.

function sign(message: Uint8Array, signingPrivateKey: Uint8Array): Uint8Array {
  return new Uint8Array(ed25519.sign(message, signingPrivateKey));
}

/**
 * A malformed signature is a failed verification, not an exception. These run
 * against data an untrusted server chose, and a three-byte signature must not
 * be able to crash a caller.
 */
function verify(signature: Uint8Array, message: Uint8Array, signerPublicKey: Uint8Array): boolean {
  try {
    return ed25519.verify(signature, message, signerPublicKey);
  } catch {
    return false;
  }
}

/** A device record is signed by its authoriser: another device, or recovery. */
export function signDeviceRecord(input: DeviceRecordInput, signingPrivateKey: Uint8Array): Uint8Array {
  return sign(encodeDeviceRecord(input), signingPrivateKey);
}

export function verifyDeviceRecord(record: DeviceRecord, signerPublicKey: Uint8Array): boolean {
  const { authorisation, ...input } = record;
  return verify(authorisation, encodeDeviceRecord(input), signerPublicKey);
}

/** A device tombstone is signed by whoever revoked, which is never the target. */
export function signDeviceTombstone(
  input: DeviceTombstoneInput,
  signingPrivateKey: Uint8Array
): Uint8Array {
  return sign(encodeDeviceTombstone(input), signingPrivateKey);
}

export function verifyDeviceTombstone(
  tombstone: DeviceTombstone,
  signerPublicKey: Uint8Array
): boolean {
  const { signature, ...input } = tombstone;
  return verify(signature, encodeDeviceTombstone(input), signerPublicKey);
}

/** A media manifest is signed by the device that uploaded. */
export function signMediaManifest(
  input: MediaManifestInput,
  signingPrivateKey: Uint8Array
): Uint8Array {
  return sign(encodeMediaManifest(input), signingPrivateKey);
}

export function verifyMediaManifest(manifest: MediaManifest, signerPublicKey: Uint8Array): boolean {
  const { signature, ...input } = manifest;
  return verify(signature, encodeMediaManifest(input), signerPublicKey);
}

/**
 * A media tombstone is signed by whichever authorised device asked for the
 * removal, which is usually not the uploader: either member may remove shared
 * media, and the uploader's key is not available to the other one.
 */
export function signMediaTombstone(
  input: MediaTombstoneInput,
  signingPrivateKey: Uint8Array
): Uint8Array {
  return sign(encodeMediaTombstone(input), signingPrivateKey);
}

export function verifyMediaTombstone(
  tombstone: MediaTombstone,
  signerPublicKey: Uint8Array
): boolean {
  const { signature, ...input } = tombstone;
  return verify(signature, encodeMediaTombstone(input), signerPublicKey);
}

// ── the trust anchor ─────────────────────────────────────────────────────

/** The root device signs the anchor it publishes. */
export function signSpaceTrustAnchor(
  input: SpaceTrustAnchorInput,
  rootSigningPrivateKey: Uint8Array
): Uint8Array {
  return sign(encodeSpaceTrustAnchor(input), rootSigningPrivateKey);
}

/** The key the recovery phrase derives signs the same bytes. */
export function signSpaceTrustAnchorRecovery(
  input: SpaceTrustAnchorInput,
  recoverySigningPrivateKey: Uint8Array
): Uint8Array {
  return sign(encodeSpaceTrustAnchor(input), recoverySigningPrivateKey);
}

/**
 * Check the root's signature over an anchor.
 *
 * Not a trust decision on its own. The root key is trusted because the creator
 * pinned it or because a device verified it out of band.
 */
export function verifySpaceTrustAnchor(
  anchor: SpaceTrustAnchor,
  rootSigningPublicKey: Uint8Array
): boolean {
  const { rootSignature, recoverySignature, ...input } = anchor;
  void recoverySignature;
  return verify(rootSignature, encodeSpaceTrustAnchor(input), rootSigningPublicKey);
}

/**
 * Check the recovery signature over an anchor.
 *
 * This is the check a recovery-only client has, and it is the reason the anchor
 * carries a second signature. Comparing the recovery public key field alone
 * would accept an anchor whose root id and root key the server had swapped,
 * because the server already knows that public key. A signature over the whole
 * object cannot be produced by anyone who does not hold the phrase.
 */
export function verifySpaceTrustAnchorRecovery(
  anchor: SpaceTrustAnchor,
  recoverySigningPublicKey: Uint8Array
): boolean {
  const { rootSignature, recoverySignature, ...input } = anchor;
  void rootSignature;
  return verify(recoverySignature, encodeSpaceTrustAnchor(input), recoverySigningPublicKey);
}

// ── media ────────────────────────────────────────────────────────────────

/**
 * The media key, wrapped under the Space key.
 *
 * The same encoded context that authenticates the ciphertext binds this too, so
 * a wrapped key cannot be moved to another media or another generation and still
 * open. Two different keys — Space for the wrap, media for the payload — under
 * one binding, which is what makes a swapped `wrappedKey` a decrypt failure
 * rather than a silent substitution.
 */
export function wrapMediaKey(input: {
  spaceKey: Uint8Array;
  mediaKey: Uint8Array;
  context: Uint8Array;
}): SealedBytes {
  assertLength(input.spaceKey, SPACE_KEY_BYTES, 'spaceKey');
  assertLength(input.mediaKey, MEDIA_KEY_BYTES, 'mediaKey');
  const nonce = randomBytes(AES_GCM_NONCE_BYTES);
  return { nonce, ciphertext: gcm(input.spaceKey, nonce, input.context).encrypt(input.mediaKey) };
}

export function unwrapMediaKey(input: {
  spaceKey: Uint8Array;
  wrapped: SealedBytes;
  context: Uint8Array;
}): Uint8Array {
  assertLength(input.spaceKey, SPACE_KEY_BYTES, 'spaceKey');
  const mediaKey = gcm(input.spaceKey, input.wrapped.nonce, input.context).decrypt(
    input.wrapped.ciphertext
  );
  assertLength(mediaKey, MEDIA_KEY_BYTES, 'opened media key');
  return mediaKey;
}

export function sealMediaCiphertext(input: {
  mediaKey: Uint8Array;
  plaintext: Uint8Array;
  context: Uint8Array;
}): SealedBytes {
  assertLength(input.mediaKey, MEDIA_KEY_BYTES, 'mediaKey');
  const nonce = randomBytes(AES_GCM_NONCE_BYTES);
  return { nonce, ciphertext: gcm(input.mediaKey, nonce, input.context).encrypt(input.plaintext) };
}

/**
 * Open, or throw. A failed tag check means the bytes are not the ones this
 * manifest describes, and there is deliberately no softer outcome than that.
 */
export function openMediaCiphertext(input: {
  mediaKey: Uint8Array;
  sealed: SealedBytes;
  context: Uint8Array;
}): Uint8Array {
  assertLength(input.mediaKey, MEDIA_KEY_BYTES, 'mediaKey');
  return gcm(input.mediaKey, input.sealed.nonce, input.context).decrypt(input.sealed.ciphertext);
}
