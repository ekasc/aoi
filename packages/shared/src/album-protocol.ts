/**
 * Canonical protocol encoding.
 *
 * Every signature, HKDF context, and AEAD AAD in the album protocol is a byte
 * string, and two implementations that build different bytes from the same
 * inputs will disagree about what was signed. The encoding is therefore part of
 * the wire contract rather than an implementation detail, and it lives in one
 * place.
 *
 * The rules, from `docs/shape/album-protocol.md`:
 *
 *   - a format version byte leads every structure
 *   - fields are written in the order the structure declares them
 *   - a string is a uint32 big-endian length, then its UTF-8 bytes
 *   - an integer is uint64 big-endian
 *   - a byte string is a uint32 big-endian length, then the bytes
 *   - an optional field is a presence byte, then the field when present
 *   - a list is a uint32 big-endian count, then each element
 *   - a label is itself a length-prefixed string
 *
 * There is deliberately no generic object serializer. Field order is a
 * cryptographic property here, so every structure gets its own encoder and
 * object property order can never decide the bytes.
 *
 * Key material is written as a byte string, not as the base64 text the wire
 * uses. Base64 has padding and alphabet variants, and two clients that spell
 * the same key differently would sign different bytes.
 */

export const PROTOCOL_FORMAT_VERSION = 0x01;

/**
 * The largest integer this encoder writes.
 *
 * Every integer in the protocol is a counter, a revision, or a byte length, all
 * of which live far below this. `bigint` is a deliberate omission: it would
 * widen every call site to buy a range nothing needs yet, and it can be added
 * the day a real 64-bit value appears. Until then an unsafe integer is refused
 * rather than silently truncated.
 */
export const UINT64_MAX_SAFE = Number.MAX_SAFE_INTEGER;

const UINT32_MAX = 0xffff_ffff;
const UINT64_LOW_WORD = 0x1_0000_0000;

export const ENVELOPE_LABEL = 'aoi/envelope/v1';
export const RECOVERY_WRAP_LABEL = 'aoi/recovery-wrap/v1';
export const RECOVERY_SIGNING_LABEL = 'aoi/recovery-signing/v1';
export const RECOVERY_ENVELOPE_LABEL = 'aoi/recovery-envelope/v1';
export const MEDIA_LABEL = 'aoi/media/v1';
export const DEVICE_RECORD_LABEL = 'aoi/device-record/v1';
export const DEVICE_TOMBSTONE_LABEL = 'aoi/device-tombstone/v1';
export const MEDIA_MANIFEST_LABEL = 'aoi/media-manifest/v1';
export const MEDIA_TOMBSTONE_LABEL = 'aoi/media-tombstone/v1';

const ABSENT = 0x00;
const PRESENT = 0x01;

// Tagged-union discriminators. The two unions are separate namespaces, so they
// number independently.
const AUTHORISER_SELF = 0x01;
const AUTHORISER_RECOVERY = 0x02;
const AUTHORISER_DEVICE = 0x03;
const REVOKER_RECOVERY = 0x01;
const REVOKER_DEVICE = 0x02;

/**
 * Who vouched for a device record.
 *
 * This is a tagged union rather than a string on purpose. As a string, `'self'`
 * and `'recovery'` shared a namespace with arbitrary device ids, so a device
 * whose id happened to be `'recovery'` would have been indistinguishable from
 * the recovery root. The tag is structural now, and the device id only exists
 * in the variant that has one.
 */
export type DeviceAuthoriser =
  | { kind: 'self' }
  | { kind: 'recovery' }
  | { kind: 'device'; deviceId: string };

/** Who signed a device tombstone. A device cannot revoke itself. */
export type DeviceRevoker =
  | { kind: 'recovery' }
  | { kind: 'device'; deviceId: string };

function writeAuthoriser(writer: ProtocolWriter, authoriser: DeviceAuthoriser): void {
  switch (authoriser.kind) {
    case 'self':
      writer.byte(AUTHORISER_SELF);
      return;
    case 'recovery':
      writer.byte(AUTHORISER_RECOVERY);
      return;
    case 'device':
      writer.byte(AUTHORISER_DEVICE).string(authoriser.deviceId);
      return;
  }
}

function writeRevoker(writer: ProtocolWriter, revoker: DeviceRevoker): void {
  switch (revoker.kind) {
    case 'recovery':
      writer.byte(REVOKER_RECOVERY);
      return;
    case 'device':
      writer.byte(REVOKER_DEVICE).string(revoker.deviceId);
      return;
  }
}

function append(target: number[], source: Uint8Array): void {
  for (let index = 0; index < source.length; index += 1) {
    target.push(source[index]);
  }
}

function assertUint(value: number, max: number, name: string): void {
  if (typeof value !== 'number') {
    throw new TypeError(`${name} must be a number, received ${typeof value}`);
  }
  if (!Number.isInteger(value)) {
    throw new RangeError(`${name} must be an integer, received ${value}`);
  }
  if (value < 0 || value > max) {
    throw new RangeError(`${name} must be between 0 and ${max}, received ${value}`);
  }
}

/**
 * The primitive writers. A structure encoder composes these in a fixed order;
 * nothing else writes bytes.
 */
export class ProtocolWriter {
  private readonly out: number[] = [];

  version(): this {
    return this.byte(PROTOCOL_FORMAT_VERSION);
  }

  /**
   * A single byte. The format version and every tagged-union discriminator use
   * this, so a variant is one byte on the wire rather than a string that could
   * collide with data.
   */
  byte(value: number): this {
    assertUint(value, 0xff, 'byte');
    this.out.push(value);
    return this;
  }

  uint32(value: number): this {
    assertUint(value, UINT32_MAX, 'uint32');
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, false);
    append(this.out, bytes);
    return this;
  }

  uint64(value: number): this {
    assertUint(value, UINT64_MAX_SAFE, 'uint64');
    const high = Math.floor(value / UINT64_LOW_WORD);
    const low = value % UINT64_LOW_WORD;
    const bytes = new Uint8Array(8);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, high, false);
    view.setUint32(4, low, false);
    append(this.out, bytes);
    return this;
  }

  string(value: string): this {
    if (typeof value !== 'string') {
      throw new TypeError(`string field must be a string, received ${typeof value}`);
    }
    const bytes = new TextEncoder().encode(value);
    this.uint32(bytes.length);
    append(this.out, bytes);
    return this;
  }

  bytes(value: Uint8Array): this {
    if (!(value instanceof Uint8Array)) {
      throw new TypeError('byte field must be a Uint8Array');
    }
    this.uint32(value.length);
    append(this.out, value);
    return this;
  }

  /** A presence byte, then the field only when it is present. */
  optional<T>(
    value: T | null | undefined,
    write: (writer: ProtocolWriter, present: T) => void
  ): this {
    if (value === null || value === undefined) {
      this.out.push(ABSENT);
      return this;
    }
    this.out.push(PRESENT);
    write(this, value);
    return this;
  }

  list<T>(values: readonly T[], write: (writer: ProtocolWriter, element: T) => void): this {
    if (!Array.isArray(values)) {
      throw new TypeError('list field must be an array');
    }
    this.uint32(values.length);
    for (const value of values) {
      write(this, value);
    }
    return this;
  }

  toBytes(): Uint8Array {
    return Uint8Array.from(this.out);
  }
}

// ── contexts ─────────────────────────────────────────────────────────────
//
// A context is what the derivation and the authentication both bind, so it is
// built once and used as both the HKDF info and the AEAD aad.

export type EnvelopeContext = {
  spaceId: string;
  generation: number;
  recipientDeviceId: string;
  authoriserDeviceId: string;
  recipientRevision: number;
};

export function encodeEnvelopeContext(input: EnvelopeContext): Uint8Array {
  return new ProtocolWriter()
    .version()
    .string(ENVELOPE_LABEL)
    .string(input.spaceId)
    .uint64(input.generation)
    .string(input.recipientDeviceId)
    .string(input.authoriserDeviceId)
    .uint64(input.recipientRevision)
    .toBytes();
}

/**
 * The recovery derivations have no fields beyond their label. The entropy is
 * already unique to one Space, so there is nothing else to bind.
 */
export function encodeRecoveryWrapContext(): Uint8Array {
  return new ProtocolWriter().version().string(RECOVERY_WRAP_LABEL).toBytes();
}

export function encodeRecoverySigningContext(): Uint8Array {
  return new ProtocolWriter().version().string(RECOVERY_SIGNING_LABEL).toBytes();
}

export type RecoveryEnvelopeContext = {
  spaceId: string;
  generation: number;
};

export function encodeRecoveryEnvelopeContext(input: RecoveryEnvelopeContext): Uint8Array {
  return new ProtocolWriter()
    .version()
    .string(RECOVERY_ENVELOPE_LABEL)
    .string(input.spaceId)
    .uint64(input.generation)
    .toBytes();
}

export type MediaContext = {
  mediaId: string;
  generation: number;
};

export function encodeMediaContext(input: MediaContext): Uint8Array {
  return new ProtocolWriter()
    .version()
    .string(MEDIA_LABEL)
    .string(input.mediaId)
    .uint64(input.generation)
    .toBytes();
}

// ── signed structures ────────────────────────────────────────────────────
//
// Each of these produces the bytes a signature covers. The signature field
// itself is never part of them: a signature cannot cover itself.

export type DeviceRecordInput = {
  deviceId: string;
  spaceId: string;
  signingPublicKey: Uint8Array;
  agreementPublicKey: Uint8Array;
  authorisedBy: DeviceAuthoriser;
  revision: number;
  createdAt: string;
};

/** A device record as it exists, including the signature over the bytes above. */
export type DeviceRecord = DeviceRecordInput & {
  authorisation: Uint8Array;
};

export function encodeDeviceRecord(input: DeviceRecordInput): Uint8Array {
  const writer = new ProtocolWriter()
    .version()
    .string(DEVICE_RECORD_LABEL)
    .string(input.deviceId)
    .string(input.spaceId)
    .bytes(input.signingPublicKey)
    .bytes(input.agreementPublicKey);
  writeAuthoriser(writer, input.authorisedBy);
  return writer.uint64(input.revision).string(input.createdAt).toBytes();
}

export type DeviceTombstoneInput = {
  spaceId: string;
  targetDeviceId: string;
  revision: number;
  revokedBy: DeviceRevoker;
  revokedAt: string;
};

/** A device tombstone as it exists, including its signature. */
export type DeviceTombstone = DeviceTombstoneInput & {
  signature: Uint8Array;
};

export function encodeDeviceTombstone(input: DeviceTombstoneInput): Uint8Array {
  const writer = new ProtocolWriter()
    .version()
    .string(DEVICE_TOMBSTONE_LABEL)
    .string(input.spaceId)
    .string(input.targetDeviceId)
    .uint64(input.revision);
  writeRevoker(writer, input.revokedBy);
  return writer.string(input.revokedAt).toBytes();
}

/** A sealed key, as the two byte strings it is. */
export type SealedBytes = {
  nonce: Uint8Array;
  ciphertext: Uint8Array;
};

export type MediaManifestInput = {
  mediaId: string;
  spaceId: string;
  generation: number;
  revision: number;
  wrappedKey: SealedBytes;
  sealedNonce: Uint8Array;
  byteLength: number;
  mimeType: string;
  width?: number | null;
  height?: number | null;
  personTag?: ProtocolPersonTag | null;
  uploaderDeviceId: string;
  createdAt: string;
};

/** A media manifest as it exists, including the uploader's signature. */
export type MediaManifest = MediaManifestInput & {
  signature: Uint8Array;
};

export function encodeMediaManifest(input: MediaManifestInput): Uint8Array {
  return new ProtocolWriter()
    .version()
    .string(MEDIA_MANIFEST_LABEL)
    .string(input.mediaId)
    .string(input.spaceId)
    .uint64(input.generation)
    .uint64(input.revision)
    .bytes(input.wrappedKey.nonce)
    .bytes(input.wrappedKey.ciphertext)
    .bytes(input.sealedNonce)
    .uint64(input.byteLength)
    .string(input.mimeType)
    .optional(input.width ?? null, (writer, value) => writer.uint64(value))
    .optional(input.height ?? null, (writer, value) => writer.uint64(value))
    .optional(input.personTag ?? null, (writer, value) => writer.string(value))
    .string(input.uploaderDeviceId)
    .string(input.createdAt)
    .toBytes();
}

export type MediaTombstoneInput = {
  spaceId: string;
  mediaId: string;
  revision: number;
  deletedAt: string;
  deletedByDeviceId: string;
};

/** A media tombstone as it exists, including its signature. */
export type MediaTombstone = MediaTombstoneInput & {
  signature: Uint8Array;
};

export function encodeMediaTombstone(input: MediaTombstoneInput): Uint8Array {
  return new ProtocolWriter()
    .version()
    .string(MEDIA_TOMBSTONE_LABEL)
    .string(input.spaceId)
    .string(input.mediaId)
    .uint64(input.revision)
    .string(input.deletedAt)
    .string(input.deletedByDeviceId)
    .toBytes();
}

// ── bounds ───────────────────────────────────────────────────────────────
//
// Every integer the protocol carries is a monotonic counter that moves once per
// event. 2^31 of anything is unreachable in a lifetime, and a ceiling well below
// the JSON-safe range keeps a malformed or hostile value from being stored at
// all. The byte ceiling matches the media contract the API already enforces.

export const PROTOCOL_MIN_COUNTER = 1;
export const PROTOCOL_MAX_COUNTER = 2 ** 31 - 1;
export const PROTOCOL_MAX_ID_LENGTH = 128;
export const PROTOCOL_MAX_MIME_TYPE_LENGTH = 255;
export const PROTOCOL_MAX_MEDIA_BYTES = 100 * 1024 * 1024;

export const ED25519_PUBLIC_KEY_BYTES = 32;
export const X25519_PUBLIC_KEY_BYTES = 32;
export const ED25519_SIGNATURE_BYTES = 64;
export const AES_GCM_NONCE_BYTES = 12;
export const AES_GCM_TAG_BYTES = 16;
export const SPACE_KEY_BYTES = 32;
export const MEDIA_KEY_BYTES = 32;
/** A wrapped key is the key plus the GCM tag the seal appends. */
export const WRAPPED_KEY_BYTES = SPACE_KEY_BYTES + AES_GCM_TAG_BYTES;

export const PROTOCOL_PERSON_TAGS = ['you', 'partner'] as const;
export type ProtocolPersonTag = (typeof PROTOCOL_PERSON_TAGS)[number];

// ── envelopes ────────────────────────────────────────────────────────────
//
// Neither envelope is signed. They are sealed, and their integrity comes from
// the AEAD and from the context that is both their KDF input and their AAD.

export type SpaceKeyEnvelope = {
  spaceId: string;
  generation: number;
  recipientDeviceId: string;
  authoriserDeviceId: string;
  recipientRevision: number;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
};

export type RecoveryEnvelope = {
  spaceId: string;
  generation: number;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
};
