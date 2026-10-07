import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { describe, expect, it } from 'vitest';

import {
  deriveRecoverySigningKey,
  recoverySigningPublicKey,
  signDeviceRecord,
  signDeviceTombstone,
  signSpaceTrustAnchor,
} from '@/features/album/protocol-crypto';
import { verifyDeviceTrust } from '@/features/album/protocol-trust';
import { generateRecoveryPhrase, recoveryEntropyFromPhrase } from '@/features/album/recovery';
import type { DeviceRecord, DeviceTombstone, SpaceTrustAnchor } from '@aoi/shared';

const SPACE = 'space-1';
const OTHER_SPACE = 'space-2';
const AT = '2026-01-01T00:00:00.000Z';
const ROOT = 'device-root';

const recoveryEntropy = recoveryEntropyFromPhrase(generateRecoveryPhrase());
const recoveryPrivateKey = deriveRecoverySigningKey(recoveryEntropy);
const recoveryPublicKey = recoverySigningPublicKey(recoveryEntropy);

function keys() {
  const signingPrivateKey = ed25519.utils.randomSecretKey();
  const agreementPrivateKey = x25519.utils.randomSecretKey();
  return {
    signingPrivateKey,
    signingPublicKey: new Uint8Array(ed25519.getPublicKey(signingPrivateKey)),
    agreementPublicKey: new Uint8Array(x25519.getPublicKey(agreementPrivateKey)),
  };
}

type Keys = ReturnType<typeof keys>;

function anchorFor(root: Keys, overrides: Partial<SpaceTrustAnchor> = {}): SpaceTrustAnchor {
  const input = {
    spaceId: SPACE,
    rootDeviceId: ROOT,
    rootSigningPublicKey: root.signingPublicKey,
    recoverySigningPublicKey: recoveryPublicKey,
    createdAt: AT,
  };
  return { ...input, signature: signSpaceTrustAnchor(input, root.signingPrivateKey), ...overrides };
}

function record(
  deviceId: string,
  device: Keys,
  authorisedBy: DeviceRecord['authorisedBy'],
  revision: number,
  signerPrivateKey: Uint8Array,
  spaceId = SPACE
): DeviceRecord {
  const input = {
    deviceId,
    spaceId,
    signingPublicKey: device.signingPublicKey,
    agreementPublicKey: device.agreementPublicKey,
    authorisedBy,
    revision,
    createdAt: AT,
  };
  return { ...input, authorisation: signDeviceRecord(input, signerPrivateKey) };
}

function tombstone(
  targetDeviceId: string,
  revision: number,
  revokedBy: DeviceTombstone['revokedBy'],
  signerPrivateKey: Uint8Array,
  spaceId = SPACE
): DeviceTombstone {
  const input = { spaceId, targetDeviceId, revision, revokedBy, revokedAt: AT };
  return { ...input, signature: signDeviceTombstone(input, signerPrivateKey) };
}

/** The three-device tree the adversarial cases are built on. */
function tree() {
  const root = keys();
  const middle = keys();
  const leaf = keys();
  const anchor = anchorFor(root);
  const rootRecord = record(ROOT, root, { kind: 'self' }, 1, root.signingPrivateKey);
  const middleRecord = record('device-middle', middle, { kind: 'device', deviceId: ROOT }, 1, root.signingPrivateKey);
  const leafRecord = record('device-leaf', leaf, { kind: 'device', deviceId: 'device-middle' }, 1, middle.signingPrivateKey);
  return { root, middle, leaf, anchor, rootRecord, middleRecord, leafRecord };
}

describe('the pinned root', () => {
  it('is trusted, and so is a chain below it', () => {
    const { anchor, rootRecord, middleRecord, leafRecord } = tree();
    expect(verifyDeviceTrust(ROOT, anchor, [rootRecord])).toEqual({ trusted: true });
    expect(verifyDeviceTrust('device-middle', anchor, [rootRecord, middleRecord])).toEqual({ trusted: true });
    expect(verifyDeviceTrust('device-leaf', anchor, [rootRecord, middleRecord, leafRecord])).toEqual({ trusted: true });
  });

  it('is unknown when nothing vouches for it yet', () => {
    const { anchor } = tree();
    expect(verifyDeviceTrust(ROOT, anchor, [])).toEqual({ trusted: false, reason: 'unknown-device' });
  });
});

describe('what a hostile server cannot do', () => {
  it('cannot insert a second self-signed root', () => {
    const { anchor, rootRecord } = tree();
    const impostor = keys();
    const impostorRecord = record('device-impostor', impostor, { kind: 'self' }, 1, impostor.signingPrivateKey);
    expect(verifyDeviceTrust('device-impostor', anchor, [rootRecord, impostorRecord])).toEqual({
      trusted: false,
      reason: 'self-not-root',
    });
  });

  it('cannot reuse the root id with its own key', () => {
    const { anchor, rootRecord } = tree();
    const impostor = keys();
    const forgedRoot = record(ROOT, impostor, { kind: 'self' }, 2, impostor.signingPrivateKey);
    expect(verifyDeviceTrust(ROOT, anchor, [rootRecord, forgedRoot])).toEqual({
      trusted: false,
      reason: 'anchor-mismatch',
    });
  });

  it('cannot invent a recovery-authorised device', () => {
    const { anchor, rootRecord } = tree();
    const outsider = keys();
    const forger = keys();
    const forged = record('device-outsider', outsider, { kind: 'recovery' }, 1, forger.signingPrivateKey);
    expect(verifyDeviceTrust('device-outsider', anchor, [rootRecord, forged])).toEqual({
      trusted: false,
      reason: 'bad-signature',
    });
  });

  it('cannot modify a record that was signed', () => {
    const { anchor, rootRecord, middleRecord } = tree();
    expect(verifyDeviceTrust('device-middle', anchor, [rootRecord, { ...middleRecord, revision: 2 }])).toEqual({
      trusted: false,
      reason: 'bad-signature',
    });
    const swapped = keys();
    expect(
      verifyDeviceTrust('device-middle', anchor, [rootRecord, { ...middleRecord, signingPublicKey: swapped.signingPublicKey }])
    ).toEqual({ trusted: false, reason: 'bad-signature' });
  });

  it('cannot serve a record from another Space', () => {
    const { anchor, rootRecord, middleRecord } = tree();
    const elsewhere = { ...middleRecord, spaceId: OTHER_SPACE };
    expect(verifyDeviceTrust('device-middle', anchor, [rootRecord, elsewhere])).toEqual({
      trusted: false,
      reason: 'wrong-space',
    });
  });

  it('cannot point a record at an authoriser that does not exist', () => {
    const { anchor, rootRecord } = tree();
    const orphan = keys();
    const orphanRecord = record('device-orphan', orphan, { kind: 'device', deviceId: 'device-ghost' }, 1, orphan.signingPrivateKey);
    expect(verifyDeviceTrust('device-orphan', anchor, [rootRecord, orphanRecord])).toEqual({
      trusted: false,
      reason: 'unknown-device',
    });
  });

  it('cannot make a cycle trusted', () => {
    const { anchor } = tree();
    const a = keys();
    const b = keys();
    const aRecord = record('device-a', a, { kind: 'device', deviceId: 'device-b' }, 1, b.signingPrivateKey);
    const bRecord = record('device-b', b, { kind: 'device', deviceId: 'device-a' }, 1, a.signingPrivateKey);
    expect(verifyDeviceTrust('device-a', anchor, [aRecord, bRecord])).toEqual({
      trusted: false,
      reason: 'cycle',
    });
  });

  it('cannot shadow a newer record with a stale one', () => {
    const { anchor, rootRecord, middleRecord, root } = tree();
    const staleForgery = record('device-middle', keys(), { kind: 'device', deviceId: ROOT }, 1, keys().signingPrivateKey);
    const newer = { ...middleRecord, revision: 2 };
    const signedNewer = { ...newer, authorisation: signDeviceRecord(newer, root.signingPrivateKey) };
    // The forgery is at the same revision, so the higher one wins regardless of
    // the order they arrive in.
    expect(verifyDeviceTrust('device-middle', anchor, [rootRecord, staleForgery, signedNewer])).toEqual({
      trusted: true,
    });
  });
});

describe('revocation cascades', () => {
  it('rejects a revoked device', () => {
    const { anchor, rootRecord, middleRecord, root } = tree();
    const revoked = tombstone('device-middle', 2, { kind: 'device', deviceId: ROOT }, root.signingPrivateKey);
    expect(verifyDeviceTrust('device-middle', anchor, [rootRecord, middleRecord], [revoked])).toEqual({
      trusted: false,
      reason: 'revoked',
    });
  });

  it('rejects a child of a revoked authoriser, and says why', () => {
    const { anchor, rootRecord, middleRecord, leafRecord, root } = tree();
    const revoked = tombstone('device-middle', 2, { kind: 'device', deviceId: ROOT }, root.signingPrivateKey);
    expect(verifyDeviceTrust('device-leaf', anchor, [rootRecord, middleRecord, leafRecord], [revoked])).toEqual({
      trusted: false,
      reason: 'revoked',
    });
  });

  it('accepts a child that was reparented before its authoriser was revoked', () => {
    const { anchor, rootRecord, middleRecord, leafRecord, root } = tree();
    // The workflow the document requires: re-authorise the descendant directly
    // from a trusted device, then tombstone the device being removed.
    const reparented = record('device-leaf', keys(), { kind: 'device', deviceId: ROOT }, 2, root.signingPrivateKey);
    const revoked = tombstone('device-middle', 2, { kind: 'device', deviceId: ROOT }, root.signingPrivateKey);

    // Without reparenting the leaf is lost with its authoriser.
    expect(verifyDeviceTrust('device-leaf', anchor, [rootRecord, middleRecord, leafRecord], [revoked])).toEqual({
      trusted: false,
      reason: 'revoked',
    });
    // With it, the leaf survives.
    expect(verifyDeviceTrust('device-leaf', anchor, [rootRecord, middleRecord, reparented], [revoked])).toEqual({
      trusted: true,
    });
  });

  it('ignores a tombstone that belongs to another Space', () => {
    const { anchor, rootRecord, middleRecord, root } = tree();
    const elsewhere = tombstone('device-middle', 2, { kind: 'device', deviceId: ROOT }, root.signingPrivateKey, OTHER_SPACE);
    expect(verifyDeviceTrust('device-middle', anchor, [rootRecord, middleRecord], [elsewhere])).toEqual({
      trusted: true,
    });
  });
});

describe('recovery authority', () => {
  it('accepts a device the recovery key enrolled', () => {
    const { anchor, rootRecord } = tree();
    const enrolled = keys();
    const recordFromRecovery = record('device-enrolled', enrolled, { kind: 'recovery' }, 1, recoveryPrivateKey);
    expect(verifyDeviceTrust('device-enrolled', anchor, [rootRecord, recordFromRecovery])).toEqual({
      trusted: true,
    });
  });

  it('rejects a recovery-enrolled device when the anchor names another recovery key', () => {
    const { rootRecord, root } = tree();
    const otherEntropy = recoveryEntropyFromPhrase(generateRecoveryPhrase());
    const anchor = anchorFor(root, { recoverySigningPublicKey: recoverySigningPublicKey(otherEntropy) });
    const enrolled = keys();
    const recordFromRecovery = record('device-enrolled', enrolled, { kind: 'recovery' }, 1, recoveryPrivateKey);
    expect(verifyDeviceTrust('device-enrolled', anchor, [rootRecord, recordFromRecovery])).toEqual({
      trusted: false,
      reason: 'bad-signature',
    });
  });
});
