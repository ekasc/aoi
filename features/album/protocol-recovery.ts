import type { DeviceRecord, RecoveryEnvelope, SpaceTrustAnchor } from '@aoi/shared';

import {
  deriveRecoverySigningKey,
  generateDeviceKeyMaterial,
  openSpaceKeyFromRecoveryEnvelope,
  recoverySigningPublicKey,
  signDeviceRecord,
  verifySpaceTrustAnchor,
  verifySpaceTrustAnchorRecovery,
  type DeviceKeyMaterial,
} from '@/features/album/protocol-crypto';
import { verifyDeviceTrust } from '@/features/album/protocol-trust';
import { recoveryEntropyFromPhrase } from '@/features/album/recovery';

/**
 * Recovering a Space from the phrase alone.
 *
 * This is the path for a device that has nothing: no pinned anchor, no trusted
 * device to verify out of band, no key. The phrase has to carry the whole trust
 * decision, which is why the anchor is signed by the phrase as well as by the
 * root. Comparing the derived recovery public key against a field of the anchor
 * would not be enough, because that key is public and a server can keep it while
 * replacing the root around it.
 *
 * The order below is the trust order, not an optimisation:
 *
 *   phrase          -> the entropy everything else derives from
 *   expected space  -> the client's own idea of which Space it is joining
 *   recovery key    -> the phrase proves it holds the key the anchor names
 *   recovery sig    -> the phrase signed this whole object
 *   root sig        -> the object is internally consistent
 *   envelope space  -> the envelope is for this Space
 *   open            -> the stable key
 *   enrol           -> a record the trust walker will accept
 *
 * Nothing is written anywhere. The function is pure and returns the new device's
 * material only when every check above passed, so a failed recovery cannot leave
 * a half-enrolled device behind: persistence is the caller's act, after this
 * returns.
 */

export type RecoveryFailure =
  /** The phrase is not a valid 24-word phrase. */
  | 'invalid-phrase'
  /** The anchor is for a different Space than the one being recovered. */
  | 'wrong-space'
  /** The phrase derives a key the anchor does not name. */
  | 'anchor-recovery-key-mismatch'
  /** The anchor's recovery signature does not verify over its own bytes. */
  | 'invalid-recovery-signature'
  /** The root signature is missing or does not verify against the root key. */
  | 'invalid-root-signature'
  /** The envelope belongs to another Space, or does not open. */
  | 'recovery-envelope-invalid'
  /** Everything verified, and the walker still would not trust the record. */
  | 'untrusted-enrollment';

export type RecoveredSpace = {
  recovered: true;
  /** The stable key the archive was sealed under, unchanged by recovery. */
  spaceKey: Uint8Array;
  /** Fresh keys for this device. The caller stores them, or nothing works. */
  device: DeviceKeyMaterial;
  /** Signed by the phrase's key, `authorisedBy: recovery`. */
  record: DeviceRecord;
};

export type RecoveryResult = RecoveredSpace | { recovered: false; reason: RecoveryFailure };

export type RecoverSpaceInput = {
  phrase: string;
  /** The Space this client believes it is recovering, not the anchor's claim. */
  expectedSpaceId: string;
  anchor: SpaceTrustAnchor;
  recoveryEnvelope: RecoveryEnvelope;
  deviceId: string;
  createdAt: string;
};

const fail = (reason: RecoveryFailure): RecoveryResult => ({ recovered: false, reason });

export function recoverSpaceFromPhrase(input: RecoverSpaceInput): RecoveryResult {
  let entropy: Uint8Array;
  try {
    entropy = recoveryEntropyFromPhrase(input.phrase);
  } catch {
    // The phrase layer already refuses to say which word was wrong, because
    // that is a free oracle. The reason here is deliberately as coarse.
    return fail('invalid-phrase');
  }

  const anchor = input.anchor;

  if (anchor.spaceId !== input.expectedSpaceId) {
    return fail('wrong-space');
  }

  const recoveryPublicKey = recoverySigningPublicKey(entropy);
  if (!sameBytes(recoveryPublicKey, anchor.recoverySigningPublicKey)) {
    return fail('anchor-recovery-key-mismatch');
  }

  if (!verifySpaceTrustAnchorRecovery(anchor, recoveryPublicKey)) {
    return fail('invalid-recovery-signature');
  }

  // Not another trust source. Recovery has already established the anchor's
  // trusted fields; this checks the object is internally consistent, because
  // the recovery signature does not cover the root signature itself and a
  // server could otherwise replace that one field with garbage.
  if (!verifySpaceTrustAnchor(anchor, anchor.rootSigningPublicKey)) {
    return fail('invalid-root-signature');
  }

  if (input.recoveryEnvelope.spaceId !== anchor.spaceId) {
    return fail('recovery-envelope-invalid');
  }

  let spaceKey: Uint8Array;
  try {
    spaceKey = openSpaceKeyFromRecoveryEnvelope({
      envelope: input.recoveryEnvelope,
      entropy,
    });
  } catch {
    // A wrong generation, a moved envelope, or a tampered ciphertext. All of
    // them are the same thing to the person reading the message.
    return fail('recovery-envelope-invalid');
  }

  const device = generateDeviceKeyMaterial();
  const recordInput = {
    deviceId: input.deviceId,
    spaceId: anchor.spaceId,
    signingPublicKey: device.signingPublicKey,
    agreementPublicKey: device.agreementPublicKey,
    authorisedBy: { kind: 'recovery' as const },
    revision: 1,
    createdAt: input.createdAt,
  };
  const record: DeviceRecord = {
    ...recordInput,
    authorisation: signDeviceRecord(recordInput, deriveRecoverySigningKey(entropy)),
  };

  // The record this function just built is exactly the one the walker has to
  // accept, so this asserts the two halves of the design agree rather than
  // trusting that they do.
  if (!verifyDeviceTrust(record.deviceId, anchor, [record]).trusted) {
    return fail('untrusted-enrollment');
  }

  return { recovered: true, spaceKey, device, record };
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
