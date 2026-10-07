import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { describe, expect, it } from 'vitest';

import {
  deriveRecoverySigningKey,
  generateSpaceKey,
  recoverySigningPublicKey,
  sealSpaceKeyForRecovery,
  signDeviceRecord,
  signSpaceTrustAnchor,
  signSpaceTrustAnchorRecovery,
} from '@/features/album/protocol-crypto';
import { recoverSpaceFromPhrase } from '@/features/album/protocol-recovery';
import { verifyDeviceTrust } from '@/features/album/protocol-trust';
import { generateRecoveryPhrase, recoveryEntropyFromPhrase } from '@/features/album/recovery';
import type { DeviceRecord, SpaceTrustAnchor } from '@aoi/shared';

const SPACE = 'space-1';
const OTHER_SPACE = 'space-2';
const AT = '2026-01-01T00:00:00.000Z';
const ROOT = 'device-root';

function keys() {
  const signingPrivateKey = ed25519.utils.randomSecretKey();
  const agreementPrivateKey = x25519.utils.randomSecretKey();
  return {
    signingPrivateKey,
    signingPublicKey: new Uint8Array(ed25519.getPublicKey(signingPrivateKey)),
    agreementPrivateKey,
    agreementPublicKey: new Uint8Array(x25519.getPublicKey(agreementPrivateKey)),
  };
}

type Keys = ReturnType<typeof keys>;

/**
 * A whole Space, as it would exist before any recovery: the phrase, the anchor
 * it signed, the root's own record, and an archive already sealed under the
 * stable key.
 */
function setup() {
  const phrase = generateRecoveryPhrase();
  const entropy = recoveryEntropyFromPhrase(phrase);
  const recoveryPrivateKey = deriveRecoverySigningKey(entropy);
  const recoveryPublicKey = recoverySigningPublicKey(entropy);

  const root = keys();
  const anchorInput = {
    spaceId: SPACE,
    rootDeviceId: ROOT,
    rootSigningPublicKey: root.signingPublicKey,
    recoverySigningPublicKey: recoveryPublicKey,
    createdAt: AT,
  };
  const anchor: SpaceTrustAnchor = {
    ...anchorInput,
    rootSignature: signSpaceTrustAnchor(anchorInput, root.signingPrivateKey),
    recoverySignature: signSpaceTrustAnchorRecovery(anchorInput, recoveryPrivateKey),
  };

  const rootRecordInput = {
    deviceId: ROOT,
    spaceId: SPACE,
    signingPublicKey: root.signingPublicKey,
    agreementPublicKey: root.agreementPublicKey,
    authorisedBy: { kind: 'self' as const },
    revision: 1,
    createdAt: AT,
  };
  const rootRecord: DeviceRecord = {
    ...rootRecordInput,
    authorisation: signDeviceRecord(rootRecordInput, root.signingPrivateKey),
  };

  const spaceKey = generateSpaceKey();
  const recoveryEnvelope = sealSpaceKeyForRecovery({ spaceKey, spaceId: SPACE, generation: 1, entropy });

  const input = {
    phrase,
    expectedSpaceId: SPACE,
    anchor,
    recoveryEnvelope,
    deviceId: 'device-new',
    createdAt: AT,
  };

  return {
    phrase,
    entropy,
    recoveryPrivateKey,
    recoveryPublicKey,
    root,
    anchorInput,
    anchor,
    rootRecord,
    spaceKey,
    recoveryEnvelope,
    input,
  };
}

/**
 * The whole point, end to end: a device with no pinned anchor, no trusted device
 * and no key, holding only the phrase, authenticates the real anchor, opens the
 * key the archive was already sealed under, and enrols itself in a way the trust
 * walker accepts.
 */
describe('recovering a Space from the phrase alone', () => {
  it('authenticates the anchor, opens the pre-existing key, and enrols the device', () => {
    const { spaceKey, rootRecord, anchor, input } = setup();

    const result = recoverSpaceFromPhrase(input);
    expect(result.recovered).toBe(true);
    if (!result.recovered) {
      return;
    }

    // The same stable key the archive was sealed under, not a new one.
    expect(result.spaceKey).toEqual(spaceKey);
    expect(result.record.authorisedBy).toEqual({ kind: 'recovery' });
    expect(result.record.revision).toBe(1);
    expect(result.record.spaceId).toBe(anchor.spaceId);
    expect(result.record.signingPublicKey).toEqual(result.device.signingPublicKey);

    // And the record the bootstrap produced is one the walker accepts, which is
    // the half a crypto-only test would not check.
    expect(verifyDeviceTrust(result.record.deviceId, anchor, [rootRecord, result.record])).toEqual({
      trusted: true,
    });
  });
});

describe('what a hostile server cannot do to recovery', () => {
  it('cannot swap the root while keeping the legitimate recovery key', () => {
    const s = setup();
    const attackerRoot = keys();
    const swappedInput = {
      ...s.anchorInput,
      rootDeviceId: 'device-attacker',
      rootSigningPublicKey: attackerRoot.signingPublicKey,
    };
    const swapped: SpaceTrustAnchor = {
      ...swappedInput,
      // The server keeps the recovery public key field, which it knows, and
      // signs the rest with its own fake root.
      rootSignature: signSpaceTrustAnchor(swappedInput, attackerRoot.signingPrivateKey),
      recoverySignature: s.anchor.recoverySignature,
    };

    expect(swapped.recoverySigningPublicKey).toEqual(s.recoveryPublicKey);
    expect(recoverSpaceFromPhrase({ ...s.input, anchor: swapped })).toEqual({
      recovered: false,
      reason: 'invalid-recovery-signature',
    });
  });

  it('cannot corrupt the root signature while leaving the recovery signature valid', () => {
    const s = setup();
    const corrupted = { ...s.anchor, rootSignature: new Uint8Array(64) };
    expect(recoverSpaceFromPhrase({ ...s.input, anchor: corrupted })).toEqual({
      recovered: false,
      reason: 'invalid-root-signature',
    });
  });

  it('cannot hand over an anchor from another Space', () => {
    const s = setup();
    const elsewhereInput = { ...s.anchorInput, spaceId: OTHER_SPACE };
    const elsewhere: SpaceTrustAnchor = {
      ...elsewhereInput,
      rootSignature: signSpaceTrustAnchor(elsewhereInput, s.root.signingPrivateKey),
      recoverySignature: signSpaceTrustAnchorRecovery(elsewhereInput, s.recoveryPrivateKey),
    };
    expect(recoverSpaceFromPhrase({ ...s.input, anchor: elsewhere })).toEqual({
      recovered: false,
      reason: 'wrong-space',
    });
  });

  it('cannot move the recovery envelope to another Space', () => {
    const s = setup();
    const elsewhere = { ...s.recoveryEnvelope, spaceId: OTHER_SPACE };
    expect(recoverSpaceFromPhrase({ ...s.input, recoveryEnvelope: elsewhere })).toEqual({
      recovered: false,
      reason: 'recovery-envelope-invalid',
    });
  });

  it('cannot change the envelope generation', () => {
    const s = setup();
    const moved = { ...s.recoveryEnvelope, generation: 2 };
    expect(recoverSpaceFromPhrase({ ...s.input, recoveryEnvelope: moved })).toEqual({
      recovered: false,
      reason: 'recovery-envelope-invalid',
    });
  });

  it('cannot tamper with the envelope ciphertext', () => {
    const s = setup();
    const flipped = Uint8Array.from(s.recoveryEnvelope.ciphertext);
    flipped[0] ^= 0x01;
    expect(recoverSpaceFromPhrase({ ...s.input, recoveryEnvelope: { ...s.recoveryEnvelope, ciphertext: flipped } })).toEqual({
      recovered: false,
      reason: 'recovery-envelope-invalid',
    });
  });
});

describe('the phrase itself', () => {
  it('refuses a phrase that is not a phrase', () => {
    const s = setup();
    expect(recoverSpaceFromPhrase({ ...s.input, phrase: 'abandon ability able' })).toEqual({
      recovered: false,
      reason: 'invalid-phrase',
    });
  });

  it('refuses a different but valid phrase, naming the key mismatch rather than the phrase', () => {
    const s = setup();
    const other = generateRecoveryPhrase();
    expect(recoverSpaceFromPhrase({ ...s.input, phrase: other })).toEqual({
      recovered: false,
      reason: 'anchor-recovery-key-mismatch',
    });
  });
});

describe('a failed recovery leaves nothing behind', () => {
  it('returns no device material when any check fails', () => {
    const s = setup();
    const corrupted = { ...s.anchor, rootSignature: new Uint8Array(64) };
    const result = recoverSpaceFromPhrase({ ...s.input, anchor: corrupted });

    expect(result.recovered).toBe(false);
    expect('device' in result).toBe(false);
    expect('record' in result).toBe(false);
    expect('spaceKey' in result).toBe(false);
  });
});

describe('the enrolled record is still a signed object', () => {
  it('rejects a record the server modified after it was signed', () => {
    const s = setup();
    const result = recoverSpaceFromPhrase(s.input);
    if (!result.recovered) {
      throw new Error('expected recovery to succeed');
    }

    const tampered: DeviceRecord = { ...result.record, revision: 2 };
    expect(verifyDeviceTrust(tampered.deviceId, s.anchor, [s.rootRecord, tampered]).trusted).toBe(false);
    expect(verifyDeviceTrust(result.record.deviceId, s.anchor, [s.rootRecord, result.record])).toEqual({
      trusted: true,
    });
  });
});
