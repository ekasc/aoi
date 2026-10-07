import { z } from 'zod';

import {
  AES_GCM_NONCE_BYTES,
  ED25519_PUBLIC_KEY_BYTES,
  ED25519_SIGNATURE_BYTES,
  PROTOCOL_MAX_COUNTER,
  PROTOCOL_MAX_ID_LENGTH,
  PROTOCOL_MAX_MEDIA_BYTES,
  PROTOCOL_MAX_MIME_TYPE_LENGTH,
  PROTOCOL_MIN_COUNTER,
  PROTOCOL_PERSON_TAGS,
  WRAPPED_KEY_BYTES,
  X25519_PUBLIC_KEY_BYTES,
  type DeviceRecord,
  type DeviceTombstone,
  type MediaManifest,
  type MediaTombstone,
  type RecoveryEnvelope,
  type SpaceKeyEnvelope,
  type SpaceTrustAnchor,
} from './album-protocol';

/**
 * The wire boundary.
 *
 * Two forms of every object exist and they are not interchangeable.
 *
 *   wire form      base64 strings, JSON-safe numbers and strings. What travels
 *                  over HTTP and what the server stores.
 *   protocol form  Uint8Array key material, tagged unions, validated integers.
 *                  What the cryptography receives.
 *
 * Nothing in between is allowed to guess. A parser decodes once, validates the
 * decoded length, and hands the crypto a byte array; it never passes a base64
 * string down, and the crypto never sees loosely validated JSON.
 *
 * Base64 has exactly one accepted spelling here: the standard alphabet, padded,
 * with zero bits in the final character's unused positions. Any other spelling
 * of the same bytes is refused rather than normalised, because a signature
 * covers bytes and two spellings of one key would otherwise be two signed
 * values.
 */

// ── canonical base64 ─────────────────────────────────────────────────────

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const BASE64_DIGITS = (() => {
  const digits = new Int16Array(128).fill(-1);
  for (let index = 0; index < BASE64_ALPHABET.length; index += 1) {
    digits[BASE64_ALPHABET.charCodeAt(index)] = index;
  }
  return digits;
})();

export function encodeBase64(bytes: Uint8Array): string {
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    out += BASE64_ALPHABET[first >> 2];
    out += BASE64_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
    out += second === undefined ? '=' : BASE64_ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >> 6)];
    out += third === undefined ? '=' : BASE64_ALPHABET[third & 0x3f];
  }
  return out;
}

function decodeBase64Body(value: string): Uint8Array | null {
  const paddingAt = value.indexOf('=');
  const body = paddingAt === -1 ? value : value.slice(0, paddingAt);
  const out = new Uint8Array(Math.floor((body.length * 6) / 8));
  let accumulator = 0;
  let bits = 0;
  let written = 0;
  for (let index = 0; index < body.length; index += 1) {
    const code = body.charCodeAt(index);
    const digit = code < 128 ? BASE64_DIGITS[code] : -1;
    if (digit < 0) {
      return null;
    }
    accumulator = (accumulator << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[written] = (accumulator >> bits) & 0xff;
      written += 1;
    }
  }
  return out;
}

/**
 * Decode, or return null. Accepts one spelling only: decoding and re-encoding
 * must land on the same string, which is what rejects the URL-safe alphabet,
 * missing padding, and non-zero trailing bits in one check.
 */
export function decodeBase64(value: string): Uint8Array | null {
  if (typeof value !== 'string') {
    return null;
  }
  if (value.length % 4 !== 0) {
    return null;
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    return null;
  }
  const bytes = decodeBase64Body(value);
  if (bytes === null) {
    return null;
  }
  return encodeBase64(bytes) === value ? bytes : null;
}

// ── canonical timestamps ─────────────────────────────────────────────────

const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * One spelling for one instant.
 *
 * Timestamps are signed, so `2026-01-01T00:00:00.000Z` and
 * `2026-01-01T02:00:00.000+02:00` are different signed values even though they
 * name the same moment. The wire takes the first form only. That is a deliberate
 * choice: the alternative is two records that a human reads as identical and a
 * signature that says otherwise.
 */
export function isCanonicalTimestamp(value: string): boolean {
  if (typeof value !== 'string' || !CANONICAL_TIMESTAMP.test(value)) {
    return false;
  }
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

// ── shared wire pieces ───────────────────────────────────────────────────

const idSchema = z.string().min(1).max(PROTOCOL_MAX_ID_LENGTH);
const counterSchema = z.number().int().min(PROTOCOL_MIN_COUNTER).max(PROTOCOL_MAX_COUNTER);
const timestampSchema = z
  .string()
  .refine(isCanonicalTimestamp, 'must be a canonical ISO-8601 UTC timestamp ending in Z');

/** A base64 byte string of exactly one length. */
function bytesSchema(length: number, label: string) {
  return z.string().refine((value) => {
    const bytes = decodeBase64(value);
    return bytes !== null && bytes.length === length;
  }, `${label} must be canonical base64 of exactly ${length} bytes`);
}

export const wireDeviceAuthoriserSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('self') }).strict(),
  z.object({ kind: z.literal('recovery') }).strict(),
  z.object({ kind: z.literal('device'), deviceId: idSchema }).strict(),
]);

export const wireDeviceRevokerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('recovery') }).strict(),
  z.object({ kind: z.literal('device'), deviceId: idSchema }).strict(),
]);

// ── the records ──────────────────────────────────────────────────────────

export const wireDeviceRecordSchema = z
  .object({
    deviceId: idSchema,
    spaceId: idSchema,
    signingPublicKey: bytesSchema(ED25519_PUBLIC_KEY_BYTES, 'signingPublicKey'),
    agreementPublicKey: bytesSchema(X25519_PUBLIC_KEY_BYTES, 'agreementPublicKey'),
    authorisedBy: wireDeviceAuthoriserSchema,
    revision: counterSchema,
    createdAt: timestampSchema,
    authorisation: bytesSchema(ED25519_SIGNATURE_BYTES, 'authorisation'),
  })
  .strict();

export const wireSpaceTrustAnchorSchema = z
  .object({
    spaceId: idSchema,
    rootDeviceId: idSchema,
    rootSigningPublicKey: bytesSchema(ED25519_PUBLIC_KEY_BYTES, 'rootSigningPublicKey'),
    recoverySigningPublicKey: bytesSchema(ED25519_PUBLIC_KEY_BYTES, 'recoverySigningPublicKey'),
    createdAt: timestampSchema,
    signature: bytesSchema(ED25519_SIGNATURE_BYTES, 'signature'),
  })
  .strict();

export const wireDeviceTombstoneSchema = z
  .object({
    spaceId: idSchema,
    targetDeviceId: idSchema,
    revision: counterSchema,
    revokedBy: wireDeviceRevokerSchema,
    revokedAt: timestampSchema,
    signature: bytesSchema(ED25519_SIGNATURE_BYTES, 'signature'),
  })
  .strict();

export const wireSpaceKeyEnvelopeSchema = z
  .object({
    spaceId: idSchema,
    generation: counterSchema,
    recipientDeviceId: idSchema,
    authoriserDeviceId: idSchema,
    recipientRevision: counterSchema,
    nonce: bytesSchema(AES_GCM_NONCE_BYTES, 'nonce'),
    ciphertext: bytesSchema(WRAPPED_KEY_BYTES, 'ciphertext'),
  })
  .strict();

export const wireRecoveryEnvelopeSchema = z
  .object({
    spaceId: idSchema,
    generation: counterSchema,
    nonce: bytesSchema(AES_GCM_NONCE_BYTES, 'nonce'),
    ciphertext: bytesSchema(WRAPPED_KEY_BYTES, 'ciphertext'),
  })
  .strict();

export const wireMediaManifestSchema = z
  .object({
    mediaId: idSchema,
    spaceId: idSchema,
    generation: counterSchema,
    revision: counterSchema,
    wrappedKey: z
      .object({
        nonce: bytesSchema(AES_GCM_NONCE_BYTES, 'wrappedKey.nonce'),
        ciphertext: bytesSchema(WRAPPED_KEY_BYTES, 'wrappedKey.ciphertext'),
      })
      .strict(),
    sealedNonce: bytesSchema(AES_GCM_NONCE_BYTES, 'sealedNonce'),
    byteLength: z.number().int().min(1).max(PROTOCOL_MAX_MEDIA_BYTES),
    mimeType: z.string().min(1).max(PROTOCOL_MAX_MIME_TYPE_LENGTH),
    width: z.number().int().min(1).max(100_000).nullish(),
    height: z.number().int().min(1).max(100_000).nullish(),
    personTag: z.enum(PROTOCOL_PERSON_TAGS).nullish(),
    uploaderDeviceId: idSchema,
    createdAt: timestampSchema,
    signature: bytesSchema(ED25519_SIGNATURE_BYTES, 'signature'),
  })
  .strict();

export const wireMediaTombstoneSchema = z
  .object({
    spaceId: idSchema,
    mediaId: idSchema,
    revision: counterSchema,
    deletedAt: timestampSchema,
    deletedByDeviceId: idSchema,
    signature: bytesSchema(ED25519_SIGNATURE_BYTES, 'signature'),
  })
  .strict();

export type WireDeviceRecord = z.infer<typeof wireDeviceRecordSchema>;
export type WireSpaceTrustAnchor = z.infer<typeof wireSpaceTrustAnchorSchema>;
export type WireDeviceTombstone = z.infer<typeof wireDeviceTombstoneSchema>;
export type WireSpaceKeyEnvelope = z.infer<typeof wireSpaceKeyEnvelopeSchema>;
export type WireRecoveryEnvelope = z.infer<typeof wireRecoveryEnvelopeSchema>;
export type WireMediaManifest = z.infer<typeof wireMediaManifestSchema>;
export type WireMediaTombstone = z.infer<typeof wireMediaTombstoneSchema>;

// ── the boundary ─────────────────────────────────────────────────────────

/** The schema has already checked this; the throw is the boundary's assertion. */
function bytes(value: string): Uint8Array {
  const decoded = decodeBase64(value);
  if (decoded === null) {
    throw new Error('value is not canonical base64');
  }
  return decoded;
}

export function parseWireDeviceRecord(input: unknown): DeviceRecord {
  const wire = wireDeviceRecordSchema.parse(input);
  return {
    deviceId: wire.deviceId,
    spaceId: wire.spaceId,
    signingPublicKey: bytes(wire.signingPublicKey),
    agreementPublicKey: bytes(wire.agreementPublicKey),
    authorisedBy: wire.authorisedBy,
    revision: wire.revision,
    createdAt: wire.createdAt,
    authorisation: bytes(wire.authorisation),
  };
}

export function toWireDeviceRecord(record: DeviceRecord): WireDeviceRecord {
  // Validated on the way out as well as on the way in. A serializer that only
  // encodes would happily return something typed as wire form that the schema
  // would reject, and the crypto slice constructs these objects rather than
  // receiving them from a parser.
  return wireDeviceRecordSchema.parse({
    deviceId: record.deviceId,
    spaceId: record.spaceId,
    signingPublicKey: encodeBase64(record.signingPublicKey),
    agreementPublicKey: encodeBase64(record.agreementPublicKey),
    authorisedBy: record.authorisedBy,
    revision: record.revision,
    createdAt: record.createdAt,
    authorisation: encodeBase64(record.authorisation),
  });
}

export function parseWireSpaceTrustAnchor(input: unknown): SpaceTrustAnchor {
  const wire = wireSpaceTrustAnchorSchema.parse(input);
  return {
    spaceId: wire.spaceId,
    rootDeviceId: wire.rootDeviceId,
    rootSigningPublicKey: bytes(wire.rootSigningPublicKey),
    recoverySigningPublicKey: bytes(wire.recoverySigningPublicKey),
    createdAt: wire.createdAt,
    signature: bytes(wire.signature),
  };
}

export function toWireSpaceTrustAnchor(anchor: SpaceTrustAnchor): WireSpaceTrustAnchor {
  return wireSpaceTrustAnchorSchema.parse({
    spaceId: anchor.spaceId,
    rootDeviceId: anchor.rootDeviceId,
    rootSigningPublicKey: encodeBase64(anchor.rootSigningPublicKey),
    recoverySigningPublicKey: encodeBase64(anchor.recoverySigningPublicKey),
    createdAt: anchor.createdAt,
    signature: encodeBase64(anchor.signature),
  });
}

export function parseWireDeviceTombstone(input: unknown): DeviceTombstone {
  const wire = wireDeviceTombstoneSchema.parse(input);
  return {
    spaceId: wire.spaceId,
    targetDeviceId: wire.targetDeviceId,
    revision: wire.revision,
    revokedBy: wire.revokedBy,
    revokedAt: wire.revokedAt,
    signature: bytes(wire.signature),
  };
}

export function toWireDeviceTombstone(tombstone: DeviceTombstone): WireDeviceTombstone {
  return wireDeviceTombstoneSchema.parse({
    spaceId: tombstone.spaceId,
    targetDeviceId: tombstone.targetDeviceId,
    revision: tombstone.revision,
    revokedBy: tombstone.revokedBy,
    revokedAt: tombstone.revokedAt,
    signature: encodeBase64(tombstone.signature),
  });
}

export function parseWireSpaceKeyEnvelope(input: unknown): SpaceKeyEnvelope {
  const wire = wireSpaceKeyEnvelopeSchema.parse(input);
  return {
    spaceId: wire.spaceId,
    generation: wire.generation,
    recipientDeviceId: wire.recipientDeviceId,
    authoriserDeviceId: wire.authoriserDeviceId,
    recipientRevision: wire.recipientRevision,
    nonce: bytes(wire.nonce),
    ciphertext: bytes(wire.ciphertext),
  };
}

export function toWireSpaceKeyEnvelope(envelope: SpaceKeyEnvelope): WireSpaceKeyEnvelope {
  return wireSpaceKeyEnvelopeSchema.parse({
    spaceId: envelope.spaceId,
    generation: envelope.generation,
    recipientDeviceId: envelope.recipientDeviceId,
    authoriserDeviceId: envelope.authoriserDeviceId,
    recipientRevision: envelope.recipientRevision,
    nonce: encodeBase64(envelope.nonce),
    ciphertext: encodeBase64(envelope.ciphertext),
  });
}

export function parseWireRecoveryEnvelope(input: unknown): RecoveryEnvelope {
  const wire = wireRecoveryEnvelopeSchema.parse(input);
  return {
    spaceId: wire.spaceId,
    generation: wire.generation,
    nonce: bytes(wire.nonce),
    ciphertext: bytes(wire.ciphertext),
  };
}

export function toWireRecoveryEnvelope(envelope: RecoveryEnvelope): WireRecoveryEnvelope {
  return wireRecoveryEnvelopeSchema.parse({
    spaceId: envelope.spaceId,
    generation: envelope.generation,
    nonce: encodeBase64(envelope.nonce),
    ciphertext: encodeBase64(envelope.ciphertext),
  });
}

export function parseWireMediaManifest(input: unknown): MediaManifest {
  const wire = wireMediaManifestSchema.parse(input);
  return {
    mediaId: wire.mediaId,
    spaceId: wire.spaceId,
    generation: wire.generation,
    revision: wire.revision,
    wrappedKey: {
      nonce: bytes(wire.wrappedKey.nonce),
      ciphertext: bytes(wire.wrappedKey.ciphertext),
    },
    sealedNonce: bytes(wire.sealedNonce),
    byteLength: wire.byteLength,
    mimeType: wire.mimeType,
    width: wire.width ?? null,
    height: wire.height ?? null,
    personTag: wire.personTag ?? null,
    uploaderDeviceId: wire.uploaderDeviceId,
    createdAt: wire.createdAt,
    signature: bytes(wire.signature),
  };
}

export function toWireMediaManifest(manifest: MediaManifest): WireMediaManifest {
  return wireMediaManifestSchema.parse({
    mediaId: manifest.mediaId,
    spaceId: manifest.spaceId,
    generation: manifest.generation,
    revision: manifest.revision,
    wrappedKey: {
      nonce: encodeBase64(manifest.wrappedKey.nonce),
      ciphertext: encodeBase64(manifest.wrappedKey.ciphertext),
    },
    sealedNonce: encodeBase64(manifest.sealedNonce),
    byteLength: manifest.byteLength,
    mimeType: manifest.mimeType,
    width: manifest.width ?? null,
    height: manifest.height ?? null,
    personTag: manifest.personTag ?? null,
    uploaderDeviceId: manifest.uploaderDeviceId,
    createdAt: manifest.createdAt,
    signature: encodeBase64(manifest.signature),
  });
}

export function parseWireMediaTombstone(input: unknown): MediaTombstone {
  const wire = wireMediaTombstoneSchema.parse(input);
  return {
    spaceId: wire.spaceId,
    mediaId: wire.mediaId,
    revision: wire.revision,
    deletedAt: wire.deletedAt,
    deletedByDeviceId: wire.deletedByDeviceId,
    signature: bytes(wire.signature),
  };
}

export function toWireMediaTombstone(tombstone: MediaTombstone): WireMediaTombstone {
  return wireMediaTombstoneSchema.parse({
    spaceId: tombstone.spaceId,
    mediaId: tombstone.mediaId,
    revision: tombstone.revision,
    deletedAt: tombstone.deletedAt,
    deletedByDeviceId: tombstone.deletedByDeviceId,
    signature: encodeBase64(tombstone.signature),
  });
}
