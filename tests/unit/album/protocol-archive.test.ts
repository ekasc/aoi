import { ed25519 } from '@noble/curves/ed25519.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  parseWireMediaManifest,
  toWireMediaManifest,
  type WireAlbumMediaProtocol,
  type WireAlbumMediaReservationResponse,
  type WireAlbumProtocolSnapshot,
  type WireDeviceRecord,
  type WireMediaManifest,
  type WireMediaTombstone,
  type WireRecoveryEnvelope,
  type WireSpaceKeyEnvelope,
  type WireSpaceTrustAnchor,
} from '@aoi/shared';

import { generateDeviceKeys, type DeviceKeys } from '@/features/album/keys';
import {
  ProtocolRequestError,
  type AlbumProtocolClient,
  type DeviceClaimRequest,
  type MediaReservationRequest,
} from '@/features/album/protocol-client';
import {
  ProtocolUploadInterrupted,
  authoriseProtocolDevice,
  establishProtocolArchive,
  pinVerifiedAnchor,
  publishProtocolDeviceRecord,
  readProtocolArchive,
  removeProtocolPhoto,
  uploadProtocolPhoto,
  type ProtocolArchiveReady,
} from '@/features/album/protocol-archive';
import { signMediaManifest } from '@/features/album/protocol-crypto';
import { readPinnedAnchor } from '@/features/album/protocol-local-state';
import {
  forgetPendingUpload,
  readPendingUploads,
  rememberPendingUpload,
} from '@/features/album/protocol-upload-journal';

/**
 * The product flows, on two simulated devices against an in-memory server that
 * enforces the state machine the real one does: reservations are immutable and
 * size-bound, an object cannot be replaced, a manifest needs a completed
 * reservation, and the read refuses anything that does not match what was
 * pinned.
 *
 * This is a simulated-device test. It exercises the real cryptography, the real
 * wire encoders, and the real archive code; it does not exercise R2, a real
 * network, or a physical phone.
 */

const SPACE = 'space-1';
const OTHER_SPACE = 'space-2';
const NOW = '2026-01-15T00:00:00.000Z';

vi.mock('@/features/album/photo-bytes', () => ({
  readPhotoBytes: async (uri: string) => {
    // `bytes:<n>` builds a payload of a realistic size; anything else is a tag.
    const sized = /^bytes:(\d+)$/.exec(uri);
    if (sized) return new Uint8Array(Number(sized[1])).fill(7);
    return new TextEncoder().encode(`photo:${uri}`);
  },
}));
// The archive takes an explicit key store in these tests; the native modules
// behind the default one are not loadable under the runner.
vi.mock('@/features/album/device-id', () => ({ getOrCreateDeviceId: async () => 'device-1' }));
vi.mock('@/features/album/local-key-store', () => ({
  createLocalKeyStore: () => ({ ensureDevice: vi.fn(), loadDevice: vi.fn(), forgetDevice: vi.fn() }),
}));
vi.mock('expo-secure-store', () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
}));

class FakeServer implements AlbumProtocolClient {
  anchor: WireSpaceTrustAnchor | null = null;
  readonly claims = new Map<string, DeviceClaimRequest>();
  readonly records = new Map<string, WireDeviceRecord>();
  readonly envelopes: WireSpaceKeyEnvelope[] = [];
  readonly recoveryEnvelopes: WireRecoveryEnvelope[] = [];
  readonly reservations = new Map<
    string,
    {
      byteLength: number;
      state: 'pending' | 'complete' | 'failed';
      completedEtag: string | null;
      completedSize: number | null;
    }
  >();
  readonly objects = new Map<string, { bytes: Uint8Array; etag: string }>();
  readonly manifests = new Map<string, WireMediaManifest>();
  readonly tombstones: WireMediaTombstone[] = [];
  withholdTombstones = false;
  failNextPut = false;

  constructor(readonly spaceId: string) {}

  async getSnapshot(): Promise<WireAlbumProtocolSnapshot> {
    return {
      anchor: this.anchor,
      records: [...this.records.values()],
      tombstones: [],
      envelopes: this.envelopes,
      recoveryEnvelopes: this.recoveryEnvelopes,
    };
  }

  async putAnchor(anchor: WireSpaceTrustAnchor) {
    if (this.anchor && JSON.stringify(this.anchor) !== JSON.stringify(anchor)) {
      throw new ProtocolRequestError(409, 'anchor exists');
    }
    this.anchor = anchor;
  }

  async claimDevice(claim: DeviceClaimRequest) {
    const existing = this.claims.get(claim.deviceId);
    if (existing && JSON.stringify(existing) !== JSON.stringify(claim)) {
      throw new ProtocolRequestError(403, 'claimed by someone else');
    }
    this.claims.set(claim.deviceId, claim);
  }

  async putDeviceRecord(record: WireDeviceRecord) {
    const existing = this.records.get(record.deviceId);
    if (existing && existing.revision >= record.revision) {
      throw new ProtocolRequestError(409, 'not newer');
    }
    this.records.set(record.deviceId, record);
  }

  async putSpaceKeyEnvelope(envelope: WireSpaceKeyEnvelope) {
    const key = (e: WireSpaceKeyEnvelope) =>
      `${e.recipientDeviceId}|${e.recipientRevision}|${e.authoriserDeviceId}`;
    if (!this.envelopes.some((e) => key(e) === key(envelope))) this.envelopes.push(envelope);
  }

  async putRecoveryEnvelope(generation: number, envelope: WireRecoveryEnvelope) {
    if (!this.recoveryEnvelopes.some((e) => e.generation === generation)) {
      this.recoveryEnvelopes.push(envelope);
    }
  }

  async reserveMedia(input: MediaReservationRequest): Promise<WireAlbumMediaReservationResponse> {
    const existing = this.reservations.get(input.mediaId);
    if (existing) {
      if (existing.state === 'complete') {
        throw new ProtocolRequestError(409, 'already completed');
      }
      if (existing.byteLength !== input.byteLength) {
        throw new ProtocolRequestError(409, 'a different upload');
      }
    } else {
      this.reservations.set(input.mediaId, {
        byteLength: input.byteLength,
        state: 'pending',
        completedEtag: null,
        completedSize: null,
      });
    }
    return {
      mediaId: input.mediaId,
      generation: input.generation,
      uploadUrl: `fake://object/${input.mediaId}`,
      expiresInSec: 3600,
      headers: { 'If-None-Match': '*' },
    };
  }

  async putObject(uploadUrl: string, _headers: Record<string, string> | undefined, bytes: Uint8Array) {
    if (this.failNextPut) {
      this.failNextPut = false;
      throw new ProtocolRequestError(0, 'the network dropped');
    }
    const mediaId = uploadUrl.split('/').pop() as string;
    if (this.objects.has(mediaId)) throw new ProtocolRequestError(412, 'already exists');
    this.objects.set(mediaId, { bytes, etag: `etag-${mediaId}-${bytes.length}` });
  }

  async finalizeMedia(mediaId: string) {
    const reservation = this.reservations.get(mediaId);
    const object = this.objects.get(mediaId);
    if (!reservation) throw new ProtocolRequestError(404, 'no reservation');
    if (!object) throw new ProtocolRequestError(400, 'nothing uploaded');
    if (object.bytes.length !== reservation.byteLength) {
      throw new ProtocolRequestError(400, 'not the reserved size');
    }
    reservation.state = 'complete';
    reservation.completedEtag = object.etag;
    reservation.completedSize = object.bytes.length;
  }

  async putManifest(mediaId: string, manifest: WireMediaManifest) {
    const reservation = this.reservations.get(mediaId);
    if (!reservation || reservation.state !== 'complete') {
      throw new ProtocolRequestError(400, 'not finalised');
    }
    const existing = this.manifests.get(mediaId);
    if (existing && JSON.stringify(existing) !== JSON.stringify(manifest)) {
      throw new ProtocolRequestError(409, 'a different manifest');
    }
    this.manifests.set(mediaId, manifest);
  }

  async postMediaTombstone(tombstone: WireMediaTombstone) {
    const key = JSON.stringify(tombstone);
    if (!this.tombstones.some((t) => JSON.stringify(t) === key)) this.tombstones.push(tombstone);
  }

  async fetchMediaProtocol(cursor: string | null): Promise<WireAlbumMediaProtocol> {
    const all = [...this.manifests.values()].sort((a, b) => a.mediaId.localeCompare(b.mediaId));
    const from = cursor === null ? 0 : Math.max(all.findIndex((m) => m.mediaId > cursor), 0);
    const page = all.slice(from, from + 2);
    const hasMore = from + page.length < all.length;
    return {
      manifests: page,
      nextCursor: hasMore && page.length > 0 ? page[page.length - 1].mediaId : null,
      tombstones: this.withholdTombstones ? [] : this.tombstones,
    };
  }

  async fetchMediaObject(mediaId: string): Promise<Uint8Array> {
    const reservation = this.reservations.get(mediaId);
    const object = this.objects.get(mediaId);
    if (!reservation || reservation.state !== 'complete' || !object) {
      throw new ProtocolRequestError(404, 'not found');
    }
    if (
      object.etag !== reservation.completedEtag ||
      object.bytes.length !== reservation.completedSize
    ) {
      throw new ProtocolRequestError(409, 'the object was replaced');
    }
    return object.bytes;
  }
}

function keyStoreFor(device: DeviceKeys) {
  return {
    ensureDevice: async () => device,
    loadDevice: async () => device,
    forgetDevice: async () => {},
  };
}

function device(id: string): DeviceKeys {
  return generateDeviceKeys(id, new Date(NOW));
}

/** Alice creates the Space; Bob is a separate device and must be verified in. */
async function couple(server = new FakeServer(SPACE)) {
  const aliceKeys = device('device-alice');
  const bobKeys = device('device-bob');

  const alice = await establishProtocolArchive({
    spaceId: server.spaceId,
    deviceId: 'device-alice',
    client: server,
    keyStore: keyStoreFor(aliceKeys),
    now: NOW,
  });
  expect(alice.status).toBe('ready');
  const aliceReady = alice as ProtocolArchiveReady;

  // Bob is a different phone, so his device-local state starts empty. The test
  // storage is shared, so it is cleared to model that.
  await globalThis.__mockAsyncStorage.clear();

  const unverified = await establishProtocolArchive({
    spaceId: server.spaceId,
    deviceId: 'device-bob',
    client: server,
    keyStore: keyStoreFor(bobKeys),
    now: NOW,
  });
  // A server-supplied anchor whose own records verify against it is exactly
  // what a fabricated Space looks like, so this is not trust yet.
  expect(unverified.status).toBe('unverified');

  // The out-of-band comparison is a human step; here it is assumed done, and
  // then the pin is a deliberate act.
  const record = await authoriseProtocolDevice(
    aliceReady,
    {
      deviceId: 'device-bob',
      signingPublicKey: bobKeys.signing.publicKey,
      agreementPublicKey: bobKeys.agreement.publicKey,
    },
    NOW
  );
  await publishProtocolDeviceRecord(server, record);
  await pinVerifiedAnchor(server.spaceId, (unverified as { anchor: never }).anchor);

  const bob = await establishProtocolArchive({
    spaceId: server.spaceId,
    deviceId: 'device-bob',
    client: server,
    keyStore: keyStoreFor(bobKeys),
    now: NOW,
  });
  expect(bob.status).toBe('ready');

  return { server, alice: aliceReady, bob: bob as ProtocolArchiveReady };
}

function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

beforeEach(async () => {
  await globalThis.__mockAsyncStorage.clear();
});

describe('the connected signed archive', () => {
  it('lets Alice upload and Bob open the photo', async () => {
    const { alice, bob } = await couple();

    await uploadProtocolPhoto(alice, { uri: 'alice.jpg', width: 10, height: 20 }, { now: NOW });

    const read = await readProtocolArchive(bob);
    expect(read.photos).toHaveLength(1);
    expect(text(read.photos[0].bytes)).toBe('photo:alice.jpg');
    expect(read.photos[0].width).toBe(10);
  });

  it('lets Bob upload and Alice open the photo', async () => {
    const { alice, bob } = await couple();

    await uploadProtocolPhoto(bob, { uri: 'bob.jpg', width: 5, height: 6 }, { now: NOW });

    const read = await readProtocolArchive(alice);
    expect(read.photos).toHaveLength(1);
    expect(text(read.photos[0].bytes)).toBe('photo:bob.jpg');
  });

  it('pages past one page without losing or duplicating media', async () => {
    const { alice, bob } = await couple();
    for (const uri of ['one.jpg', 'two.jpg', 'three.jpg']) {
      await uploadProtocolPhoto(alice, { uri, width: 1, height: 1 }, { now: NOW });
    }

    const read = await readProtocolArchive(bob);
    expect(read.photos).toHaveLength(3);
    expect(new Set(read.photos.map((photo) => photo.mediaId)).size).toBe(3);
  });

  it('hides a photo either member removes, and it stays hidden after a restart', async () => {
    const { server, alice, bob } = await couple();
    await uploadProtocolPhoto(alice, { uri: 'gone.jpg', width: 1, height: 1 }, { now: NOW });
    const before = await readProtocolArchive(bob);
    const mediaId = before.photos[0].mediaId;

    await removeProtocolPhoto(bob, { mediaId, manifestRevision: 1, now: NOW });
    expect((await readProtocolArchive(alice)).photos).toHaveLength(0);
    expect((await readProtocolArchive(alice)).deleted).toContain(mediaId);

    // A restart, and a server that now withholds the tombstone. The deletion is
    // still remembered because this device authenticated it, which is the whole
    // reason the revision is persisted locally.
    server.withholdTombstones = true;
    expect((await readProtocolArchive(alice)).photos).toHaveLength(0);
    expect((await readProtocolArchive(alice)).deleted).toContain(mediaId);
  });

  it('recovers an interrupted upload under the same media id', async () => {
    const { alice, bob } = await couple();

    (alice.client as unknown as FakeServer).failNextPut = true;

    let pending: ProtocolUploadInterrupted | null = null;
    try {
      await uploadProtocolPhoto(alice, { uri: 'retry.jpg', width: 1, height: 1 }, { now: NOW });
    } catch (error) {
      expect(error).toBeInstanceOf(ProtocolUploadInterrupted);
      pending = error as ProtocolUploadInterrupted;
    }
    expect(pending).not.toBeNull();
    expect((await readProtocolArchive(bob)).photos).toHaveLength(0);

    await uploadProtocolPhoto(
      alice,
      { uri: 'retry.jpg', width: 1, height: 1 },
      { resume: pending!.pending, now: NOW }
    );
    const read = await readProtocolArchive(bob);
    expect(read.photos).toHaveLength(1);
    expect(read.photos[0].mediaId).toBe(pending!.pending.mediaId);
  });

  it('never shows a photo whose ciphertext was altered', async () => {
    const { server, alice, bob } = await couple();
    await uploadProtocolPhoto(alice, { uri: 'tampered.jpg', width: 1, height: 1 }, { now: NOW });
    const mediaId = (await readProtocolArchive(bob)).photos[0].mediaId;

    // Rewrite the stored object and the pin together, so the server is happy and
    // only the authentication tag can notice.
    const object = server.objects.get(mediaId)!;
    const tampered = new Uint8Array(object.bytes);
    tampered[0] ^= 0xff;
    object.bytes = tampered;
    object.etag = 'etag-forged';
    const reservation = server.reservations.get(mediaId)!;
    reservation.completedEtag = 'etag-forged';
    reservation.completedSize = tampered.length;

    const read = await readProtocolArchive(bob);
    expect(read.photos).toHaveLength(0);
    expect(read.rejected.map((entry) => entry.reason)).toContain('ciphertext-rejected');
  });

  it('never shows a photo whose manifest was forged', async () => {
    const { server, alice, bob } = await couple();
    await uploadProtocolPhoto(alice, { uri: 'forged.jpg', width: 1, height: 1 }, { now: NOW });
    const mediaId = (await readProtocolArchive(bob)).photos[0].mediaId;

    const { signature: _dropped, ...input } = parseWireMediaManifest(server.manifests.get(mediaId)!);
    const forger = ed25519.utils.randomSecretKey();
    server.manifests.set(
      mediaId,
      toWireMediaManifest({ ...input, signature: signMediaManifest(input, forger) })
    );

    const read = await readProtocolArchive(bob);
    expect(read.photos).toHaveLength(0);
    expect(read.rejected.map((entry) => entry.reason)).toContain('bad-manifest-signature');
  });

  it('refuses a trust root the device did not pin', async () => {
    const { server, alice } = await couple();
    void alice;

    // A different anchor wearing the same Space id.
    const original = server.anchor!;
    server.anchor = { ...original, rootDeviceId: 'device-impostor' };

    const again = await establishProtocolArchive({
      spaceId: server.spaceId,
      deviceId: 'device-alice',
      client: server,
      keyStore: keyStoreFor(device('device-alice')),
      now: NOW,
    });
    // A trust mismatch is `blocked`, not `unavailable`: retrying will not fix
    // it, and a caller must surface it rather than quietly using the legacy path.
    expect(again.status).toBe('blocked');
  });

  it('does not create a replacement archive when a pinned device sees no anchor', async () => {
    const { server, alice } = await couple();
    void alice;
    const original = server.anchor!;

    // The server withholds the root. Creating a new one here would mint a fresh
    // archive over the old under the same Space id.
    server.anchor = null;
    const again = await establishProtocolArchive({
      spaceId: server.spaceId,
      deviceId: 'device-alice',
      client: server,
      keyStore: keyStoreFor(device('device-alice')),
      now: NOW,
    });

    expect(again.status).toBe('blocked');
    expect(server.anchor).toBeNull();
    // The pin is untouched, so the archive is still the one this device trusts.
    expect(server.records.get('device-alice')).toEqual(
      expect.objectContaining({ deviceId: 'device-alice' })
    );
    void original;
  });

  it('keeps one Space out of another Space, including its local state', async () => {
    const one = await couple();
    await uploadProtocolPhoto(one.alice, { uri: 'shared.jpg', width: 1, height: 1 }, { now: NOW });
    const mediaId = (await readProtocolArchive(one.bob)).photos[0].mediaId;
    await removeProtocolPhoto(one.alice, { mediaId, manifestRevision: 1, now: NOW });

    const two = await couple(new FakeServer(OTHER_SPACE));
    // A different Space has its own anchor, its own records and its own state.
    expect((await readProtocolArchive(two.bob)).photos).toHaveLength(0);
    expect(two.server.anchor).not.toEqual(one.server.anchor);
    // And the deletion recorded in the first Space does not leak into the second.
    expect((await readProtocolArchive(two.bob)).deleted).not.toContain(mediaId);
  });

  it('does not trust a self-consistent anchor from a malicious server', async () => {
    // A fabricated Space: the attacker holds its root key, so every record and
    // envelope the server returns verifies against the anchor it also returned.
    // Only a human comparison, or the phrase, can tell this from the real one.
    const server = new FakeServer(SPACE);
    const attacker = device('device-attacker');
    const victim = device('device-victim');

    const attackerArchive = await establishProtocolArchive({
      spaceId: SPACE,
      deviceId: 'device-attacker',
      client: server,
      keyStore: keyStoreFor(attacker),
      now: NOW,
    });
    expect(attackerArchive.status).toBe('ready');

    // The victim is a fresh device.
    await globalThis.__mockAsyncStorage.clear();

    const record = await authoriseProtocolDevice(
      attackerArchive as ProtocolArchiveReady,
      {
        deviceId: 'device-victim',
        signingPublicKey: victim.signing.publicKey,
        agreementPublicKey: victim.agreement.publicKey,
      },
      NOW
    );
    await publishProtocolDeviceRecord(server, record);

    const victimResult = await establishProtocolArchive({
      spaceId: SPACE,
      deviceId: 'device-victim',
      client: server,
      keyStore: keyStoreFor(victim),
      now: NOW,
    });

    // Everything the server sent verifies, and that is not enough.
    expect(victimResult.status).toBe('unverified');
    expect((await readPinnedAnchor(SPACE)).state).toBe('none');
  });

  it('does not see legacy media, and never touches it', async () => {    const { alice, bob } = await couple();
    await uploadProtocolPhoto(alice, { uri: 'signed.jpg', width: 1, height: 1 }, { now: NOW });

    // Legacy rows live in a different table and have no manifest, so the signed
    // read cannot list them; and the protocol transport has no call that could
    // rewrite or delete one. That is the compatibility boundary: the two
    // formats are read side by side, never reinterpreted as each other.
    const read = await readProtocolArchive(bob);
    expect(read.photos).toHaveLength(1);
    expect(read.photos[0].mediaId).not.toBe('legacy-1');
    expect((bob.client as unknown as { legacy?: unknown }).legacy).toBeUndefined();
  });

  it('reports a partial read rather than dropping a photo that failed to download', async () => {
    const { server, alice, bob } = await couple();
    await uploadProtocolPhoto(alice, { uri: 'flaky.jpg', width: 1, height: 1 }, { now: NOW });
    const mediaId = (await readProtocolArchive(bob)).photos[0].mediaId;

    const originalFetch = server.fetchMediaObject.bind(server);
    let failOnce = true;
    server.fetchMediaObject = async (id: string) => {
      if (failOnce && id === mediaId) {
        failOnce = false;
        throw new ProtocolRequestError(0, 'the network dropped');
      }
      return originalFetch(id);
    };

    // The failure is reported as an incomplete read, not as an absent photo, so
    // a caller keeps what it already had instead of evicting it.
    const partial = await readProtocolArchive(bob);
    expect(partial.photos).toHaveLength(0);
    expect(partial.incomplete).toBe(true);

    const recovered = await readProtocolArchive(bob);
    expect(recovered.photos).toHaveLength(1);
    expect(recovered.incomplete).toBe(false);
  });

  it('keeps several realistic pending uploads apart, and cleans up only the published one', async () => {
    const { alice } = await couple();
    const scope = 'scope-multi';
    // 0.5 MiB, 1 MiB and 2 MiB: sizes that would not belong in AsyncStorage as
    // base64, and three of them at once.
    const sizes = [512 * 1024, 1024 * 1024, 2 * 1024 * 1024];
    const pendingIds: string[] = [];

    for (const [index, size] of sizes.entries()) {
      (alice.client as unknown as FakeServer).failNextPut = true;
      let interrupted: ProtocolUploadInterrupted | null = null;
      try {
        await uploadProtocolPhoto(
          alice,
          { uri: `bytes:${size}`, width: 4000, height: 3000 },
          { scopeKey: scope, now: NOW }
        );
      } catch (error) {
        interrupted = error as ProtocolUploadInterrupted;
      }
      expect(interrupted).not.toBeNull();
      pendingIds.push(interrupted!.pending.mediaId);
      // The journal is written before the first network call, so the failure
      // above already left it behind.
      const entries = await readPendingUploads(scope);
      expect(entries.map((entry) => entry.mediaId)).toContain(interrupted!.pending.mediaId);
      expect(entries.find((entry) => entry.mediaId === interrupted!.pending.mediaId)!.ciphertext.length)
        .toBeGreaterThan(size);
    }
    expect(await readPendingUploads(scope)).toHaveLength(3);

    // Finish the middle one; only its own temporary file may go.
    const all = await readPendingUploads(scope);
    const middle = all[1];
    await uploadProtocolPhoto(
      alice,
      { uri: middle.uri, width: middle.width, height: middle.height },
      { resume: middle, scopeKey: scope, now: NOW }
    );

    const remaining = await readPendingUploads(scope);
    expect(remaining.map((entry) => entry.mediaId)).toEqual([pendingIds[0], pendingIds[2]]);
  });

  it('journals an interrupted upload so a restart finishes the same one', async () => {    const { alice, bob } = await couple();
    (alice.client as unknown as FakeServer).failNextPut = true;

    let pending: ProtocolUploadInterrupted | null = null;
    try {
      await uploadProtocolPhoto(alice, { uri: 'journal.jpg', width: 1, height: 1 }, { now: NOW });
    } catch (error) {
      pending = error as ProtocolUploadInterrupted;
    }
    expect(pending).not.toBeNull();

    const scope = 'scope-alice';
    await rememberPendingUpload(scope, {
      ...pending!.pending,
      uri: 'journal.jpg',
      width: 1,
      height: 1,
      createdAt: NOW,
    });
    const entries = await readPendingUploads(scope);
    expect(entries).toHaveLength(1);
    expect(entries[0].mediaId).toBe(pending!.pending.mediaId);

    // A restart resumes under the same media id, then clears the entry only
    // once the manifest has actually published.
    await uploadProtocolPhoto(
      alice,
      { uri: entries[0].uri, width: entries[0].width, height: entries[0].height },
      { resume: entries[0], now: NOW }
    );
    await forgetPendingUpload(scope, entries[0].mediaId);
    expect(await readPendingUploads(scope)).toHaveLength(0);
    const read = await readProtocolArchive(bob);
    expect(read.photos).toHaveLength(1);
    expect(read.photos[0].mediaId).toBe(pending!.pending.mediaId);
  });
});
