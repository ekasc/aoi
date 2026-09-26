import { gcm } from '@noble/ciphers/aes.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

/**
 * The cryptographic core of the shared album.
 *
 * Everything here is on device. The server holds ciphertext and nothing else:
 * no photos, no key material, and no ability to substitute a key without the
 * substitution being detectable. That is the whole promise, and this file is
 * where it is either true or not.
 *
 * Three layers, deliberately separate:
 *
 *   identity key   per device, long-lived, in the keychain. Never leaves.
 *   space key      ECDH between the two identities, held by both. Wraps
 *                  everything else, so the server can store wrapped keys.
 *   media key      per photo, random, wraps exactly one photo. The server
 *                  gets the wrapped form; the space key is the only thing
 *                  that unwraps it.
 *
 * The split is what makes "the server is an unreadable backup" possible. A
 * device can be backed up and restored without the backup being readable,
 * because what is backed up is a media key wrapped under a key the server
 * does not have.
 */

const KEY_BYTES = 32;
const NONCE_BYTES = 12;

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** Public key material is not secret, so it travels as base64. */
export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

export function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

// ── identity ─────────────────────────────────────────────────────────────

export type IdentityKeypair = {
  /** Secret. Goes in the keychain and nowhere else, ever. */
  privateKey: Uint8Array;
  /** Safe to publish. This is what the other device needs. */
  publicKey: Uint8Array;
};

export function generateIdentityKeypair(): IdentityKeypair {
  const privateKey = x25519.utils.randomSecretKey();
  return { privateKey, publicKey: x25519.getPublicKey(privateKey) };
}

/**
 * X25519. Both devices run this once and arrive at the same space key without
 * ever sending the secret anywhere.
 *
 * The all-zero public key is rejected explicitly. A small-order point yields
 * a shared secret that is effectively public, and the curve library does not
 * guarantee it will refuse one, so this is checked rather than assumed.
 */
export function deriveSpaceKey(
  myPrivateKey: Uint8Array,
  theirPublicKey: Uint8Array,
): Uint8Array {
  const isAllZero = theirPublicKey.every((byte) => byte === 0);
  if (isAllZero) {
    throw new Error('Refusing a degenerate public key: it would make the space key public.');
  }
  const shared = x25519.getSharedSecret(myPrivateKey, theirPublicKey);
  if (shared.every((byte) => byte === 0)) {
    throw new Error('Refusing a degenerate shared secret.');
  }
  return hkdf(sha256, shared, undefined, utf8('aoi/space-key/v1'), KEY_BYTES);
}

// ── media ────────────────────────────────────────────────────────────────

/** A one-photo key. Random, never derived, so one leak exposes one photo. */
export function generateMediaKey(): Uint8Array {
  return randomBytes(KEY_BYTES);
}

export type SealedMedia = {
  /** base64 nonce. Stored alongside the ciphertext; it is not secret. */
  nonce: string;
  /** base64 ciphertext with the GCM tag appended. */
  ciphertext: string;
};

/**
 * Encrypt bytes under a media key. A fresh nonce every time, from the OS CSPRNG.
 * Reusing a nonce under one key is catastrophic for GCM, so the nonce is
 * generated inside this function rather than accepted from a caller.
 */
export function sealMedia(mediaKey: Uint8Array, plaintext: Uint8Array): SealedMedia {
  const nonce = randomBytes(NONCE_BYTES);
  return {
    nonce: toBase64(nonce),
    ciphertext: toBase64(gcm(mediaKey, nonce).encrypt(plaintext)),
  };
}

/**
 * Decrypt, or throw. A failed tag check means the bytes were tampered with or
 * the key is wrong, and those are indistinguishable on purpose: the caller
 * must not be able to tell "someone edited this" from "you have the wrong
 * key", because that difference is itself an oracle.
 */
export function openMedia(mediaKey: Uint8Array, sealed: SealedMedia): Uint8Array {
  return gcm(mediaKey, fromBase64(sealed.nonce)).decrypt(fromBase64(sealed.ciphertext));
}

// ── wrapping ─────────────────────────────────────────────────────────────

/**
 * Wrap a key under another. This is the envelope the server stores: a device
 * key, or a media key, wrapped under the space key. The server can hold it,
 * hand it back, and still read nothing.
 */
export function wrapKey(wrappingKey: Uint8Array, keyToWrap: Uint8Array): SealedMedia {
  return sealMedia(wrappingKey, keyToWrap);
}

export function unwrapKey(wrappingKey: Uint8Array, wrapped: SealedMedia): Uint8Array {
  return openMedia(wrappingKey, wrapped);
}

// ── recovery phrase ───────────────────────────────────────────────────────

/**
 * The single recovery path, for the case where both phones are gone.
 *
 * A 24-word phrase from a 2048-word list is 264 bits of entropy, reduced to
 * 256 because that is what a space key needs. It is the only mechanism in
 * this design that works with no devices present at all, which is exactly why
 * it exists and exactly why there is only one of them.
 *
 * Deriving from a passphrase with HKDF directly would be weak: a human-chosen
 * phrase has far less entropy than its word count suggests. So this is for
 * generating a phrase to show once, never for typing an arbitrary one.
 */
export const RECOVERY_WORD_COUNT = 24;

export function spaceKeyFromRecoverySeed(seed: Uint8Array): Uint8Array {
  return hkdf(sha256, seed, utf8('aoi/recovery/v1'), utf8('aoi/space-key/v1'), KEY_BYTES);
}
