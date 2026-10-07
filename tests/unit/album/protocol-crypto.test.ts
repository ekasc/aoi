import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { describe, expect, it } from 'vitest';

import {
  deriveRecoverySigningKey,
  deriveRecoveryWrapKey,
  generateSpaceKey,
  openSpaceKeyFromEnvelope,
  openSpaceKeyFromRecoveryEnvelope,
  recoverySigningPublicKey,
  sealSpaceKeyForDevice,
  sealSpaceKeyForRecovery,
  signDeviceRecord,
  signDeviceTombstone,
  signMediaManifest,
  signMediaTombstone,
  signSpaceTrustAnchor,
  signSpaceTrustAnchorRecovery,
  verifyDeviceRecord,
  verifyDeviceTombstone,
  verifyMediaManifest,
  verifyMediaTombstone,
  verifySpaceTrustAnchor,
  verifySpaceTrustAnchorRecovery,
} from '@/features/album/protocol-crypto';
import { generateRecoveryPhrase, recoveryEntropyFromPhrase } from '@/features/album/recovery';
import type { SpaceKeyEnvelope } from '@aoi/shared';

const SPACE = 'space-1';
const GENERATION = 1;
const AT = '2026-01-01T00:00:00.000Z';

// Generated here rather than through either module's key helpers: this suite
// tests the new protocol and should not depend on the old one, or on the
// helpers the new one has not grown yet.
const device = () => {
  const agreementPrivateKey = x25519.utils.randomSecretKey();
  const signingPrivateKey = ed25519.utils.randomSecretKey();
  return {
    agreement: {
      privateKey: agreementPrivateKey,
      publicKey: new Uint8Array(x25519.getPublicKey(agreementPrivateKey)),
    },
    signing: {
      privateKey: signingPrivateKey,
      publicKey: new Uint8Array(ed25519.getPublicKey(signingPrivateKey)),
    },
  };
};

type Device = ReturnType<typeof device>;

/** Seal the key to B, and hand back an opener bound to B's private key. */
function envelopeCase(overrides: Partial<Parameters<typeof sealSpaceKeyForDevice>[0]> = {}) {
  const spaceKey = generateSpaceKey();
  const alice = device();
  const bob = device();
  const envelope = sealSpaceKeyForDevice({
    spaceKey,
    spaceId: SPACE,
    generation: GENERATION,
    recipientDeviceId: 'device-b',
    authoriserDeviceId: 'device-a',
    recipientRevision: 1,
    authoriserAgreementPrivateKey: alice.agreement.privateKey,
    recipientAgreementPublicKey: bob.agreement.publicKey,
    ...overrides,
  });
  const open = (candidate: SpaceKeyEnvelope, recipient: Device = bob, authoriser: Device = alice) =>
    openSpaceKeyFromEnvelope({
      envelope: candidate,
      recipientAgreementPrivateKey: recipient.agreement.privateKey,
      authoriserAgreementPublicKey: authoriser.agreement.publicKey,
    });
  return { spaceKey, envelope, open, alice, bob };
}

const recordInput = (signer: Device) => ({
  deviceId: 'device-a',
  spaceId: SPACE,
  signingPublicKey: signer.signing.publicKey,
  agreementPublicKey: signer.agreement.publicKey,
  authorisedBy: { kind: 'self' as const },
  revision: 1,
  createdAt: AT,
});

const deviceTombstoneInput = () => ({
  spaceId: SPACE,
  targetDeviceId: 'device-b',
  revision: 2,
  revokedBy: { kind: 'device' as const, deviceId: 'device-a' },
  revokedAt: AT,
});

const manifestInput = () => ({
  mediaId: 'm-1',
  spaceId: SPACE,
  generation: GENERATION,
  revision: 1,
  wrappedKey: { nonce: new Uint8Array(12).fill(3), ciphertext: new Uint8Array(48).fill(4) },
  sealedNonce: new Uint8Array(12).fill(5),
  byteLength: 1024,
  mimeType: 'image/jpeg',
  width: 640,
  height: 480,
  uploaderDeviceId: 'device-a',
  createdAt: AT,
});

const mediaTombstoneInput = () => ({
  spaceId: SPACE,
  mediaId: 'm-1',
  revision: 2,
  deletedAt: AT,
  deletedByDeviceId: 'device-b',
});

describe('the Space key', () => {
  it('is 32 random bytes, different every time', () => {
    const first = generateSpaceKey();
    expect(first).toHaveLength(32);
    expect(generateSpaceKey()).not.toEqual(first);
  });
});

/**
 * The invariant the whole redesign exists for. One stable key reaches a second
 * device through an envelope and a fresh device through the phrase, and both
 * arrive at the same key. If this passes, replacement is a restore and recovery
 * restores rather than starts over.
 */
describe('one key, two ways to reach it', () => {
  it('carries the same Space key to a new device and through the recovery phrase', () => {
    const spaceKey = generateSpaceKey();
    const alice = device();
    const bob = device();

    const envelope = sealSpaceKeyForDevice({
      spaceKey,
      spaceId: SPACE,
      generation: GENERATION,
      recipientDeviceId: 'device-b',
      authoriserDeviceId: 'device-a',
      recipientRevision: 1,
      authoriserAgreementPrivateKey: alice.agreement.privateKey,
      recipientAgreementPublicKey: bob.agreement.publicKey,
    });
    const throughEnvelope = openSpaceKeyFromEnvelope({
      envelope,
      recipientAgreementPrivateKey: bob.agreement.privateKey,
      authoriserAgreementPublicKey: alice.agreement.publicKey,
    });

    const phrase = generateRecoveryPhrase();
    const recoveryEnvelope = sealSpaceKeyForRecovery({
      spaceKey,
      spaceId: SPACE,
      generation: GENERATION,
      entropy: recoveryEntropyFromPhrase(phrase),
    });
    const throughPhrase = openSpaceKeyFromRecoveryEnvelope({
      envelope: recoveryEnvelope,
      entropy: recoveryEntropyFromPhrase(phrase),
    });

    expect(throughEnvelope).toEqual(spaceKey);
    expect(throughPhrase).toEqual(spaceKey);
  });
});

describe('the device envelope', () => {
  it('opens for the device it was sealed to', () => {
    const { spaceKey, envelope, open } = envelopeCase();
    expect(open(envelope)).toEqual(spaceKey);
  });

  it('refuses a third device', () => {
    const { envelope, open } = envelopeCase();
    expect(() => open(envelope, device())).toThrow();
  });

  it('refuses an envelope whose authoriser is not the one that sealed it', () => {
    const { envelope, open } = envelopeCase();
    expect(() => open(envelope, undefined, device())).toThrow();
  });

  it('binds every field it claims to bind', () => {
    const patches: Array<Partial<SpaceKeyEnvelope>> = [
      { spaceId: 'space-2' },
      { generation: 2 },
      { recipientDeviceId: 'device-c' },
      { authoriserDeviceId: 'device-z' },
      { recipientRevision: 2 },
    ];
    for (const patch of patches) {
      const { envelope, open } = envelopeCase();
      // The unmodified envelope opens, so the failure below is the patch.
      expect(open(envelope)).toBeDefined();
      expect(() => open({ ...envelope, ...patch })).toThrow();
    }
  });

  it('refuses a tampered ciphertext', () => {
    const { envelope, open } = envelopeCase();
    const flipped = Uint8Array.from(envelope.ciphertext);
    flipped[0] ^= 0x01;
    expect(() => open({ ...envelope, ciphertext: flipped })).toThrow();
  });

  it('refuses a degenerate recipient public key', () => {
    expect(() =>
      envelopeCase({ recipientAgreementPublicKey: new Uint8Array(32) })
    ).toThrow(/degenerate/i);
  });

  it('refuses a degenerate authoriser public key', () => {
    const { envelope, open } = envelopeCase();
    expect(() =>
      openSpaceKeyFromEnvelope({
        envelope,
        recipientAgreementPrivateKey: device().agreement.privateKey,
        authoriserAgreementPublicKey: new Uint8Array(32),
      })
    ).toThrow(/degenerate/i);
  });

  it('refuses a key that is not 32 bytes', () => {
    expect(() => envelopeCase({ spaceKey: new Uint8Array(31) })).toThrow(/32 bytes/);
  });
});

describe('recovery', () => {
  it('derives both keys deterministically, and differently from each other', () => {
    const phrase = generateRecoveryPhrase();
    const entropy = recoveryEntropyFromPhrase(phrase);
    expect(deriveRecoveryWrapKey(entropy)).toEqual(deriveRecoveryWrapKey(entropy));
    expect(deriveRecoverySigningKey(entropy)).toEqual(deriveRecoverySigningKey(entropy));
    expect(deriveRecoveryWrapKey(entropy)).not.toEqual(deriveRecoverySigningKey(entropy));

    const other = recoveryEntropyFromPhrase(generateRecoveryPhrase());
    expect(deriveRecoveryWrapKey(other)).not.toEqual(deriveRecoveryWrapKey(entropy));
  });

  it('refuses entropy that is not 32 bytes', () => {
    // The phrase layer guarantees this, but these are exported and anyone can
    // call them. A short value would derive a key and fail later, ambiguously.
    expect(() => deriveRecoveryWrapKey(new Uint8Array(31))).toThrow(/32 bytes/);
    expect(() => deriveRecoverySigningKey(new Uint8Array(31))).toThrow(/32 bytes/);
    expect(() => deriveRecoveryWrapKey(new Uint8Array(0))).toThrow(/32 bytes/);
  });

  it('publishes the signing half of the phrase', () => {
    const entropy = recoveryEntropyFromPhrase(generateRecoveryPhrase());
    expect(recoverySigningPublicKey(entropy)).toHaveLength(32);
    expect(recoverySigningPublicKey(entropy)).toEqual(recoverySigningPublicKey(entropy));
  });

  it('opens the stable key for the phrase that sealed it', () => {
    const spaceKey = generateSpaceKey();
    const entropy = recoveryEntropyFromPhrase(generateRecoveryPhrase());
    const envelope = sealSpaceKeyForRecovery({ spaceKey, spaceId: SPACE, generation: GENERATION, entropy });
    expect(openSpaceKeyFromRecoveryEnvelope({ envelope, entropy })).toEqual(spaceKey);
  });

  it('refuses a different phrase', () => {
    const spaceKey = generateSpaceKey();
    const entropy = recoveryEntropyFromPhrase(generateRecoveryPhrase());
    const envelope = sealSpaceKeyForRecovery({ spaceKey, spaceId: SPACE, generation: GENERATION, entropy });
    const wrong = recoveryEntropyFromPhrase(generateRecoveryPhrase());
    expect(() => openSpaceKeyFromRecoveryEnvelope({ envelope, entropy: wrong })).toThrow();
  });

  it('binds the Space and the generation', () => {
    const spaceKey = generateSpaceKey();
    const entropy = recoveryEntropyFromPhrase(generateRecoveryPhrase());
    const envelope = sealSpaceKeyForRecovery({ spaceKey, spaceId: SPACE, generation: GENERATION, entropy });
    expect(() => openSpaceKeyFromRecoveryEnvelope({ envelope: { ...envelope, spaceId: 'space-2' }, entropy })).toThrow();
    expect(() => openSpaceKeyFromRecoveryEnvelope({ envelope: { ...envelope, generation: 2 }, entropy })).toThrow();
  });
});

describe('signatures', () => {
  it('verifies a device record from its authoriser, and nothing else', () => {
    const signer = device();
    const input = recordInput(signer);
    const record = { ...input, authorisation: signDeviceRecord(input, signer.signing.privateKey) };

    expect(verifyDeviceRecord(record, signer.signing.publicKey)).toBe(true);
    expect(verifyDeviceRecord(record, device().signing.publicKey)).toBe(false);
    expect(verifyDeviceRecord({ ...record, revision: 2 }, signer.signing.publicKey)).toBe(false);
    expect(verifyDeviceRecord({ ...record, spaceId: 'space-2' }, signer.signing.publicKey)).toBe(false);
    expect(verifyDeviceRecord({ ...record, authorisedBy: { kind: 'recovery' } }, signer.signing.publicKey)).toBe(false);
    expect(verifyDeviceRecord({ ...record, authorisation: new Uint8Array(3) }, signer.signing.publicKey)).toBe(false);
  });

  it('verifies a device tombstone, and refuses a modified one', () => {
    const signer = device();
    const input = deviceTombstoneInput();
    const tombstone = { ...input, signature: signDeviceTombstone(input, signer.signing.privateKey) };

    expect(verifyDeviceTombstone(tombstone, signer.signing.publicKey)).toBe(true);
    expect(verifyDeviceTombstone({ ...tombstone, revision: 3 }, signer.signing.publicKey)).toBe(false);
    expect(verifyDeviceTombstone({ ...tombstone, targetDeviceId: 'device-c' }, signer.signing.publicKey)).toBe(false);
    expect(verifyDeviceTombstone({ ...tombstone, revokedBy: { kind: 'recovery' } }, signer.signing.publicKey)).toBe(false);
    expect(verifyDeviceTombstone(tombstone, device().signing.publicKey)).toBe(false);
  });

  it('verifies a media manifest, and refuses a modified one', () => {
    const signer = device();
    const input = manifestInput();
    const manifest = { ...input, signature: signMediaManifest(input, signer.signing.privateKey) };

    expect(verifyMediaManifest(manifest, signer.signing.publicKey)).toBe(true);
    expect(verifyMediaManifest({ ...manifest, width: 100 }, signer.signing.publicKey)).toBe(false);
    expect(verifyMediaManifest({ ...manifest, byteLength: 2048 }, signer.signing.publicKey)).toBe(false);
    expect(verifyMediaManifest({ ...manifest, uploaderDeviceId: 'device-b' }, signer.signing.publicKey)).toBe(false);
    expect(verifyMediaManifest({ ...manifest, sealedNonce: new Uint8Array(12).fill(9) }, signer.signing.publicKey)).toBe(false);
    expect(verifyMediaManifest(manifest, device().signing.publicKey)).toBe(false);
  });

  it('verifies a media tombstone signed by a device that is not the uploader', () => {
    const signer = device();
    const input = mediaTombstoneInput();
    const tombstone = { ...input, signature: signMediaTombstone(input, signer.signing.privateKey) };

    expect(verifyMediaTombstone(tombstone, signer.signing.publicKey)).toBe(true);
    expect(verifyMediaTombstone({ ...tombstone, deletedAt: '2026-02-01T00:00:00.000Z' }, signer.signing.publicKey)).toBe(false);
    expect(verifyMediaTombstone({ ...tombstone, mediaId: 'm-2' }, signer.signing.publicKey)).toBe(false);
    expect(verifyMediaTombstone(tombstone, device().signing.publicKey)).toBe(false);
  });

  it('treats a malformed signature as a failed verification rather than a throw', () => {
    const signer = device();
    const input = recordInput(signer);
    for (const bad of [new Uint8Array(0), new Uint8Array(3), new Uint8Array(64)]) {
      expect(verifyDeviceRecord({ ...input, authorisation: bad }, signer.signing.publicKey)).toBe(false);
    }
  });
});

describe('the Space trust anchor', () => {
  const recoveryEntropy = recoveryEntropyFromPhrase(generateRecoveryPhrase());
  const recoveryPrivateKey = deriveRecoverySigningKey(recoveryEntropy);
  const recoveryPublicKey = recoverySigningPublicKey(recoveryEntropy);

  const anchorInput = (root: Device, overrides: Record<string, unknown> = {}) => ({
    spaceId: SPACE,
    rootDeviceId: 'device-root',
    rootSigningPublicKey: root.signing.publicKey,
    recoverySigningPublicKey: recoveryPublicKey,
    createdAt: AT,
    ...overrides,
  });

  const anchorFor = (root: Device) => {
    const input = anchorInput(root);
    return {
      ...input,
      rootSignature: signSpaceTrustAnchor(input, root.signing.privateKey),
      recoverySignature: signSpaceTrustAnchorRecovery(input, recoveryPrivateKey),
    };
  };

  it('carries a root signature that verifies against the root key, and nothing else', () => {
    const root = device();
    const anchor = anchorFor(root);

    expect(verifySpaceTrustAnchor(anchor, root.signing.publicKey)).toBe(true);
    expect(verifySpaceTrustAnchor(anchor, device().signing.publicKey)).toBe(false);
    expect(verifySpaceTrustAnchor({ ...anchor, rootDeviceId: 'device-other' }, root.signing.publicKey)).toBe(false);
    expect(
      verifySpaceTrustAnchor(
        { ...anchor, recoverySigningPublicKey: device().signing.publicKey },
        root.signing.publicKey
      )
    ).toBe(false);
  });

  it('carries a recovery signature that verifies against the derived key, and nothing else', () => {
    const anchor = anchorFor(device());

    expect(verifySpaceTrustAnchorRecovery(anchor, recoveryPublicKey)).toBe(true);
    expect(verifySpaceTrustAnchorRecovery(anchor, device().signing.publicKey)).toBe(false);
    expect(verifySpaceTrustAnchorRecovery({ ...anchor, rootDeviceId: 'device-other' }, recoveryPublicKey)).toBe(false);

    const otherPhrase = recoverySigningPublicKey(recoveryEntropyFromPhrase(generateRecoveryPhrase()));
    expect(verifySpaceTrustAnchorRecovery(anchor, otherPhrase)).toBe(false);
  });

  /**
   * The attack the second signature exists for. The server knows the legitimate
   * recovery public key, because it is public, so an anchor that only had to
   * agree with that field could have its root swapped for one the server holds
   * the key to. The root signature would still verify, against the server's own
   * fake root. Only a signature the phrase produces closes it.
   */
  it('refuses an anchor whose root was swapped while the recovery key was kept', () => {
    const legitimate = anchorFor(device());
    const attackerRoot = device();
    const swappedInput = anchorInput(attackerRoot, {
      rootDeviceId: 'device-attacker',
      rootSigningPublicKey: attackerRoot.signing.publicKey,
    });
    const swapped = {
      ...swappedInput,
      rootSignature: signSpaceTrustAnchor(swappedInput, attackerRoot.signing.privateKey),
      recoverySignature: legitimate.recoverySignature,
    };

    // The field the naive check compares still matches the phrase.
    expect(swapped.recoverySigningPublicKey).toEqual(recoveryPublicKey);
    // The root signature verifies, against the attacker's key, which is why it
    // cannot be the recovery path's check.
    expect(verifySpaceTrustAnchor(swapped, attackerRoot.signing.publicKey)).toBe(true);
    // The recovery signature does not, because the attacker does not hold the
    // phrase.
    expect(verifySpaceTrustAnchorRecovery(swapped, recoveryPublicKey)).toBe(false);
  });
});
