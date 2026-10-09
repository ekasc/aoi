import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';

import {
  deriveSpaceKey,
  fromBase64,
  generateIdentityKeypair,
  toBase64,
  type IdentityKeypair as AgreementKeypair,
} from '@/features/album/crypto';

/**
 * Who a device is, and who vouches for it.
 *
 * The model is Matrix's cross-signing, not Signal's ratchet, and the
 * difference matters for a couples app. A ratchet exists to give forward
 * secrecy across a long message stream, which an archive does not want: you
 * want to be able to open a photo from five years ago. What an archive does
 * want is a way to tell a genuine new phone from an attacker's, and that is
 * a verification problem rather than a confidentiality one.
 *
 * So: one long-lived Ed25519 *signing* identity per person, distinct from
 * the X25519 key they agree the space key with. The identity signs device
 * keys. A device that arrives without a signature is a device nobody has
 * vouched for, and it is refused rather than trusted.
 */

export type DeviceIdentity = {
  deviceId: string;
  /** Ed25519. Signs this person's device keys. */
  signingPublicKey: Uint8Array;
  /** X25519. Agrees the space key with. */
  agreementPublicKey: Uint8Array;
  createdAt: string;
};

export type SigningKeypair = {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
};

export function generateSigningKeypair(): SigningKeypair {
  const privateKey = ed25519.utils.randomSecretKey();
  return { privateKey, publicKey: ed25519.getPublicKey(privateKey) };
}

export type WireDeviceIdentity = {
  deviceId: string;
  signingPublicKey: string;
  agreementPublicKey: string;
  createdAt: string;
};

export function toWire(identity: DeviceIdentity): WireDeviceIdentity {
  return {
    deviceId: identity.deviceId,
    signingPublicKey: toBase64(identity.signingPublicKey),
    agreementPublicKey: toBase64(identity.agreementPublicKey),
    createdAt: identity.createdAt,
  };
}

export function fromWire(wire: WireDeviceIdentity): DeviceIdentity {
  return {
    deviceId: wire.deviceId,
    signingPublicKey: fromBase64(wire.signingPublicKey),
    agreementPublicKey: fromBase64(wire.agreementPublicKey),
    createdAt: wire.createdAt,
  };
}

// ── cross-signing ────────────────────────────────────────────────────────

export type SignedDeviceKey = {
  deviceId: string;
  agreementPublicKey: string;
  /** Ed25519 signature over the canonical bytes of the device's key. */
  signature: string;
  /** The identity that vouched, so the verifier knows whose word to trust. */
  signedBy: string;
};

/**
 * Canonical bytes for a device key. Both sides must hash the same thing, so
 * this is a fixed field order with length prefixes rather than string
 * joining — a device id containing a separator must not be able to produce
 * the same bytes as a different (id, key) pair.
 */
function deviceKeyBytes(deviceId: string, agreementPublicKey: Uint8Array): Uint8Array {
  const id = new TextEncoder().encode(deviceId);
  const out = new Uint8Array(4 + id.length + 4 + agreementPublicKey.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, id.length, false);
  out.set(id, 4);
  view.setUint32(4 + id.length, agreementPublicKey.length, false);
  out.set(agreementPublicKey, 8 + id.length);
  return out;
}

export function signDeviceKey(
  signing: SigningKeypair,
  deviceId: string,
  agreementPublicKey: Uint8Array,
): SignedDeviceKey {
  const signature = ed25519.sign(deviceKeyBytes(deviceId, agreementPublicKey), signing.privateKey);
  return {
    deviceId,
    agreementPublicKey: toBase64(agreementPublicKey),
    signature: toBase64(new Uint8Array(signature)),
    signedBy: toBase64(signing.publicKey),
  };
}

/**
 * Verify a device key against the identity that claims to have signed it.
 *
 * Returns a reason rather than a bare boolean, because "this key is forged"
 * and "this key was signed by someone you have never met" need different
 * things said to the person looking at it.
 */
export function verifyDeviceKey(
  signed: SignedDeviceKey,
  expectedSigner?: Uint8Array,
): { ok: true } | { ok: false; reason: 'forged' | 'unknown-signer' } {
  if (expectedSigner && toBase64(expectedSigner) !== signed.signedBy) {
    return { ok: false, reason: 'unknown-signer' };
  }
  let signature: Uint8Array;
  let agreement: Uint8Array;
  try {
    signature = fromBase64(signed.signature);
    agreement = fromBase64(signed.agreementPublicKey);
  } catch {
    return { ok: false, reason: 'forged' };
  }
  const valid = ed25519.verify(
    signature,
    deviceKeyBytes(signed.deviceId, agreement),
    fromBase64(signed.signedBy),
  );
  return valid ? { ok: true } : { ok: false, reason: 'forged' };
}

// ── verification ─────────────────────────────────────────────────────────

/**
 * The fingerprint two people compare once, out loud or side by side.
 *
 * It exists because the server holds both public keys and could substitute
 * its own. Cross-signing means a substituted key is signed by nobody, so the
 * attack shows up as a new identity and a changed fingerprint rather than as
 * silent decryption. This is the part a person has to actually look at.
 *
 * Both identities are sorted before hashing, so both people see the same
 * number regardless of who is holding the phone.
 */
export function verificationFingerprint(
  mine: Uint8Array,
  theirs: Uint8Array,
): string {
  const a = toBase64(mine);
  const b = toBase64(theirs);
  const [first, second] = a < b ? [a, b] : [b, a];
  const digest = sha256(new TextEncoder().encode(`aoi/verify/v1|${first}|${second}`));
  // 30 bytes as 60 hex characters in 12 groups of 5. Five is the group size
  // that survives being read aloud to another person; ten does not, and a
  // fingerprint nobody can compare reliably is not a check at all.
  const hex = Array.from(digest.slice(0, 30))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return (hex.match(/.{1,5}/g) ?? []).join(' ');
}

// ── a device, assembled ──────────────────────────────────────────────────

export type DeviceKeys = {
  deviceId: string;
  signing: SigningKeypair;
  agreement: AgreementKeypair;
  createdAt: Date;
};

export function generateDeviceKeys(deviceId: string, createdAt: Date): DeviceKeys {
  return {
    deviceId,
    signing: generateSigningKeypair(),
    agreement: generateIdentityKeypair(),
    createdAt,
  };
}

export function identityOf(device: DeviceKeys): DeviceIdentity {
  return {
    deviceId: device.deviceId,
    signingPublicKey: device.signing.publicKey,
    agreementPublicKey: device.agreement.publicKey,
    createdAt: device.createdAt.toISOString(),
  };
}

/** The space key, from this device's agreement key and the partner's. */
export function spaceKeyFor(
  device: DeviceKeys,
  partnerAgreementPublicKey: Uint8Array,
): Uint8Array {
  return deriveSpaceKey(device.agreement.privateKey, partnerAgreementPublicKey);
}
