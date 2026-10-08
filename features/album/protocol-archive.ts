import { randomUUID } from 'expo-crypto';

import {
  encodeBase64,
  encodeMediaContext,
  parseWireDeviceRecord,
  parseWireDeviceTombstone,
  parseWireRecoveryEnvelope,
  parseWireSpaceKeyEnvelope,
  parseWireSpaceTrustAnchor,
  toWireDeviceRecord,
  toWireMediaManifest,
  toWireMediaTombstone,
  toWireRecoveryEnvelope,
  toWireSpaceKeyEnvelope,
  toWireSpaceTrustAnchor,
  type DeviceRecord,
  type MediaManifest,
  type MediaManifestInput,
  type MediaTombstone,
  type MediaTombstoneInput,
  type SpaceTrustAnchor,
  type WireMediaManifest,
  type WireMediaTombstone,
} from '@aoi/shared';

import { generateMediaKey, fromBase64 } from '@/features/album/crypto';
import { verificationFingerprint } from '@/features/album/keys';
import type { LocalKeyStore } from '@/features/album/local-key-store';
import { readPhotoBytes } from '@/features/album/photo-bytes';
import {
  forgetPendingUpload,
  rememberPendingUpload,
  type PendingProtocolUpload,
} from '@/features/album/protocol-upload-journal';
import {
  deriveRecoverySigningKey,
  generateSpaceKey,
  openSpaceKeyFromEnvelope,
  recoverySigningPublicKey,
  sealMediaCiphertext,
  sealSpaceKeyForDevice,
  sealSpaceKeyForRecovery,
  signDeviceRecord,
  signMediaManifest,
  signMediaTombstone,
  signSpaceTrustAnchor,
  signSpaceTrustAnchorRecovery,
  verifyDeviceRecord,
  wrapMediaKey,
  type DeviceKeyMaterial,
} from '@/features/album/protocol-crypto';
import {
  getAlbumProtocolClient,
  ProtocolRequestError,
  type AlbumProtocolClient,
} from '@/features/album/protocol-client';
import {
  anchorsMatch,
  pinAnchor,
  readDeletionState,
  readPinnedAnchor,
  recordAuthenticatedDeletion,
  writeRecoveryEntropy,
} from '@/features/album/protocol-local-state';
import { recoverSpaceFromPhrase } from '@/features/album/protocol-recovery';
import {
  authenticateMediaTombstones,
  collectMediaPages,
  isMediaDeleted,
  readArchiveMedia,
  verifyArchiveManifest,
} from '@/features/album/protocol-read';
import { verifyDeviceProvenance, verifyDeviceTrust } from '@/features/album/protocol-trust';
import { generateRecoveryPhrase, recoveryEntropyFromPhrase } from '@/features/album/recovery';

/**
 * The signed archive, connected.
 *
 * This is the seam the photo experience uses: it establishes a session (creating
 * the Space, joining one, or recovering one), uploads a photo through the whole
 * reserve → PUT → finalise → publish sequence, reads the archive back with every
 * check applied, and removes a photo with a signed tombstone.
 *
 * Two properties are load-bearing and easy to lose:
 *
 *   Trust comes from the pin, not the response. The first time this device sees
 *   an anchor it accepts it only through a chain it can verify, and pins it;
 *   afterwards a different anchor from the server is a refusal, because a new
 *   trust root is the attack this protocol exists to stop.
 *
 *   Only authenticated state is persisted. Deletion revisions are written after
 *   their signature verifies, never from a raw field the server supplied.
 */

export const SIGNED_ALBUM_GENERATION = 1;

export type ProtocolArchiveReady = {
  status: 'ready';
  spaceId: string;
  generation: number;
  spaceKey: Uint8Array;
  deviceId: string;
  device: DeviceKeyMaterial;
  anchor: SpaceTrustAnchor;
  records: DeviceRecord[];
  client: AlbumProtocolClient;
};

export type ProtocolArchive =
  | ProtocolArchiveReady
  /** This device has claimed an id and nobody has authorised it yet. */
  | { status: 'waiting' }
  /**
   * This device has not established trust here: no pin, and the server's anchor
   * is only self-consistent. Nothing signed is shown and nothing is pinned until
   * a human confirms the root out of band, or the recovery phrase authenticates
   * it. The anchor is handed back only so two devices can compare it.
   */
  | { status: 'unverified'; anchor: SpaceTrustAnchor; records: DeviceRecord[] }
  /** The server could not be reached, or failed. Try again. */
  | { status: 'unavailable' }
  /**
   * The protocol state is wrong in a way retrying will not fix: a root this
   * device did not pin, a pinned root the server withheld, a damaged pin, or a
   * malformed object. Callers must surface this rather than fall back to legacy.
   */
  | { status: 'blocked' };

/**
 * Accept a root after a human compared its fingerprint out of band.
 *
 * This is the only way a joining device pins a root it did not create, and it is
 * deliberately separate from `establishProtocolArchive`: trust comes from the
 * comparison, not from the establishment succeeding.
 */
export async function pinVerifiedAnchor(
  spaceId: string,
  anchor: SpaceTrustAnchor
): Promise<void> {
  await pinAnchor(spaceId, anchor);
}

function highestRevision(records: readonly DeviceRecord[], deviceId: string): DeviceRecord | null {
  let best: DeviceRecord | null = null;
  for (const record of records) {
    if (record.deviceId !== deviceId) continue;
    if (!best || record.revision > best.revision) best = record;
  }
  return best;
}

function materialOf(device: {
  signing: { privateKey: Uint8Array; publicKey: Uint8Array };
  agreement: { privateKey: Uint8Array; publicKey: Uint8Array };
}): DeviceKeyMaterial {
  return {
    signingPrivateKey: device.signing.privateKey,
    signingPublicKey: device.signing.publicKey,
    agreementPrivateKey: device.agreement.privateKey,
    agreementPublicKey: device.agreement.publicKey,
  };
}

export type EstablishProtocolArchiveInput = {
  spaceId: string;
  deviceId?: string;
  client?: AlbumProtocolClient;
  keyStore?: LocalKeyStore;
  now?: string;
};

export async function establishProtocolArchive(
  input: EstablishProtocolArchiveInput
): Promise<ProtocolArchive> {
  const client = input.client ?? getAlbumProtocolClient();

  let snapshot;
  try {
    snapshot = await client.getSnapshot();
  } catch {
    return { status: 'unavailable' };
  }

  // The key store and the device id reach native modules, so they are imported
  // only once a server actually answered. A client that never gets a snapshot
  // never touches the keystore, which is also what keeps the web preview and
  // the test runner from loading one they do not have.
  const store =
    input.keyStore ??
    (await import('@/features/album/local-key-store')).createLocalKeyStore();
  const deviceId =
    input.deviceId ??
    (await (await import('@/features/album/device-id')).getOrCreateDeviceId());
  const now = input.now ?? new Date().toISOString();

  const device = await store.ensureDevice(input.spaceId, deviceId);
  const material = materialOf(device);

  const pinned = await readPinnedAnchor(input.spaceId);
  if (pinned.state === 'corrupt') {
    // A pin this device cannot read is not a fresh install. Adopting the
    // server's root here is exactly the substitution the pin exists to stop.
    return { status: 'blocked' };
  }

  if (snapshot.anchor === null) {
    // An absent anchor means "no Space yet" only when this device has never
    // pinned one. Once it has, a missing anchor is the server withholding the
    // root, and creating a replacement would mint a fresh archive over the old
    // one under the same Space id.
    if (pinned.state === 'pinned') {
      return { status: 'blocked' };
    }
    try {
      return await createSpace({ spaceId: input.spaceId, deviceId, material, client, now });
    } catch {
      return { status: 'unavailable' };
    }
  }

  let anchor: SpaceTrustAnchor;
  try {
    anchor = parseWireSpaceTrustAnchor(snapshot.anchor);
  } catch {
    // A malformed anchor is not a root anyone should reason about.
    return { status: 'blocked' };
  }

  if (pinned.state === 'pinned' && !anchorsMatch(pinned.anchor, anchor)) {
    // A different root is a different Space wearing this one's id.
    return { status: 'blocked' };
  }

  let records: DeviceRecord[];
  let deviceTombstones: ReturnType<typeof parseWireDeviceTombstone>[];
  try {
    records = snapshot.records.map(parseWireDeviceRecord);
    deviceTombstones = snapshot.tombstones.map(parseWireDeviceTombstone);
  } catch {
    return { status: 'blocked' };
  }

  if (pinned.state === 'none') {
    // No pin. The server's anchor being self-consistent with its own records and
    // envelopes is not evidence of anything: a fabricated Space looks exactly
    // like that. Nothing is pinned and no signed media is shown until a human
    // compares the root's fingerprint out of band, or the recovery phrase
    // authenticates the anchor.
    return { status: 'unverified', anchor, records };
  }

  const mine = highestRevision(records, deviceId);

  if (mine && verifyDeviceProvenance(deviceId, anchor, records).trusted) {
    const envelope = snapshot.envelopes
      .map(parseWireSpaceKeyEnvelope)
      .find(
        (candidate) =>
          candidate.recipientDeviceId === deviceId &&
          candidate.generation === SIGNED_ALBUM_GENERATION &&
          candidate.recipientRevision === mine.revision
      );
    if (envelope) {
      const authoriser = highestRevision(records, envelope.authoriserDeviceId);
      const authoriserTrusted =
        authoriser !== null &&
        verifyDeviceTrust(envelope.authoriserDeviceId, anchor, records, deviceTombstones).trusted;
      if (authoriserTrusted) {
        try {
          const spaceKey = openSpaceKeyFromEnvelope({
            envelope,
            recipientAgreementPrivateKey: material.agreementPrivateKey,
            authoriserAgreementPublicKey: authoriser.agreementPublicKey,
          });
          await pinAnchor(input.spaceId, anchor);
          return {
            status: 'ready',
            spaceId: input.spaceId,
            generation: SIGNED_ALBUM_GENERATION,
            spaceKey,
            deviceId,
            device: material,
            anchor,
            records,
            client,
          };
        } catch {
          // An envelope that will not open is not ours to use.
        }
      }
    }
  }

  // Claim the id so whoever holds the root can authorise this device. The claim
  // is idempotent, and a claim already owned by this account is not an error.
  try {
    await client.claimDevice({
      deviceId,
      signingPublicKey: encodeBase64(material.signingPublicKey),
      agreementPublicKey: encodeBase64(material.agreementPublicKey),
    });
  } catch {
    // Reported on the next run as `waiting` rather than guessed at here.
  }
  return { status: 'waiting' };
}

async function createSpace(input: {
  spaceId: string;
  deviceId: string;
  material: DeviceKeyMaterial;
  client: AlbumProtocolClient;
  now: string;
}): Promise<ProtocolArchive> {
  const { spaceId, deviceId, material, client, now } = input;
  const spaceKey = generateSpaceKey();
  const entropy = recoveryEntropyFromPhrase(generateRecoveryPhrase());

  const anchorInput = {
    spaceId,
    rootDeviceId: deviceId,
    rootSigningPublicKey: material.signingPublicKey,
    recoverySigningPublicKey: recoverySigningPublicKey(entropy),
    createdAt: now,
  };
  const anchor: SpaceTrustAnchor = {
    ...anchorInput,
    rootSignature: signSpaceTrustAnchor(anchorInput, material.signingPrivateKey),
    recoverySignature: signSpaceTrustAnchorRecovery(anchorInput, deriveRecoverySigningKey(entropy)),
  };
  await client.putAnchor(toWireSpaceTrustAnchor(anchor));

  const recordInput = {
    deviceId,
    spaceId,
    signingPublicKey: material.signingPublicKey,
    agreementPublicKey: material.agreementPublicKey,
    authorisedBy: { kind: 'self' as const },
    revision: 1,
    createdAt: now,
  };
  const record: DeviceRecord = {
    ...recordInput,
    authorisation: signDeviceRecord(recordInput, material.signingPrivateKey),
  };
  await client.claimDevice({
    deviceId,
    signingPublicKey: encodeBase64(material.signingPublicKey),
    agreementPublicKey: encodeBase64(material.agreementPublicKey),
  });
  await client.putDeviceRecord(toWireDeviceRecord(record));

  // The root seals the key to itself as well. It holds the key already, but an
  // envelope is how *every* device re-derives it after a restart, and having
  // the root take the same path means one restore path rather than two.
  await client.putSpaceKeyEnvelope(
    toWireSpaceKeyEnvelope(
      sealSpaceKeyForDevice({
        spaceKey,
        spaceId,
        generation: SIGNED_ALBUM_GENERATION,
        recipientDeviceId: deviceId,
        authoriserDeviceId: deviceId,
        recipientRevision: 1,
        authoriserAgreementPrivateKey: material.agreementPrivateKey,
        recipientAgreementPublicKey: material.agreementPublicKey,
      })
    )
  );

  await client.putRecoveryEnvelope(
    SIGNED_ALBUM_GENERATION,
    toWireRecoveryEnvelope(
      sealSpaceKeyForRecovery({
        spaceKey,
        spaceId,
        generation: SIGNED_ALBUM_GENERATION,
        entropy,
      })
    )
  );

  await pinAnchor(spaceId, anchor);
  await writeRecoveryEntropy(spaceId, entropy);

  return {
    status: 'ready',
    spaceId,
    generation: SIGNED_ALBUM_GENERATION,
    spaceKey,
    deviceId,
    device: material,
    anchor,
    records: [record],
    client,
  };
}

/**
 * Authorise another device. The root's job, and the primitive the interactive
 * out-of-band comparison sits on top of.
 *
 * The authoriser writes the envelope (it owns the authorising device) and
 * returns the signed record; the *recipient* writes its own record, because the
 * server binds a device row to the account that claimed it. An authoriser
 * writing the recipient's row would be the race the claim exists to prevent.
 */
export async function authoriseProtocolDevice(
  session: ProtocolArchiveReady,
  target: { deviceId: string; signingPublicKey: Uint8Array; agreementPublicKey: Uint8Array },
  now: string
): Promise<DeviceRecord> {
  const recordInput = {
    deviceId: target.deviceId,
    spaceId: session.spaceId,
    signingPublicKey: target.signingPublicKey,
    agreementPublicKey: target.agreementPublicKey,
    authorisedBy: { kind: 'device' as const, deviceId: session.deviceId },
    revision: 1,
    createdAt: now,
  };
  const record: DeviceRecord = {
    ...recordInput,
    authorisation: signDeviceRecord(recordInput, session.device.signingPrivateKey),
  };
  const envelope = sealSpaceKeyForDevice({
    spaceKey: session.spaceKey,
    spaceId: session.spaceId,
    generation: session.generation,
    recipientDeviceId: target.deviceId,
    authoriserDeviceId: session.deviceId,
    recipientRevision: 1,
    authoriserAgreementPrivateKey: session.device.agreementPrivateKey,
    recipientAgreementPublicKey: target.agreementPublicKey,
  });
  await session.client.putSpaceKeyEnvelope(toWireSpaceKeyEnvelope(envelope));
  return record;
}

/** The recipient's half of enrolment: write the row this account owns. */
export async function publishProtocolDeviceRecord(
  client: AlbumProtocolClient,
  record: DeviceRecord
): Promise<void> {
  await client.putDeviceRecord(toWireDeviceRecord(record));
}

// ── upload ───────────────────────────────────────────────────────────────

export type PendingProtocolUploadRef = PendingProtocolUpload;

/**
 * An interrupted upload, carrying everything needed to finish it.
 *
 * The media id is generated once and travels with the error, because the
 * ciphertext's AAD binds it: finishing the same upload under a new id would
 * produce bytes that no manifest could ever authenticate.
 */
export class ProtocolUploadInterrupted extends Error {
  constructor(
    readonly pending: PendingProtocolUpload,
    message: string
  ) {
    super(message);
    this.name = 'ProtocolUploadInterrupted';
  }
}

export type UploadProtocolPhotoInput = {
  uri: string;
  width: number;
  height: number;
};

export async function uploadProtocolPhoto(
  session: ProtocolArchiveReady,
  prepared: UploadProtocolPhotoInput,
  options: { resume?: PendingProtocolUpload; scopeKey?: string; now?: string } = {}
): Promise<{ mediaId: string }> {
  const now = options.now ?? new Date().toISOString();
  let pending = options.resume;

  if (!pending) {
    const bytes = await readPhotoBytes(prepared.uri);
    const mediaId = randomUUID();
    const context = encodeMediaContext({ mediaId, generation: session.generation });
    const mediaKey = generateMediaKey();
    const sealed = sealMediaCiphertext({ mediaKey, plaintext: bytes, context });
    const manifestInput: MediaManifestInput = {
      mediaId,
      spaceId: session.spaceId,
      generation: session.generation,
      // One manifest per media, so there is no second revision to order against.
      revision: 1,
      wrappedKey: wrapMediaKey({ spaceKey: session.spaceKey, mediaKey, context }),
      sealedNonce: sealed.nonce,
      byteLength: sealed.ciphertext.length,
      mimeType: 'image/jpeg',
      width: prepared.width,
      height: prepared.height,
      uploaderDeviceId: session.deviceId,
      createdAt: now,
    };
    pending = {
      mediaId,
      manifest: {
        ...manifestInput,
        signature: signMediaManifest(manifestInput, session.device.signingPrivateKey),
      },
      ciphertext: sealed.ciphertext,
      uri: prepared.uri,
      width: prepared.width,
      height: prepared.height,
      createdAt: now,
    };
  }

  // Persist before the first network call. A termination anywhere below — the
  // reserve, the PUT, the finalisation, or the manifest — then leaves enough
  // behind to finish under the same media id.
  const upload = pending;
  if (options.scopeKey) {
    await rememberPendingUpload(options.scopeKey, {
      ...upload,
      uri: prepared.uri,
      width: prepared.width,
      height: prepared.height,
      createdAt: now,
    });
  }

  try {
    const reservation = await session.client.reserveMedia({
      mediaId: upload.mediaId,
      generation: session.generation,
      uploaderDeviceId: session.deviceId,
      byteLength: upload.ciphertext.length,
    });
    await session.client.putObject(reservation.uploadUrl, reservation.headers, upload.ciphertext);
    await session.client.finalizeMedia(upload.mediaId);
  } catch (error) {
    // A refusal here means the server is further along than this attempt — not
    // that the upload is finished. Whether it is finished is decided below, by
    // whether the manifest publishes, which is the only proof the whole
    // sequence completed.
    const recoverable =
      error instanceof ProtocolRequestError &&
      (error.status === 400 || error.status === 409 || error.status === 412);
    if (!recoverable) {
      throw new ProtocolUploadInterrupted(
        upload,
        'The upload was interrupted. Retry with the same media id.'
      );
    }
  }

  try {
    await session.client.putManifest(upload.mediaId, toWireMediaManifest(upload.manifest));
  } catch {
    throw new ProtocolUploadInterrupted(
      upload,
      'The upload could not be finished. Retry with the same media id.'
    );
  }

  // Only now: the manifest published, so this upload is genuinely finished and
  // only its own temporary file may go.
  if (options.scopeKey) {
    await forgetPendingUpload(options.scopeKey, upload.mediaId);
  }

  return { mediaId: upload.mediaId };
}

// ── read ─────────────────────────────────────────────────────────────────

export type ProtocolPhoto = {
  mediaId: string;
  addedAt: string;
  width?: number;
  height?: number;
  bytes: Uint8Array;
};

export type ProtocolArchiveRead = {
  photos: ProtocolPhoto[];
  /** Media this device has authenticated as removed. */
  deleted: string[];
  /** Manifests the server listed that did not verify, with the reason. */
  rejected: { mediaId: string; reason: string }[];
  /**
   * True when an object could not be fetched, so `photos` is known to be
   * missing at least one entry that might otherwise be visible. A caller must
   * not treat this list as the whole archive, and must not evict a cached photo
   * because it is absent from it.
   */
  incomplete: boolean;
  /**
   * The media whose download failed this pass. Distinct from `deleted` and
   * `rejected`: those are decisions, this is an outage, and a caller keeps the
   * copy it already showed rather than treating the outage as a removal.
   */
  missing: string[];
};

export async function readProtocolArchive(
  session: ProtocolArchiveReady
): Promise<ProtocolArchiveRead> {
  // Refresh the trust state first. A session captures the snapshot it was
  // established from, and a device that joined afterwards is not in it — its
  // media is real, and refusing it would make the archive silently partial.
  const snapshot = await session.client.getSnapshot();
  const anchor =
    snapshot.anchor === null ? session.anchor : parseWireSpaceTrustAnchor(snapshot.anchor);
  if (!anchorsMatch(anchor, session.anchor)) {
    // The read does not get to change which root this device trusts.
    throw new Error('the server offered a different trust root');
  }
  const records = snapshot.records.map(parseWireDeviceRecord);

  // Every page, or an error. A partial page looks exactly like a small archive,
  // and presenting one as complete is a claim we cannot support.
  const tombstones: WireMediaTombstone[] = [];
  const manifests = await collectMediaPages(async (cursor) => {
    const page = await session.client.fetchMediaProtocol(cursor);
    tombstones.push(...page.tombstones);
    return { manifests: page.manifests, nextCursor: page.nextCursor };
  });

  // Two rows for one media is not a bigger archive, it is a server contradicting
  // itself, and picking one would be a guess.
  const seenIds = new Set<string>();
  for (const manifest of manifests) {
    if (seenIds.has(manifest.mediaId)) {
      throw new Error('the archive listed the same media twice');
    }
    seenIds.add(manifest.mediaId);
  }

  const authenticated = authenticateMediaTombstones({
    anchor,
    records,
    tombstones,
  });
  const localDeletions = await readDeletionState(session.spaceId);

  const photos: ProtocolPhoto[] = [];
  const deleted: string[] = [];
  const rejected: { mediaId: string; reason: string }[] = [];
  const missing: string[] = [];

  for (const wire of manifests) {
    const verified = verifyArchiveManifest({
      anchor,
      records,
      mediaId: wire.mediaId,
      manifest: wire,
    });
    if (!verified.ok) {
      rejected.push({ mediaId: wire.mediaId, reason: verified.reason });
      continue;
    }
    const manifest = verified.manifest;

    // An authenticated tombstone, or a deletion this device already observed,
    // both outrank a manifest at a lower revision — which is what makes a
    // withheld tombstone unable to resurrect a photo.
    if (
      isMediaDeleted(manifest, authenticated) ||
      (localDeletions[manifest.mediaId] ?? 0) > manifest.revision
    ) {
      deleted.push(manifest.mediaId);
      continue;
    }

    let bytes: Uint8Array;
    try {
      bytes = await session.client.fetchMediaObject(manifest.mediaId);
    } catch {
      // A fetch that failed is not a photo that was deleted, and not a photo
      // that is absent: the archive is simply not fully known this pass. The
      // caller keeps whatever it already had and tries again.
      missing.push(manifest.mediaId);
      continue;
    }

    const result = readArchiveMedia({
      anchor,
      records,
      tombstones,
      spaceKey: session.spaceKey,
      generation: session.generation,
      mediaId: wire.mediaId,
      manifest: wire,
      ciphertext: bytes,
    });
    if (result.status === 'visible') {
      photos.push({
        mediaId: wire.mediaId,
        addedAt: manifest.createdAt,
        ...(manifest.width !== null && manifest.width !== undefined ? { width: manifest.width } : {}),
        ...(manifest.height !== null && manifest.height !== undefined
          ? { height: manifest.height }
          : {}),
        bytes: result.plaintext,
      });
    } else if (result.status === 'deleted') {
      deleted.push(wire.mediaId);
    } else {
      rejected.push({ mediaId: wire.mediaId, reason: result.reason });
    }
  }

  // Only now, after every signature verified, is it safe to remember them.
  for (const tombstone of authenticated) {
    await recordAuthenticatedDeletion(session.spaceId, tombstone.mediaId, tombstone.revision);
  }

  return { photos, deleted, rejected, incomplete: missing.length > 0, missing };
}

// ── remove ───────────────────────────────────────────────────────────────

export async function removeProtocolPhoto(
  session: ProtocolArchiveReady,
  input: { mediaId: string; manifestRevision: number; now?: string }
): Promise<void> {
  const at = input.now ?? new Date().toISOString();
  const tombstoneInput: MediaTombstoneInput = {
    spaceId: session.spaceId,
    mediaId: input.mediaId,
    revision: input.manifestRevision + 1,
    deletedAt: at,
    deletedByDeviceId: session.deviceId,
  };
  const tombstone: MediaTombstone = {
    ...tombstoneInput,
    signature: signMediaTombstone(tombstoneInput, session.device.signingPrivateKey),
  };
  await session.client.postMediaTombstone(toWireMediaTombstone(tombstone));
  // Our own tombstone is authenticated by construction: we signed it.
  await recordAuthenticatedDeletion(session.spaceId, input.mediaId, tombstoneInput.revision);
}

// ── enrolment ────────────────────────────────────────────────────────────

/**
 * The code two people compare out of band before a device is trusted.
 *
 * It covers both signing keys, so each side learns exactly which key it is
 * trusting, and `verificationFingerprint` sorts them, so both people read the
 * same string whichever phone is showing it.
 */
export function enrolmentFingerprint(
  session: ProtocolArchiveReady,
  targetSigningPublicKey: Uint8Array
): string {
  return verificationFingerprint(session.device.signingPublicKey, targetSigningPublicKey);
}

/**
 * The same string, from the joining device's side.
 *
 * `verificationFingerprint` sorts its inputs, so both people read the same code
 * whichever phone is showing it — which is what makes comparing it out loud
 * work at all.
 */
export function joiningFingerprint(
  ownSigningPublicKey: Uint8Array,
  rootSigningPublicKey: Uint8Array
): string {
  return verificationFingerprint(ownSigningPublicKey, rootSigningPublicKey);
}

export type PendingEnrolmentClaim = {
  deviceId: string;
  signingPublicKey: Uint8Array;
  agreementPublicKey: Uint8Array;
  createdAt: string;
};

/** Devices that have asked to join this Space and are not enrolled yet. */
export async function pendingEnrolmentClaims(
  session: ProtocolArchiveReady
): Promise<PendingEnrolmentClaim[]> {
  const snapshot = await session.client.getSnapshot();
  return snapshot.claims.map((claim) => ({
    deviceId: claim.deviceId,
    signingPublicKey: fromBase64(claim.signingPublicKey),
    agreementPublicKey: fromBase64(claim.agreementPublicKey),
    createdAt: claim.createdAt,
  }));
}

/**
 * Approve a claim: sign the record, seal the envelope, leave the offer.
 *
 * The envelope goes to the server under this account; the signed record goes to
 * the offer relay, because the recipient owns its own device row and must
 * publish it itself.
 */
export async function approveEnrolmentClaim(
  session: ProtocolArchiveReady,
  claim: PendingEnrolmentClaim,
  now: string
): Promise<DeviceRecord> {
  const record = await authoriseProtocolDevice(
    session,
    {
      deviceId: claim.deviceId,
      signingPublicKey: claim.signingPublicKey,
      agreementPublicKey: claim.agreementPublicKey,
    },
    now
  );
  await session.client.putEnrollmentOffer(toWireDeviceRecord(record));
  return record;
}

/**
 * Collect an approval this device was given, verify it, and publish it.
 *
 * Verification is not optional and not the server's: the authoriser's signature
 * is checked against the authoriser's key, and that key has to descend from the
 * anchor this device has pinned. Only then is the record written under this
 * account, and only then does the ordinary establishment path run.
 */
export async function acceptEnrolmentOffer(input: {
  spaceId: string;
  deviceId?: string;
  client?: AlbumProtocolClient;
  keyStore?: LocalKeyStore;
  now?: string;
}): Promise<ProtocolArchive> {
  const client = input.client ?? getAlbumProtocolClient();

  let snapshot;
  try {
    snapshot = await client.getSnapshot();
  } catch {
    return { status: 'unavailable' };
  }

  const deviceId =
    input.deviceId ?? (await (await import('@/features/album/device-id')).getOrCreateDeviceId());

  const pinned = await readPinnedAnchor(input.spaceId);
  if (pinned.state !== 'pinned') {
    // Nothing is accepted for a root this device has not itself verified.
    return { status: 'blocked' };
  }

  let records: DeviceRecord[];
  let offers: DeviceRecord[];
  try {
    records = snapshot.records.map(parseWireDeviceRecord);
    offers = snapshot.offers.map(parseWireDeviceRecord);
  } catch {
    return { status: 'blocked' };
  }

  const offer = offers.find((candidate) => candidate.deviceId === deviceId);
  if (!offer) {
    return { status: 'waiting' };
  }

  const authoriser = offer.authorisedBy;
  if (authoriser.kind !== 'device') {
    return { status: 'blocked' };
  }
  const signer = highestRevision(records, authoriser.deviceId);
  if (
    !signer ||
    !verifyDeviceProvenance(authoriser.deviceId, pinned.anchor, records).trusted ||
    !verifyDeviceRecord(offer, signer.signingPublicKey)
  ) {
    return { status: 'blocked' };
  }

  try {
    await client.putDeviceRecord(toWireDeviceRecord(offer));
  } catch {
    return { status: 'unavailable' };
  }

  return establishProtocolArchive(input);
}

// ── recovery ─────────────────────────────────────────────────────────────

export type RecoveryOutcome =
  | { status: 'ready'; session: ProtocolArchiveReady }
  | { status: 'failed'; reason: string };

/**
 * Rebuild the archive on a device that has nothing, from the phrase alone.
 *
 * The trust decision is the phrase's, and `recoverSpaceFromPhrase` makes it:
 * the anchor's recovery key, the anchor's own signature over it, and the
 * recovery envelope. Nothing here accepts a root because a server offered one.
 *
 * The keys the recovery mints are stored *before* the record is published,
 * because a record describing keys this device no longer has is an archive it
 * cannot open — a recovery that half-succeeds is worse than one that fails.
 */
export async function recoverProtocolArchive(input: {
  spaceId: string;
  phrase: string;
  deviceId?: string;
  client?: AlbumProtocolClient;
  keyStore?: LocalKeyStore;
  now?: string;
}): Promise<RecoveryOutcome> {
  const client = input.client ?? getAlbumProtocolClient();

  let snapshot;
  try {
    snapshot = await client.getSnapshot();
  } catch {
    return { status: 'failed', reason: 'unreachable' };
  }
  if (snapshot.anchor === null) {
    return { status: 'failed', reason: 'no-anchor' };
  }

  let anchor: SpaceTrustAnchor;
  let recoveryEnvelope;
  try {
    anchor = parseWireSpaceTrustAnchor(snapshot.anchor);
    const found = snapshot.recoveryEnvelopes.find(
      (candidate) => candidate.generation === SIGNED_ALBUM_GENERATION
    );
    if (!found) return { status: 'failed', reason: 'no-recovery-envelope' };
    recoveryEnvelope = parseWireRecoveryEnvelope(found);
  } catch {
    return { status: 'failed', reason: 'invalid-protocol-state' };
  }

  const store =
    input.keyStore ?? (await import('@/features/album/local-key-store')).createLocalKeyStore();
  const deviceId =
    input.deviceId ?? (await (await import('@/features/album/device-id')).getOrCreateDeviceId());
  const now = input.now ?? new Date().toISOString();

  const recovered = recoverSpaceFromPhrase({
    phrase: input.phrase,
    expectedSpaceId: input.spaceId,
    anchor,
    recoveryEnvelope,
    deviceId,
    createdAt: now,
  });
  if (!recovered.recovered) {
    return { status: 'failed', reason: recovered.reason };
  }

  await store.saveDevice(input.spaceId, {
    deviceId,
    signing: {
      privateKey: recovered.device.signingPrivateKey,
      publicKey: recovered.device.signingPublicKey,
    },
    agreement: {
      privateKey: recovered.device.agreementPrivateKey,
      publicKey: recovered.device.agreementPublicKey,
    },
    createdAt: new Date(now),
  });

  try {
    await client.claimDevice({
      deviceId,
      signingPublicKey: encodeBase64(recovered.device.signingPublicKey),
      agreementPublicKey: encodeBase64(recovered.device.agreementPublicKey),
    });
    await client.putDeviceRecord(toWireDeviceRecord(recovered.record));
  } catch {
    return { status: 'failed', reason: 'could-not-publish' };
  }

  await pinAnchor(input.spaceId, anchor);

  return {
    status: 'ready',
    session: {
      status: 'ready',
      spaceId: input.spaceId,
      generation: SIGNED_ALBUM_GENERATION,
      spaceKey: recovered.spaceKey,
      deviceId,
      device: recovered.device,
      anchor,
      records: [recovered.record],
      client,
    },
  };
}
