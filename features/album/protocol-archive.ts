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

import { generateMediaKey, fromBase64, toBase64 } from '@/features/album/crypto';
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
  clearCreationBootstrap,
  pinAnchor,
  readCreationBootstrap,
  readDeletionState,
  readPinnedAnchor,
  readRecoveryEntropy,
  recordAuthenticatedDeletion,
  writeCreationBootstrap,
  writeRecoveryEntropy,
  type CreationBootstrap,
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
    const bootstrap = await readCreationBootstrap(input.spaceId);
    if (bootstrap && bootstrap.deviceId === deviceId) {
      // An earlier attempt wrote its bootstrap but never finished. Resume it
      // rather than minting a second root beside it. A null resume means the
      // bootstrap is not ours to resume, and creation starts fresh over it —
      // safe only because no anchor exists yet, so nothing is being replaced.
      try {
        const resumed = await resumeCreation({
          spaceId: input.spaceId,
          deviceId,
          material,
          client,
          snapshot,
          bootstrap,
        });
        if (resumed) {
          return resumed;
        }
      } catch {
        return { status: 'unavailable' };
      }
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

  // A crash between pinning and persisting recovery entropy leaves a pinned
  // archive with no recoverable phrase — and a normal open would report it
  // ready without ever resuming the bootstrap. Reconcile first, but only for
  // an already-pinned archive: with no pin the resume path below owns the
  // bootstrap, and completing it here would clear the very state that path
  // needs to see.
  if (pinned.state === 'pinned') {
    try {
      await completeCreationBootstrap({
        spaceId: input.spaceId,
        deviceId,
        material,
        anchor,
      });
    } catch {
      return { status: 'unavailable' };
    }
  }

  if (pinned.state === 'none') {
    // No pin. The server's anchor being self-consistent with its own records and
    // envelopes is not evidence of anything: a fabricated Space looks exactly
    // like that. Nothing is pinned and no signed media is shown until a human
    // compares the root's fingerprint out of band, or the recovery phrase
    // authenticates the anchor.
    //
    // Unless this device started this creation and never finished it: then the
    // anchor above is ours, and the remaining rows are resumed rather than
    // re-minted.
    const bootstrap = await readCreationBootstrap(input.spaceId);
    if (bootstrap && bootstrap.deviceId === deviceId) {
      try {
        const resumed = await resumeCreation({
          spaceId: input.spaceId,
          deviceId,
          material,
          client,
          snapshot,
          bootstrap,
        });
        if (resumed) {
          return resumed;
        }
      } catch {
        return { status: 'unavailable' };
      }
    }
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
  const envelope = sealSpaceKeyForDevice({
    spaceKey,
    spaceId,
    generation: SIGNED_ALBUM_GENERATION,
    recipientDeviceId: deviceId,
    authoriserDeviceId: deviceId,
    recipientRevision: 1,
    authoriserAgreementPrivateKey: material.agreementPrivateKey,
    recipientAgreementPublicKey: material.agreementPublicKey,
  });
  const recoveryEnvelope = sealSpaceKeyForRecovery({
    spaceKey,
    spaceId,
    generation: SIGNED_ALBUM_GENERATION,
    entropy,
  });

  // Frozen before the first network call. The anchor publication below is the
  // irreversible step; everything after it can be retried from this bootstrap,
  // which republishes byte-identical rows rather than minting a second root.
  const wireAnchor = toWireSpaceTrustAnchor(anchor);
  const wireRecord = toWireDeviceRecord(record);
  const wireEnvelope = toWireSpaceKeyEnvelope(envelope);
  const wireRecoveryEnvelope = toWireRecoveryEnvelope(recoveryEnvelope);
  await writeCreationBootstrap(spaceId, {
    deviceId,
    spaceKey: toBase64(spaceKey),
    entropy: toBase64(entropy),
    anchor: wireAnchor,
    record: wireRecord,
    envelope: wireEnvelope,
    recoveryEnvelope: wireRecoveryEnvelope,
    createdAt: now,
  });

  await client.putAnchor(wireAnchor);
  await client.claimDevice({
    deviceId,
    signingPublicKey: encodeBase64(material.signingPublicKey),
    agreementPublicKey: encodeBase64(material.agreementPublicKey),
  });
  await client.putDeviceRecord(wireRecord);

  // The root seals the key to itself as well. It holds the key already, but an
  // envelope is how *every* device re-derives it after a restart, and having
  // the root take the same path means one restore path rather than two.
  await client.putSpaceKeyEnvelope(wireEnvelope);
  await client.putRecoveryEnvelope(SIGNED_ALBUM_GENERATION, wireRecoveryEnvelope);

  // Local completion is idempotent: a crash between these writes leaves the
  // bootstrap behind, and the next open finishes what is missing rather than
  // reporting a pinned archive with no recoverable phrase.
  if ((await finalizeCreation({ spaceId, anchor, entropy })) !== 'ok') {
    return { status: 'unavailable' };
  }

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
 * Canonical form for comparing a stored payload with a server row.
 *
 * Both sides are already parsed, so key order and `Uint8Array` instances are
 * the only things that can differ between two identical payloads. Sorting keys
 * and spelling bytes as base64 removes both without touching the semantics.
 */
function canonicalize(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return toBase64(value);
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

/**
 * Finish local creation state idempotently: re-pin the anchor, persist the
 * recovery entropy, confirm it round-trips through the protected store, then
 * remove the bootstrap.
 *
 * Every step repeats the same bytes, so a crash anywhere in this sequence is
 * safe to retry — including a retry of a retry. The bootstrap is removed only
 * after the entropy is confirmed readable, so a pinned archive is never left
 * without a recoverable phrase. Anything that cannot be confirmed surfaces as
 * `unavailable` with the bootstrap retained, never as a ready archive with a
 * silent gap.
 */
async function finalizeCreation(input: {
  spaceId: string;
  anchor: SpaceTrustAnchor;
  entropy: Uint8Array;
}): Promise<'ok' | 'unavailable'> {
  try {
    await pinAnchor(input.spaceId, input.anchor);
    await writeRecoveryEntropy(input.spaceId, input.entropy);
    const stored = await readRecoveryEntropy(input.spaceId);
    if (!stored || !sameBytes(stored, input.entropy)) {
      return 'unavailable';
    }
    await clearCreationBootstrap(input.spaceId);
    return 'ok';
  } catch {
    return 'unavailable';
  }
}

/**
 * Complete a creation bootstrap for an already-pinned archive.
 *
 * This is the crash window the normal paths miss: pin written, recovery
 * entropy not yet persisted, bootstrap still present. The bootstrap is
 * authenticated before anything is written — it must name the pinned root,
 * the root key must be this device's, and the entropy must derive the
 * recovery key the anchor commits to. Anything else is left alone: a foreign
 * bootstrap is not ours to complete, and the callers treat the archive
 * exactly as they would have without it.
 */
async function completeCreationBootstrap(input: {
  spaceId: string;
  deviceId: string;
  material: DeviceKeyMaterial;
  anchor: SpaceTrustAnchor;
}): Promise<void> {
  const bootstrap = await readCreationBootstrap(input.spaceId);
  if (!bootstrap || bootstrap.deviceId !== input.deviceId) {
    return;
  }
  let entropy: Uint8Array;
  let bootstrapAnchor: SpaceTrustAnchor;
  try {
    entropy = fromBase64(bootstrap.entropy);
    bootstrapAnchor = parseWireSpaceTrustAnchor(bootstrap.anchor);
  } catch {
    return;
  }
  if (!anchorsMatch(bootstrapAnchor, input.anchor)) {
    return;
  }
  if (
    toBase64(bootstrapAnchor.rootSigningPublicKey) !== toBase64(input.material.signingPublicKey)
  ) {
    return;
  }
  if (
    toBase64(recoverySigningPublicKey(entropy)) !== toBase64(input.anchor.recoverySigningPublicKey)
  ) {
    return;
  }
  if (
    (await finalizeCreation({ spaceId: input.spaceId, anchor: input.anchor, entropy })) !== 'ok'
  ) {
    throw new Error('creation bootstrap completion failed');
  }
}

/**
 * Finish a creation this device started but did not complete.
 *
 * Every remote step is reconciled against the snapshot rather than blindly
 * re-sent: the record PUT is the one the server rejects on an identical retry,
 * so a stored row that already matches is skipped instead of rewritten.
 * Anything the server holds that is *different* from the bootstrap is someone
 * else's creation, and resuming stops there.
 *
 * Returns null when there is nothing of this device's to resume, so the caller
 * falls through to the normal path (a fresh creation, or an unverified join).
 * Corrupt content is the only thing that blocks: it can be neither resumed
 * nor safely ignored.
 */
async function resumeCreation(input: {
  spaceId: string;
  deviceId: string;
  material: DeviceKeyMaterial;
  client: AlbumProtocolClient;
  snapshot: Awaited<ReturnType<AlbumProtocolClient['getSnapshot']>>;
  bootstrap: CreationBootstrap;
}): Promise<ProtocolArchive | null> {
  const { spaceId, deviceId, material, client, snapshot, bootstrap } = input;

  let anchor: SpaceTrustAnchor;
  let record: DeviceRecord;
  let envelope: ReturnType<typeof parseWireSpaceKeyEnvelope>;
  let recoveryEnvelope: ReturnType<typeof parseWireRecoveryEnvelope>;
  try {
    anchor = parseWireSpaceTrustAnchor(bootstrap.anchor);
    record = parseWireDeviceRecord(bootstrap.record);
    envelope = parseWireSpaceKeyEnvelope(bootstrap.envelope);
    recoveryEnvelope = parseWireRecoveryEnvelope(bootstrap.recoveryEnvelope);
  } catch {
    return { status: 'blocked' };
  }

  // The bootstrap only resumes its own creation: the anchor must name this
  // device's keys, or these signatures are not ours to republish. Anything
  // else falls through — a fresh creation when no anchor exists, an unverified
  // join when one does — and the stale bootstrap is overwritten or ignored
  // there, never resumed.
  if (
    anchor.rootDeviceId !== deviceId ||
    toBase64(anchor.rootSigningPublicKey) !== toBase64(material.signingPublicKey)
  ) {
    return null;
  }

  // A server anchor that is not ours is someone else's Space, not an
  // interruption of ours.
  if (snapshot.anchor !== null) {
    let serverAnchor: SpaceTrustAnchor;
    try {
      serverAnchor = parseWireSpaceTrustAnchor(snapshot.anchor);
    } catch {
      return { status: 'blocked' };
    }
    if (!anchorsMatch(serverAnchor, anchor)) {
      return null;
    }
  }

  const samePayload = (left: unknown, right: unknown): boolean =>
    JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));

  let records: DeviceRecord[];
  try {
    records = snapshot.records.map(parseWireDeviceRecord);
  } catch {
    return { status: 'blocked' };
  }

  const hasClaim = snapshot.claims.some(
    (claim) =>
      claim.deviceId === deviceId &&
      claim.signingPublicKey === encodeBase64(material.signingPublicKey) &&
      claim.agreementPublicKey === encodeBase64(material.agreementPublicKey)
  );
  const hasRecord = records.some(
    (candidate) => candidate.deviceId === deviceId && samePayload(candidate, record)
  );
  let envelopes: ReturnType<typeof parseWireSpaceKeyEnvelope>[];
  try {
    envelopes = snapshot.envelopes.map(parseWireSpaceKeyEnvelope);
  } catch {
    return { status: 'blocked' };
  }
  const hasEnvelope = envelopes.some(
    (candidate) =>
      candidate.recipientDeviceId === deviceId &&
      candidate.generation === SIGNED_ALBUM_GENERATION &&
      samePayload(candidate, envelope)
  );
  let recoveryEnvelopes: ReturnType<typeof parseWireRecoveryEnvelope>[];
  try {
    recoveryEnvelopes = snapshot.recoveryEnvelopes.map(parseWireRecoveryEnvelope);
  } catch {
    return { status: 'blocked' };
  }
  const hasRecoveryEnvelope = recoveryEnvelopes.some(
    (candidate) =>
      candidate.generation === SIGNED_ALBUM_GENERATION && samePayload(candidate, recoveryEnvelope)
  );

  // A stored row that differs from the bootstrap is not an interruption of
  // this creation — it belongs to someone else — so resume stops instead of
  // overwriting it. The record PUT is the sharp edge: the server rejects an
  // identical retry, hence the skip above; a *different* record for our id is
  // a conflict we must not resolve by writing over it.
  const conflictingRecord = records.some(
    (candidate) => candidate.deviceId === deviceId && !samePayload(candidate, record)
  );
  if (conflictingRecord) {
    return { status: 'blocked' };
  }

  await client.putAnchor(toWireSpaceTrustAnchor(anchor));
  if (!hasClaim) {
    await client.claimDevice({
      deviceId,
      signingPublicKey: encodeBase64(material.signingPublicKey),
      agreementPublicKey: encodeBase64(material.agreementPublicKey),
    });
  }
  if (!hasRecord) {
    await client.putDeviceRecord(toWireDeviceRecord(record));
    records = [...records, record];
  }
  if (!hasEnvelope) {
    await client.putSpaceKeyEnvelope(toWireSpaceKeyEnvelope(envelope));
  }
  if (!hasRecoveryEnvelope) {
    await client.putRecoveryEnvelope(
      SIGNED_ALBUM_GENERATION,
      toWireRecoveryEnvelope(recoveryEnvelope)
    );
  }

  let entropy: Uint8Array;
  try {
    entropy = fromBase64(bootstrap.entropy);
  } catch {
    return { status: 'blocked' };
  }
  if ((await finalizeCreation({ spaceId, anchor, entropy })) !== 'ok') {
    return { status: 'unavailable' };
  }

  return {
    status: 'ready',
    spaceId,
    generation: SIGNED_ALBUM_GENERATION,
    spaceKey: fromBase64(bootstrap.spaceKey),
    deviceId,
    device: material,
    anchor,
    records,
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
 * It covers the joining device's key and the anchor's root key — the two keys
 * both sides already know — so the approving device and the joining device
 * always read the same string, whoever the approver is. Comparing the
 * approver's own key instead would give a different code on each side whenever
 * the approver is not the original root.
 */
export function enrolmentFingerprint(
  session: ProtocolArchiveReady,
  targetSigningPublicKey: Uint8Array
): string {
  return verificationFingerprint(
    session.anchor.rootSigningPublicKey,
    targetSigningPublicKey
  );
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
 * Publish a recovery record from keys already on disk.
 *
 * This is the second half of a half-finished recovery: the claim is reserved
 * with exactly these keys, so the record is built from them — not from freshly
 * minted ones the claim would reject — and signed by the recovery key the
 * phrase derives.
 */
async function publishResumedRecovery(input: {
  spaceId: string;
  anchor: SpaceTrustAnchor;
  spaceKey: Uint8Array;
  device: DeviceKeyMaterial;
  deviceId: string;
  phrase: string;
  now: string;
  client: AlbumProtocolClient;
}): Promise<RecoveryOutcome> {
  let entropy: Uint8Array;
  try {
    entropy = recoveryEntropyFromPhrase(input.phrase);
  } catch {
    return { status: 'failed', reason: 'invalid-phrase' };
  }
  const recordInput = {
    deviceId: input.deviceId,
    spaceId: input.spaceId,
    signingPublicKey: input.device.signingPublicKey,
    agreementPublicKey: input.device.agreementPublicKey,
    authorisedBy: { kind: 'recovery' as const },
    revision: 1,
    createdAt: input.now,
  };
  const record: DeviceRecord = {
    ...recordInput,
    authorisation: signDeviceRecord(recordInput, deriveRecoverySigningKey(entropy)),
  };
  try {
    await input.client.putDeviceRecord(toWireDeviceRecord(record));
  } catch {
    return { status: 'failed', reason: 'could-not-publish' };
  }
  await pinAnchor(input.spaceId, input.anchor);
  return {
    status: 'ready',
    session: {
      status: 'ready',
      spaceId: input.spaceId,
      generation: SIGNED_ALBUM_GENERATION,
      spaceKey: input.spaceKey,
      deviceId: input.deviceId,
      device: input.device,
      anchor: input.anchor,
      records: [record],
      client: input.client,
    },
  };
}

/**
 * Rebuild the archive on a device that has nothing, from the phrase alone.
 *
 * The trust decision is the phrase's, and `recoverSpaceFromPhrase` makes it:
 * the anchor's recovery key, the anchor's own signature over it, and the
 * recovery envelope. Nothing here accepts a root because a server offered one.
 *
 * Key material is never overwritten blindly. The publication sequence is
 * claim → save → publish: the claim reserves the identity without destroying
 * anything, the save keeps the keys this device will need, and only then is
 * the record published. A device that is already enrolled is refused outright
 * — recovery must not destroy working keys — and a half-finished recovery
 * whose claim matches the keys on disk resumes from those keys rather than
 * minting new ones.
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

  let records: DeviceRecord[];
  try {
    records = snapshot.records.map(parseWireDeviceRecord);
  } catch {
    return { status: 'failed', reason: 'invalid-protocol-state' };
  }

  const existing = await store.loadDevice(input.spaceId);

  // Pure: validates the phrase and derives the space key without writing
  // anything, so every path below can use it.
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

  if (existing && existing.deviceId !== deviceId) {
    // Keys for a different identity live here. Recovery must never silently
    // replace them.
    return { status: 'failed', reason: 'device-already-enrolled' };
  }
  if (existing && existing.deviceId === deviceId) {
    const enrolled = records.find((record) => record.deviceId === deviceId);
    if (enrolled) {
      // Already enrolled: this device works, and recovery must not touch it.
      // Selecting Restore on a working phone is a mistake, not a migration.
      return { status: 'failed', reason: 'device-already-enrolled' };
    }
    const ownClaim = snapshot.claims.find((claim) => claim.deviceId === deviceId);
    if (
      ownClaim &&
      ownClaim.signingPublicKey === encodeBase64(existing.signing.publicKey) &&
      ownClaim.agreementPublicKey === encodeBase64(existing.agreement.publicKey)
    ) {
      // Our own half-finished recovery: the claim is reserved with these keys
      // but the record never published. Resume from the keys on disk rather
      // than minting new ones the claim would reject.
      return publishResumedRecovery({
        spaceId: input.spaceId,
        anchor,
        spaceKey: recovered.spaceKey,
        device: {
          signingPrivateKey: existing.signing.privateKey,
          signingPublicKey: existing.signing.publicKey,
          agreementPrivateKey: existing.agreement.privateKey,
          agreementPublicKey: existing.agreement.publicKey,
        },
        deviceId,
        phrase: input.phrase,
        now,
        client,
      });
    }
    if (!ownClaim) {
      // Keys this phone made by opening Us: never enrolled, never claimed.
      // Reuse them instead of refusing: claim under these keys, then publish a
      // recovery-authorized record for them. Nothing is overwritten — these
      // keys stay on disk exactly as they are — and a conflicting claim fails
      // below without touching them.
      try {
        await client.claimDevice({
          deviceId,
          signingPublicKey: encodeBase64(existing.signing.publicKey),
          agreementPublicKey: encodeBase64(existing.agreement.publicKey),
        });
      } catch {
        return { status: 'failed', reason: 'could-not-publish' };
      }
      return publishResumedRecovery({
        spaceId: input.spaceId,
        anchor,
        spaceKey: recovered.spaceKey,
        device: {
          signingPrivateKey: existing.signing.privateKey,
          signingPublicKey: existing.signing.publicKey,
          agreementPrivateKey: existing.agreement.privateKey,
          agreementPublicKey: existing.agreement.publicKey,
        },
        deviceId,
        phrase: input.phrase,
        now,
        client,
      });
    }
    // Keys on disk that the server does not know under this id. They may be
    // unpublished, but overwriting them silently is exactly the destruction
    // this sequence exists to prevent.
    return { status: 'failed', reason: 'device-already-enrolled' };
  }

  try {
    await client.claimDevice({
      deviceId,
      signingPublicKey: encodeBase64(recovered.device.signingPublicKey),
      agreementPublicKey: encodeBase64(recovered.device.agreementPublicKey),
    });
  } catch {
    return { status: 'failed', reason: 'could-not-publish' };
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
    await client.putDeviceRecord(toWireDeviceRecord(recovered.record));
  } catch {
    // The claim is reserved and the keys are on disk, so this is retryable:
    // a second attempt finds the same claim with the same keys and resumes.
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
