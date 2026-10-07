import type { DeviceRecord, DeviceTombstone, SpaceTrustAnchor } from '@aoi/shared';

import { verifyDeviceRecord } from '@/features/album/protocol-crypto';

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
 * signer has to be reachable from an anchor.
 */

export type DeviceTrustFailure =
  /** The authoriser, or the target, has no record at all. */
  | 'unknown-device'
  /** A record or an applicable tombstone belongs to a different Space. */
  | 'wrong-space'
  /** An applicable tombstone names this device. */
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

export function verifyDeviceTrust(
  targetDeviceId: string,
  anchor: SpaceTrustAnchor,
  records: readonly DeviceRecord[],
  tombstones: readonly DeviceTombstone[] = []
): DeviceTrust {
  // The highest revision wins per device, so a server that serves an older
  // record alongside a newer one cannot make the older one the one that counts.
  const byDeviceId = new Map<string, DeviceRecord>();
  for (const record of records) {
    const existing = byDeviceId.get(record.deviceId);
    if (!existing || record.revision > existing.revision) {
      byDeviceId.set(record.deviceId, record);
    }
  }

  // Applicable means it belongs to this Space. A tombstone from somewhere else
  // that happens to name the same id revokes nothing here.
  const revokedIds = new Set(
    tombstones
      .filter((tombstone) => tombstone.spaceId === anchor.spaceId)
      .map((tombstone) => tombstone.targetDeviceId)
  );

  const walk = (deviceId: string, path: ReadonlySet<string>): DeviceTrust => {
    if (path.has(deviceId)) {
      return fail('cycle');
    }
    const record = byDeviceId.get(deviceId);
    if (!record) {
      return fail('unknown-device');
    }
    if (record.spaceId !== anchor.spaceId) {
      return fail('wrong-space');
    }
    if (revokedIds.has(deviceId)) {
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

    const upstream = walk(authoriser.deviceId, new Set([...path, deviceId]));
    if (!upstream.trusted) {
      // The upstream reason is propagated rather than flattened, because "your
      // authoriser is revoked" and "your authoriser is unknown" want different
      // things said to whoever is looking at it.
      return upstream;
    }
    const signer = byDeviceId.get(authoriser.deviceId);
    if (!signer) {
      return fail('unknown-device');
    }
    return verifyDeviceRecord(record, signer.signingPublicKey)
      ? TRUSTED
      : fail('bad-signature');
  };

  return walk(targetDeviceId, new Set());
}
