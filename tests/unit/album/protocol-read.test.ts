import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { describe, expect, it } from 'vitest';

import {
  encodeMediaContext,
  toWireMediaManifest,
  toWireMediaTombstone,
  type DeviceRecord,
  type DeviceTombstone,
  type MediaManifest,
  type MediaManifestInput,
  type MediaTombstone,
  type MediaTombstoneInput,
  type SpaceTrustAnchor,
  type WireMediaManifest,
  type WireMediaTombstone,
} from '@aoi/shared';

import {
  generateSpaceKey,
  sealMediaCiphertext,
  signDeviceRecord,
  signDeviceTombstone,
  signMediaManifest,
  signMediaTombstone,
  signSpaceTrustAnchor,
  signSpaceTrustAnchorRecovery,
  wrapMediaKey,
} from '@/features/album/protocol-crypto';
import { verifyDeviceProvenance } from '@/features/album/protocol-trust';
import {
  authenticateMediaTombstones,
  collectMediaPages,
  isMediaDeleted,
  readArchiveMedia,
} from '@/features/album/protocol-read';
import { deriveRecoverySigningKey } from '@/features/album/protocol-crypto';

/**
 * The read pipeline, attacked. Every fixture is built with the real shared
 * encoders and the real crypto: there is no mock verifier anywhere in this
 * file, because a mock would only prove the mock agrees with itself.
 *
 * Each test removes exactly one property from an otherwise valid archive and
 * asserts the pipeline refuses it, so the test fails if that check is deleted.
 */

const SPACE = 'space-1';
const OTHER_SPACE = 'space-2';
const AT = '2026-01-01T00:00:00.000Z';
const ROOT = 'device-root';
const UPLOADER = 'device-uploader';
const MEDIA = 'media-1';
const GENERATION = 1;

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

function deviceRecord(
  deviceId: string,
  material: ReturnType<typeof keys>,
  authorisedBy: DeviceRecord['authorisedBy'],
  authoriserSigningKey: Uint8Array,
  overrides: Partial<DeviceRecord> = {}
): DeviceRecord {
  const input = {
    deviceId,
    spaceId: SPACE,
    signingPublicKey: material.signingPublicKey,
    agreementPublicKey: material.agreementPublicKey,
    authorisedBy,
    revision: 1,
    createdAt: AT,
    ...overrides,
  };
  return { ...input, authorisation: signDeviceRecord(input, authoriserSigningKey) };
}

function fixture() {
  const root = keys();
  const uploader = keys();
  const recoveryEntropy = new Uint8Array(32).fill(7);
  const recoveryPrivateKey = deriveRecoverySigningKey(recoveryEntropy);
  const recoveryPublicKey = new Uint8Array(ed25519.getPublicKey(recoveryPrivateKey));

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

  const records: DeviceRecord[] = [
    deviceRecord(ROOT, root, { kind: 'self' }, root.signingPrivateKey),
    deviceRecord(
      UPLOADER,
      uploader,
      { kind: 'device', deviceId: ROOT },
      root.signingPrivateKey
    ),
  ];

  const spaceKey = generateSpaceKey();
  const mediaKey = new Uint8Array(32).fill(3);
  const context = encodeMediaContext({ mediaId: MEDIA, generation: GENERATION });
  const plaintext = new TextEncoder().encode('the-photo-bytes');
  const sealed = sealMediaCiphertext({ mediaKey, plaintext, context });
  const wrappedKey = wrapMediaKey({ spaceKey, mediaKey, context });

  const manifestInput: MediaManifestInput = {
    mediaId: MEDIA,
    spaceId: SPACE,
    generation: GENERATION,
    revision: 1,
    wrappedKey,
    sealedNonce: sealed.nonce,
    byteLength: sealed.ciphertext.length,
    mimeType: 'image/jpeg',
    width: 100,
    height: 200,
    uploaderDeviceId: UPLOADER,
    createdAt: AT,
  };
  const manifest: MediaManifest = {
    ...manifestInput,
    signature: signMediaManifest(manifestInput, uploader.signingPrivateKey),
  };

  const tombstoneInput: MediaTombstoneInput = {
    spaceId: SPACE,
    mediaId: MEDIA,
    revision: 2,
    deletedAt: AT,
    deletedByDeviceId: UPLOADER,
  };
  const tombstone: MediaTombstone = {
    ...tombstoneInput,
    signature: signMediaTombstone(tombstoneInput, uploader.signingPrivateKey),
  };

  return {
    root,
    uploader,
    anchor,
    records,
    spaceKey,
    context,
    plaintext,
    manifest,
    manifestInput,
    tombstone,
    tombstoneInput,
    wireManifest: toWireMediaManifest(manifest),
    wireTombstone: toWireMediaTombstone(tombstone),
    ciphertext: sealed.ciphertext,
  };
}

type Fixture = ReturnType<typeof fixture>;

function read(f: Fixture, overrides: Partial<Parameters<typeof readArchiveMedia>[0]> = {}) {
  return readArchiveMedia({
    anchor: f.anchor,
    records: f.records,
    tombstones: [],
    spaceKey: f.spaceKey,
    generation: GENERATION,
    mediaId: MEDIA,
    manifest: f.wireManifest,
    ciphertext: f.ciphertext,
    ...overrides,
  });
}

describe('reading a signed-media object', () => {
  it('returns the plaintext for a valid archive', () => {
    const f = fixture();
    const result = read(f);
    expect(result.status).toBe('visible');
    if (result.status !== 'visible') return;
    expect(new TextDecoder().decode(result.plaintext)).toBe('the-photo-bytes');
  });

  it('refuses a manifest that is not the canonical wire shape', () => {
    const f = fixture();
    const result = read(f, { manifest: { ...f.wireManifest, byteLength: -1 } as WireMediaManifest });
    expect(result).toMatchObject({ status: 'rejected', reason: 'unparseable-manifest' });
  });

  it('refuses a manifest for a different media than the one asked for', () => {
    const f = fixture();
    const result = read(f, { mediaId: 'media-other' });
    expect(result).toMatchObject({ status: 'rejected', reason: 'wrong-media' });
  });

  it('refuses a manifest that belongs to another Space', () => {
    const f = fixture();
    const input = { ...f.manifestInput, spaceId: OTHER_SPACE };
    const wire = toWireMediaManifest({
      ...input,
      signature: signMediaManifest(input, f.uploader.signingPrivateKey),
    });
    expect(read(f, { manifest: wire })).toMatchObject({
      status: 'rejected',
      reason: 'wrong-space',
    });
  });

  it('refuses a manifest whose uploader is unknown to the anchor', () => {
    const f = fixture();
    const input = { ...f.manifestInput, uploaderDeviceId: 'device-ghost' };
    const wire = toWireMediaManifest({
      ...input,
      signature: signMediaManifest(input, f.uploader.signingPrivateKey),
    });
    expect(read(f, { manifest: wire })).toMatchObject({
      status: 'rejected',
      reason: 'untrusted-uploader',
    });
  });

  it('refuses a manifest whose uploader does not descend from the anchor', () => {
    const f = fixture();
    // A self-authorised device that is not the pinned root is not a chain.
    const outsider = keys();
    const rogue = deviceRecord('device-rogue', outsider, { kind: 'self' }, outsider.signingPrivateKey);
    const input = { ...f.manifestInput, uploaderDeviceId: 'device-rogue' };
    const wire = toWireMediaManifest({
      ...input,
      signature: signMediaManifest(input, outsider.signingPrivateKey),
    });
    expect(read(f, { records: [...f.records, rogue], manifest: wire })).toMatchObject({
      status: 'rejected',
      reason: 'untrusted-uploader',
    });
  });

  it('refuses a forged manifest signature', () => {
    const f = fixture();
    const forger = keys();
    const wire = toWireMediaManifest({
      ...f.manifest,
      signature: signMediaManifest(f.manifestInput, forger.signingPrivateKey),
    });
    expect(read(f, { manifest: wire })).toMatchObject({
      status: 'rejected',
      reason: 'bad-manifest-signature',
    });
  });

  it('refuses ciphertext that is not the declared length', () => {
    const f = fixture();
    expect(read(f, { ciphertext: f.ciphertext.slice(0, -1) })).toMatchObject({
      status: 'rejected',
      reason: 'bad-ciphertext-length',
    });
  });

  it('refuses a wrapped key swapped from another media', () => {
    const f = fixture();
    const otherContext = encodeMediaContext({ mediaId: 'media-other', generation: GENERATION });
    const otherWrapped = wrapMediaKey({
      spaceKey: f.spaceKey,
      mediaKey: new Uint8Array(32).fill(9),
      context: otherContext,
    });
    const input = { ...f.manifestInput, wrappedKey: otherWrapped };
    const wire = toWireMediaManifest({
      ...input,
      signature: signMediaManifest(input, f.uploader.signingPrivateKey),
    });
    expect(read(f, { manifest: wire })).toMatchObject({
      status: 'rejected',
      reason: 'bad-wrapped-key',
    });
  });

  it('refuses ciphertext altered in flight', () => {
    const f = fixture();
    const tampered = new Uint8Array(f.ciphertext);
    tampered[0] ^= 0xff;
    expect(read(f, { ciphertext: tampered })).toMatchObject({
      status: 'rejected',
      reason: 'ciphertext-rejected',
    });
  });

  it('refuses a ciphertext moved to another media id', () => {
    const f = fixture();
    // The wrapped key is re-sealed for the other id with the same media key, so
    // the failure is the ciphertext's own binding rather than the key's.
    const otherId = 'media-other';
    const otherWrapped = wrapMediaKey({
      spaceKey: f.spaceKey,
      mediaKey: new Uint8Array(32).fill(3),
      context: encodeMediaContext({ mediaId: otherId, generation: GENERATION }),
    });
    const input = { ...f.manifestInput, mediaId: otherId, wrappedKey: otherWrapped };
    const wire = toWireMediaManifest({
      ...input,
      signature: signMediaManifest(input, f.uploader.signingPrivateKey),
    });
    expect(read(f, { mediaId: otherId, manifest: wire })).toMatchObject({
      status: 'rejected',
      reason: 'ciphertext-rejected',
    });
  });
});

describe('authenticating media tombstones', () => {
  it('ignores a forged candidate, even with an enormous revision', () => {
    const f = fixture();
    const forger = keys();
    const forgedInput: MediaTombstoneInput = {
      ...f.tombstoneInput,
      revision: 2 ** 31 - 1,
    };
    const forged: WireMediaTombstone = toWireMediaTombstone({
      ...forgedInput,
      signature: signMediaTombstone(forgedInput, forger.signingPrivateKey),
    });

    const result = read(f, { tombstones: [forged] });
    expect(result.status).toBe('visible');
  });

  it('ignores a candidate signed by a device with no provenance', () => {
    const f = fixture();
    const outsider = keys();
    const rogue = deviceRecord('device-rogue', outsider, { kind: 'self' }, outsider.signingPrivateKey);
    const forgedInput: MediaTombstoneInput = {
      ...f.tombstoneInput,
      deletedByDeviceId: 'device-rogue',
    };
    const forged = toWireMediaTombstone({
      ...forgedInput,
      signature: signMediaTombstone(forgedInput, outsider.signingPrivateKey),
    });

    expect(read(f, { records: [...f.records, rogue], tombstones: [forged] }).status).toBe('visible');
  });

  it('ignores a candidate for another Space', () => {
    const f = fixture();
    const input: MediaTombstoneInput = { ...f.tombstoneInput, spaceId: OTHER_SPACE };
    const wire = toWireMediaTombstone({
      ...input,
      signature: signMediaTombstone(input, f.uploader.signingPrivateKey),
    });
    expect(read(f, { tombstones: [wire] }).status).toBe('visible');
  });

  it('applies an authenticated tombstone newer than the manifest', () => {
    const f = fixture();
    expect(read(f, { tombstones: [f.wireTombstone] })).toMatchObject({ status: 'deleted' });
  });

  it('ignores an authenticated tombstone that is not newer (a resurrection)', () => {
    const f = fixture();
    const staleInput: MediaTombstoneInput = { ...f.tombstoneInput, revision: 1 };
    const stale = toWireMediaTombstone({
      ...staleInput,
      signature: signMediaTombstone(staleInput, f.uploader.signingPrivateKey),
    });
    expect(read(f, { tombstones: [stale] }).status).toBe('visible');
  });

  it('does not depend on the order the server listed candidates in', () => {
    const f = fixture();
    const forged = toWireMediaTombstone({
      ...f.tombstoneInput,
      revision: 2 ** 31 - 1,
      signature: new Uint8Array(64),
    });
    const forward = read(f, { tombstones: [forged, f.wireTombstone] });
    const backward = read(f, { tombstones: [f.wireTombstone, forged] });
    expect(forward.status).toBe('deleted');
    expect(backward.status).toBe('deleted');
  });

  it('returns only the authenticated candidates, whatever their revision', () => {
    const f = fixture();
    const huge = toWireMediaTombstone({
      ...f.tombstoneInput,
      revision: 2 ** 31 - 1,
      signature: signMediaTombstone(
        { ...f.tombstoneInput, revision: 2 ** 31 - 1 },
        f.uploader.signingPrivateKey
      ),
    });
    const authenticated = authenticateMediaTombstones({
      anchor: f.anchor,
      records: f.records,
      tombstones: [f.wireTombstone, huge],
    });
    // Both are genuinely signed by the uploader; the pipeline's job is to
    // authenticate, and the client's to compare revisions it trusts.
    expect(authenticated).toHaveLength(2);
    expect(isMediaDeleted(f.manifest, authenticated)).toBe(true);
  });

  it('keeps a revoked device\'s signature valid, because media uses provenance', () => {
    const f = fixture();
    // A valid device tombstone revoking the uploader, signed by the root.
    const revocationInput = {
      spaceId: SPACE,
      targetDeviceId: UPLOADER,
      revision: 2,
      revokedBy: { kind: 'device' as const, deviceId: ROOT },
      revokedAt: AT,
    };
    const revocation: DeviceTombstone = {
      ...revocationInput,
      signature: signDeviceTombstone(revocationInput, f.root.signingPrivateKey),
    };
    void revocation;

    // Provenance ignores device tombstones on purpose: revoking a phone must not
    // rewrite the archive it already authored. Current authority is the wrong
    // question for media, and this is that choice made explicit.
    expect(verifyDeviceProvenance(UPLOADER, f.anchor, f.records).trusted).toBe(true);
    expect(read(f).status).toBe('visible');
  });
});

describe('exhausting media pagination', () => {
  it('collects every page until the cursor ends', async () => {
    const pages = [
      { manifests: ['a'], nextCursor: 'c1' },
      { manifests: ['b'], nextCursor: 'c2' },
      { manifests: ['c'], nextCursor: null },
    ];
    let index = 0;
    const all = await collectMediaPages(async () => pages[index++]);
    expect(all).toEqual(['a', 'b', 'c']);
  });

  it('refuses a cursor that does not advance rather than reporting a small archive', async () => {
    await expect(
      collectMediaPages(async () => ({ manifests: ['a'], nextCursor: 'same' }))
    ).rejects.toThrow('media pagination did not advance');
  });

  it('refuses to run past its page bound', async () => {
    let n = 0;
    await expect(
      collectMediaPages(async () => ({ manifests: [], nextCursor: `c${(n += 1)}` }), {
        maxPages: 3,
      })
    ).rejects.toThrow('media pagination exceeded its page bound');
  });
});
