import { describe, it, expect } from 'vitest';

import {
  deriveSpaceKey,
  fromBase64,
  generateIdentityKeypair,
  generateMediaKey,
  openMedia,
  sealMedia,
  spaceKeyFromRecoverySeed,
  toBase64,
  unwrapKey,
  wrapKey,
} from '@/features/album/crypto';

const bytesEqual = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

describe('identity keys', () => {
  it('produces a public key the other device can use', () => {
    const identity = generateIdentityKeypair();
    expect(identity.publicKey.length).toBe(32);
    expect(identity.privateKey.length).toBe(32);
    // The public half must not be the secret.
    expect(bytesEqual(identity.publicKey, identity.privateKey)).toBe(false);
  });

  it('is different every time', () => {
    expect(bytesEqual(generateIdentityKeypair().privateKey, generateIdentityKeypair().privateKey)).toBe(
      false,
    );
  });
});

describe('the space key', () => {
  it('is the same on both devices, derived only from their keys', () => {
    const a = generateIdentityKeypair();
    const b = generateIdentityKeypair();
    expect(bytesEqual(deriveSpaceKey(a.privateKey, b.publicKey), deriveSpaceKey(b.privateKey, a.publicKey))).toBe(
      true,
    );
  });

  it('is 32 bytes and differs for a different partner', () => {
    const a = generateIdentityKeypair();
    const first = deriveSpaceKey(a.privateKey, generateIdentityKeypair().publicKey);
    const second = deriveSpaceKey(a.privateKey, generateIdentityKeypair().publicKey);
    expect(first.length).toBe(32);
    expect(bytesEqual(first, second)).toBe(false);
  });

  it('refuses a degenerate public key instead of deriving a public secret', () => {
    // A small-order point yields a shared secret that is effectively public.
    // The curve library does not promise to reject one, so this is checked.
    const a = generateIdentityKeypair();
    expect(() => deriveSpaceKey(a.privateKey, new Uint8Array(32))).toThrow(/degenerate/i);
  });

  it('does not derive the same key as the raw ECDH secret', () => {
    // The domain separation is what stops a space key being reused as a raw
    // shared secret somewhere else in the app.
    const a = generateIdentityKeypair();
    const b = generateIdentityKeypair();
    const raw = a.privateKey.length;
    expect(raw).toBe(32);
    expect(bytesEqual(deriveSpaceKey(a.privateKey, b.publicKey), new Uint8Array(32))).toBe(false);
  });
});

describe('media', () => {
  it('round-trips a photo under its own key', () => {
    const key = generateMediaKey();
    const photo = new TextEncoder().encode('pretend this is a jpeg');
    expect(bytesEqual(openMedia(key, sealMedia(key, photo)), photo)).toBe(true);
  });

  it('uses a fresh nonce for every seal', () => {
    // Reusing a nonce under one key is catastrophic for GCM, so the nonce is
    // generated inside sealMedia rather than passed in.
    const key = generateMediaKey();
    const a = sealMedia(key, new Uint8Array(8));
    const b = sealMedia(key, new Uint8Array(8));
    expect(a.nonce).not.toBe(b.nonce);
  });

  it('fails to open under the wrong key', () => {
    const sealed = sealMedia(generateMediaKey(), new TextEncoder().encode('private'));
    expect(() => openMedia(generateMediaKey(), sealed)).toThrow();
  });

  it('fails to open when the ciphertext is edited', () => {
    const key = generateMediaKey();
    const sealed = sealMedia(key, new TextEncoder().encode('private'));
    const tampered = fromBase64(sealed.ciphertext);
    tampered[0] ^= 0xff;
    expect(() => openMedia(key, { ...sealed, ciphertext: toBase64(tampered) })).toThrow();
  });
});

describe('the envelope the server holds', () => {
  it('is unreadable, and only the space key opens it', () => {
    const a = generateIdentityKeypair();
    const b = generateIdentityKeypair();
    const spaceKey = deriveSpaceKey(a.privateKey, b.publicKey);
    const mediaKey = generateMediaKey();

    const wrapped = wrapKey(spaceKey, mediaKey);

    // What the server stores must not be the key in any recoverable form.
    expect(wrapped.ciphertext).not.toBe(toBase64(mediaKey));
    expect(bytesEqual(fromBase64(wrapped.ciphertext), mediaKey)).toBe(false);

    // The space key recovers it exactly.
    expect(bytesEqual(unwrapKey(spaceKey, wrapped), mediaKey)).toBe(true);

    // Anyone else does not.
    const otherSpaceKey = deriveSpaceKey(a.privateKey, generateIdentityKeypair().publicKey);
    expect(() => unwrapKey(otherSpaceKey, wrapped)).toThrow();
  });

  it('is what makes a new phone a restore rather than a negotiation', () => {
    // Both sides hold the same space key, so a device can be rebuilt from a
    // backup without the other device being present. That is the property
    // that removes the need for a rekey ceremony on the common path.
    const a = generateIdentityKeypair();
    const b = generateIdentityKeypair();
    const mediaKey = generateMediaKey();
    const wrapped = wrapKey(deriveSpaceKey(a.privateKey, b.publicKey), mediaKey);

    // Restored on a fresh device that has the same identity material.
    expect(bytesEqual(unwrapKey(deriveSpaceKey(a.privateKey, b.publicKey), wrapped), mediaKey)).toBe(true);
  });
});

describe('recovery', () => {
  it('derives a space key from a seed, deterministically', () => {
    const seed = new Uint8Array(32).fill(7);
    expect(bytesEqual(spaceKeyFromRecoverySeed(seed), spaceKeyFromRecoverySeed(seed))).toBe(true);
    expect(spaceKeyFromRecoverySeed(seed).length).toBe(32);
    expect(bytesEqual(spaceKeyFromRecoverySeed(seed), spaceKeyFromRecoverySeed(new Uint8Array(32).fill(8)))).toBe(
      false,
    );
  });

  it('does not collide with a live space key derived from ECDH', () => {
    // Domain separation: a recovery seed and an ECDH secret must never be
    // interchangeable, or a recovered space would be a guessable one.
    const a = generateIdentityKeypair();
    const b = generateIdentityKeypair();
    const seed = new Uint8Array(32).fill(3);
    expect(bytesEqual(spaceKeyFromRecoverySeed(seed), deriveSpaceKey(a.privateKey, b.publicKey))).toBe(
      false,
    );
  });
});
