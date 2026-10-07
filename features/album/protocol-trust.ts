import type { DeviceRecord, DeviceTombstone, SpaceTrustAnchor } from '@aoi/shared';

import { verifyDeviceRecord, verifyDeviceTombstone } from '@/features/album/protocol-crypto';

/**
 * Is this device currently trusted?
 *
 * The rule, in one sentence: a device is trusted only if its authorisation chain
 * reaches the pinned root or the recovery root entirely through currently
 * non-revoked devices.
 *
 * The alternative, "trusted at the time it signed", needs to know *when* a
 * signature was made relative to a revocation, and nothing in the protocol can
 * establish that. `createdAt` is written by the signer, so a compromised device
 * can sign tomorrow and date it yesterday. That leaves the choice between
 * reconstructing history from attacker-controlled data and accepting that
 * revocation cascades. This takes the second, and the workflow that keeps it
 * workable is in the protocol document: reparent descendants before revoking
 * their authoriser.
 *
 * A signature being mathematically valid is never sufficient on its own. The
 * signer has to be reachable from an anchor, and that applies to a revocation
 * as much as to an authorisation: a tombstone nobody trusted signed is not a
 * revocation, it is a row the server made up.
 */

export type DeviceTrustFailure =
  /** The authoriser, or the target, has no record at all. */
  | 'unknown-device'
  /** A record belongs to a different Space. */
  | 'wrong-space'
  /** A validly signed, applicable tombstone names this device. */
  | 'revoked'
  /** The chain returns to a device it has already visited. */
  | 'cycle'
  /** A record claims to be self-authorised but is not the pinned root. */
  | 'self-not-root'
  /** The root's record carries a key the pinned anchor does not name. */
  | 'anchor-mismatch'
  /** A signature did not verify against the key its authoriser implies. */
  | 'bad-signature';

export type DeviceTrust = { trusted: true } | { trusted: false; reason: DeviceTrustFailure };

const TRUSTED: DeviceTrust = { trusted: true };

const fail = (reason: DeviceTrustFailure): DeviceTrust => ({ trusted: false, reason });

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

type RecordIndex = Map<string, DeviceRecord>;

/**
 * The highest revision wins per device, so a server that serves an older record
 * alongside a newer one cannot make the older one the one that counts.
 */
function indexByHighestRevision(records: readonly DeviceRecord[]): RecordIndex {
  const index: RecordIndex = new Map();
  for (const record of records) {
    const existing = index.get(record.deviceId);
    if (!existing || record.revision > existing.revision) {
      index.set(record.deviceId, record);
    }
  }
  return index;
}

function walk(
  deviceId: string,
  anchor: SpaceTrustAnchor,
  records: RecordIndex,
  revoked: ReadonlySet<string>,
  path: ReadonlySet<string>
): DeviceTrust {
  if (path.has(deviceId)) {
    return fail('cycle');
  }
  const record = records.get(deviceId);
  if (!record) {
    return fail('unknown-device');
  }
  if (record.spaceId !== anchor.spaceId) {
    return fail('wrong-space');
  }
  if (revoked.has(deviceId)) {
    return fail('revoked');
  }

  const authoriser = record.authorisedBy;

  if (authoriser.kind === 'self') {
    if (deviceId !== anchor.rootDeviceId) {
      return fail('self-not-root');
    }
    if (!sameBytes(record.signingPublicKey, anchor.rootSigningPublicKey)) {
      return fail('anchor-mismatch');
    }
    return verifyDeviceRecord(record, anchor.rootSigningPublicKey)
      ? TRUSTED
      : fail('bad-signature');
  }

  if (authoriser.kind === 'recovery') {
    return verifyDeviceRecord(record, anchor.recoverySigningPublicKey)
      ? TRUSTED
      : fail('bad-signature');
  }

  const upstream = walk(authoriser.deviceId, anchor, records, revoked, new Set([...path, deviceId]));
  if (!upstream.trusted) {
    // The upstream reason is propagated rather than flattened, because "your
    // authoriser is revoked" and "your authoriser is unknown" want different
    // things said to whoever is looking at it.
    return upstream;
  }
  const signer = records.get(authoriser.deviceId);
  if (!signer) {
    return fail('unknown-device');
  }
  return verifyDeviceRecord(record, signer.signingPublicKey)
    ? TRUSTED
    : fail('bad-signature');
}

/**
 * Is this tombstone a revocation, or a row the server made up?
 *
 * A tombstone counts only if the authority that issued it is itself valid. The
 * signature is checked against the key that authority implies, and for a device
 * that means the device has to be currently trusted under the revocations
 * already accepted.
 */
function revocationIsValid(
  tombstone: DeviceTombstone,
  anchor: SpaceTrustAnchor,
  records: RecordIndex,
  revoked: ReadonlySet<string>
): boolean {
  if (tombstone.spaceId !== anchor.spaceId) {
    return false;
  }

  const revoker = tombstone.revokedBy;

  if (revoker.kind === 'recovery') {
    return verifyDeviceTombstone(tombstone, anchor.recoverySigningPublicKey);
  }

  // A device cannot authorise its own removal. The type says a revoker is never
  // the target in the intended flow, but "intended" is not an invariant, and a
  // self-signed tombstone is the cheapest forgery to attempt.
  if (revoker.deviceId === tombstone.targetDeviceId) {
    return false;
  }

  const signer = records.get(revoker.deviceId);
  if (!signer) {
    return false;
  }
  if (!walk(revoker.deviceId, anchor, records, revoked, new Set()).trusted) {
    return false;
  }
  return verifyDeviceTombstone(tombstone, signer.signingPublicKey);
}

/**
 * The set of devices that have been validly revoked.
 *
 * Device trust depends on revocations and a revocation's validity depends on
 * device trust, so this grows a set rather than resolving it in one pass: start
 * trusting everyone, accept the tombstones whose authority is trusted, and
 * repeat. Each round evaluates every tombstone against the same set, so the
 * result does not depend on the order the server listed them in.
 *
 * Growing rather than shrinking is the safe direction. A forged tombstone
 * cannot enter, because its signer is not trusted; and in the pathological case
 * where two devices revoke each other, both are revoked, which is the
 * conservative outcome rather than letting a pair of compromised devices hold
 * the Space.
 */
function computeRevokedDeviceIds(
  anchor: SpaceTrustAnchor,
  records: RecordIndex,
  tombstones: readonly DeviceTombstone[]
): Set<string> {
  const revoked = new Set<string>();
  const applicable = tombstones.filter((tombstone) => tombstone.spaceId === anchor.spaceId);

  for (;;) {
    const accepted: string[] = [];
    for (const tombstone of applicable) {
      if (revoked.has(tombstone.targetDeviceId)) {
        continue;
      }
      if (revocationIsValid(tombstone, anchor, records, revoked)) {
        accepted.push(tombstone.targetDeviceId);
      }
    }
    if (accepted.length === 0) {
      return revoked;
    }
    for (const deviceId of accepted) {
      revoked.add(deviceId);
    }
  }
}

export function verifyDeviceTrust(
  targetDeviceId: string,
  anchor: SpaceTrustAnchor,
  records: readonly DeviceRecord[],
  tombstones: readonly DeviceTombstone[] = []
): DeviceTrust {
  const index = indexByHighestRevision(records);
  const revoked = computeRevokedDeviceIds(anchor, index, tombstones);
  return walk(targetDeviceId, anchor, index, revoked, new Set());
}
