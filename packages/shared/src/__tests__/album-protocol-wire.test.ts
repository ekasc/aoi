import { describe, expect, it } from 'vitest';

import {
  ED25519_PUBLIC_KEY_BYTES,
  PROTOCOL_MAX_COUNTER,
  WRAPPED_KEY_BYTES,
  encodeDeviceRecord,
  encodeDeviceTombstone,
  type DeviceRecord,
  type MediaManifest,
} from '../album-protocol';
import {
  decodeBase64,
  encodeBase64,
  isCanonicalTimestamp,
  parseWireDeviceRecord,
  parseWireMediaManifest,
  toWireDeviceRecord,
  toWireMediaManifest,
  wireDeviceRecordSchema,
  wireDeviceTombstoneSchema,
  wireMediaManifestSchema,
} from '../album-protocol-wire';

const hex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

const bytesOf = (length: number, fill = 0) => new Uint8Array(length).fill(fill);

const canonicalRecord = (overrides: Record<string, unknown> = {}) => ({
  deviceId: 'device-a',
  spaceId: 'space-1',
  signingPublicKey: encodeBase64(bytesOf(ED25519_PUBLIC_KEY_BYTES, 1)),
  agreementPublicKey: encodeBase64(bytesOf(ED25519_PUBLIC_KEY_BYTES, 2)),
  authorisedBy: { kind: 'self' },
  revision: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  authorisation: encodeBase64(bytesOf(64, 3)),
  ...overrides,
});

/**
 * The collision this tagged union exists to remove. As plain strings, `'self'`
 * and `'recovery'` shared a namespace with device ids, so a device whose id was
 * `'recovery'` could not be told apart from the recovery root.
 */
describe('authority is tagged, not a sentinel string', () => {
  const record = (authorisedBy: DeviceRecord['authorisedBy']) =>
    encodeDeviceRecord({
      deviceId: 'device-a',
      spaceId: 'space-1',
      signingPublicKey: new Uint8Array(0),
      agreementPublicKey: new Uint8Array(0),
      authorisedBy,
      revision: 1,
      createdAt: 't',
    });

  it('writes a discriminator byte per variant', () => {
    const self = record({ kind: 'self' });
    const recovery = record({ kind: 'recovery' });
    const device = record({ kind: 'device', deviceId: 'device-b' });

    // The authoriser sits directly after the two key fields, before the
    // revision and the timestamp.
    expect(hex(self).endsWith('0100000000000000010000000174')).toBe(true);
    expect(hex(recovery).endsWith('0200000000000000010000000174')).toBe(true);
    expect(hex(device).endsWith('03000000086465766963652d6200000000000000010000000174')).toBe(true);
  });

  it('separates a device called "recovery" from the recovery root', () => {
    const asDevice = record({ kind: 'device', deviceId: 'recovery' });
    const asRoot = record({ kind: 'recovery' });
    expect(hex(asDevice)).not.toBe(hex(asRoot));
    expect(hex(asDevice)).toContain('03000000087265636f76657279');
    expect(hex(asRoot)).toContain('02000000');
  });

  it('tags the revoker the same way, with no self variant', () => {
    const revoke = (revokedBy: Parameters<typeof encodeDeviceTombstone>[0]['revokedBy']) =>
      encodeDeviceTombstone({
        spaceId: 'space-1',
        targetDeviceId: 'device-b',
        revision: 2,
        revokedBy,
        revokedAt: 't',
      });
    // The revoker sits after the revision, before the timestamp.
    expect(hex(revoke({ kind: 'recovery' })).endsWith('0000000000000002010000000174')).toBe(true);
    expect(
      hex(revoke({ kind: 'device', deviceId: 'device-a' })).endsWith(
        '000000000000000202000000086465766963652d610000000174'
      )
    ).toBe(true);
  });
});

describe('canonical base64', () => {
  it('round-trips bytes', () => {
    for (const bytes of [bytesOf(0), bytesOf(1, 255), bytesOf(2, 1), bytesOf(3, 7), bytesOf(32, 9), bytesOf(48, 4)]) {
      expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes);
    }
  });

  it('spells a value one way only', () => {
    expect(encodeBase64(new Uint8Array([255]))).toBe('/w==');
    expect(encodeBase64(new Uint8Array([0, 0, 0]))).toBe('AAAA');
    expect(encodeBase64(new Uint8Array(0))).toBe('');
  });

  it('refuses non-zero trailing bits', () => {
    // '/x==' decodes to the same byte as '/w==' but is not the canonical spelling.
    expect(decodeBase64('/w==')).toEqual(new Uint8Array([255]));
    expect(decodeBase64('/x==')).toBeNull();
  });

  it('refuses the URL-safe alphabet', () => {
    expect(decodeBase64('__8=')).toBeNull();
    expect(decodeBase64('-_8=')).toBeNull();
  });

  it('refuses missing or misplaced padding', () => {
    expect(decodeBase64('AAAAA')).toBeNull();
    expect(decodeBase64('AA')).toBeNull();
    expect(decodeBase64('A===')).toBeNull();
    expect(decodeBase64('=AAA')).toBeNull();
  });

  it('refuses whitespace and any other character', () => {
    expect(decodeBase64('AA A')).toBeNull();
    expect(decodeBase64('AA\nA')).toBeNull();
    expect(decodeBase64('AA*A')).toBeNull();
  });
});

describe('canonical timestamps', () => {
  it('accepts the one spelling', () => {
    expect(isCanonicalTimestamp('2026-01-01T00:00:00.000Z')).toBe(true);
    expect(isCanonicalTimestamp('2026-12-31T23:59:59.999Z')).toBe(true);
  });

  it('refuses another spelling of the same instant', () => {
    expect(isCanonicalTimestamp('2026-01-01T02:00:00.000+02:00')).toBe(false);
    expect(isCanonicalTimestamp('2026-01-01T00:00:00Z')).toBe(false);
    expect(isCanonicalTimestamp('2026-01-01T00:00:00.000z')).toBe(false);
    expect(isCanonicalTimestamp('2026-01-01')).toBe(false);
  });

  it('refuses a date that does not exist', () => {
    expect(isCanonicalTimestamp('2026-13-01T00:00:00.000Z')).toBe(false);
    expect(isCanonicalTimestamp('2026-02-30T00:00:00.000Z')).toBe(false);
  });
});

describe('the wire schemas', () => {
  it('accepts a canonical record', () => {
    expect(wireDeviceRecordSchema.safeParse(canonicalRecord()).success).toBe(true);
  });

  it('refuses a key of the wrong decoded length', () => {
    const short = canonicalRecord({ signingPublicKey: encodeBase64(bytesOf(31, 1)) });
    expect(wireDeviceRecordSchema.safeParse(short).success).toBe(false);
  });

  it('refuses a non-canonical base64 spelling', () => {
    const offSpelling = canonicalRecord({ authorisation: '/x==' });
    expect(wireDeviceRecordSchema.safeParse(offSpelling).success).toBe(false);
  });

  it('refuses a signature of the wrong length', () => {
    const short = canonicalRecord({ authorisation: encodeBase64(bytesOf(63, 3)) });
    expect(wireDeviceRecordSchema.safeParse(short).success).toBe(false);
  });

  it('refuses an unknown field rather than dropping it', () => {
    const extra = canonicalRecord({ surprise: 'value' });
    expect(wireDeviceRecordSchema.safeParse(extra).success).toBe(false);
  });

  it('bounds the counters', () => {
    expect(wireDeviceRecordSchema.safeParse(canonicalRecord({ revision: 0 })).success).toBe(false);
    expect(wireDeviceRecordSchema.safeParse(canonicalRecord({ revision: 1 })).success).toBe(true);
    expect(wireDeviceRecordSchema.safeParse(canonicalRecord({ revision: PROTOCOL_MAX_COUNTER })).success).toBe(true);
    expect(wireDeviceRecordSchema.safeParse(canonicalRecord({ revision: PROTOCOL_MAX_COUNTER + 1 })).success).toBe(false);
  });

  it('requires a canonical timestamp', () => {
    const offset = canonicalRecord({ createdAt: '2026-01-01T02:00:00.000+02:00' });
    expect(wireDeviceRecordSchema.safeParse(offset).success).toBe(false);
  });

  it('bounds the wrapped key length', () => {
    const manifest = {
      mediaId: 'm-1',
      spaceId: 'space-1',
      generation: 1,
      revision: 1,
      wrappedKey: {
        nonce: encodeBase64(bytesOf(12, 3)),
        ciphertext: encodeBase64(bytesOf(WRAPPED_KEY_BYTES, 4)),
      },
      sealedNonce: encodeBase64(bytesOf(12, 5)),
      byteLength: 1024,
      mimeType: 'image/jpeg',
      width: 640,
      height: 480,
      personTag: 'you',
      uploaderDeviceId: 'device-a',
      createdAt: '2026-01-01T00:00:00.000Z',
      signature: encodeBase64(bytesOf(64, 6)),
    };
    expect(wireMediaManifestSchema.safeParse(manifest).success).toBe(true);
    const short = { ...manifest, wrappedKey: { ...manifest.wrappedKey, ciphertext: encodeBase64(bytesOf(47, 4)) } };
    expect(wireMediaManifestSchema.safeParse(short).success).toBe(false);
  });

  it('requires a spaceId on a tombstone', () => {
    // Without it the signature says nothing about which Space the revocation
    // belongs to, and the protocol would be relying on id uniqueness and
    // server-side scoping, which an untrusted server does not provide.
    const tombstone = {
      targetDeviceId: 'device-b',
      revision: 2,
      revokedBy: { kind: 'device', deviceId: 'device-a' },
      revokedAt: '2026-02-01T00:00:00.000Z',
      signature: encodeBase64(bytesOf(64, 3)),
    };
    expect(wireDeviceTombstoneSchema.safeParse(tombstone).success).toBe(false);
    expect(wireDeviceTombstoneSchema.safeParse({ ...tombstone, spaceId: 'space-1' }).success).toBe(true);
  });

  it('accepts an omitted or null optional alike', () => {
    const base = {
      mediaId: 'm-1',
      spaceId: 'space-1',
      generation: 1,
      revision: 1,
      wrappedKey: {
        nonce: encodeBase64(bytesOf(12, 3)),
        ciphertext: encodeBase64(bytesOf(WRAPPED_KEY_BYTES, 4)),
      },
      sealedNonce: encodeBase64(bytesOf(12, 5)),
      byteLength: 1024,
      mimeType: 'image/jpeg',
      uploaderDeviceId: 'device-a',
      createdAt: '2026-01-01T00:00:00.000Z',
      signature: encodeBase64(bytesOf(64, 6)),
    };
    expect(wireMediaManifestSchema.safeParse(base).success).toBe(true);
    expect(wireMediaManifestSchema.safeParse({ ...base, width: null }).success).toBe(true);
    expect(wireMediaManifestSchema.safeParse({ ...base, width: 0 }).success).toBe(false);
  });
});

/**
 * The boundary decodes once. Nothing downstream sees a base64 string.
 */
describe('the wire to protocol boundary', () => {
  it('decodes a record into bytes and keeps the tagged authoriser', () => {
    const record = parseWireDeviceRecord(
      canonicalRecord({ authorisedBy: { kind: 'device', deviceId: 'recovery' } })
    );
    expect(record.signingPublicKey).toEqual(bytesOf(ED25519_PUBLIC_KEY_BYTES, 1));
    expect(record.authorisation).toEqual(bytesOf(64, 3));
    expect(record.authorisedBy).toEqual({ kind: 'device', deviceId: 'recovery' });
  });

  it('round-trips a record through the wire and back', () => {
    const record = parseWireDeviceRecord(canonicalRecord());
    expect(parseWireDeviceRecord(toWireDeviceRecord(record))).toEqual(record);
  });

  it('round-trips a manifest with optionals present and absent', () => {
    const present = parseWireMediaManifest({
      mediaId: 'm-1',
      spaceId: 'space-1',
      generation: 1,
      revision: 1,
      wrappedKey: { nonce: encodeBase64(bytesOf(12, 3)), ciphertext: encodeBase64(bytesOf(WRAPPED_KEY_BYTES, 4)) },
      sealedNonce: encodeBase64(bytesOf(12, 5)),
      byteLength: 1024,
      mimeType: 'image/jpeg',
      width: 640,
      height: 480,
      personTag: 'partner',
      uploaderDeviceId: 'device-a',
      createdAt: '2026-01-01T00:00:00.000Z',
      signature: encodeBase64(bytesOf(64, 6)),
    });
    expect(present.width).toBe(640);
    expect(present.personTag).toBe('partner');
    expect(parseWireMediaManifest(toWireMediaManifest(present))).toEqual(present);

    const absent: MediaManifest = { ...present, width: null, height: null, personTag: null };
    expect(parseWireMediaManifest(toWireMediaManifest(absent))).toEqual(absent);
  });
});

/**
 * The outbound direction validates as well. The crypto slice builds these
 * objects rather than receiving them from a parser, so a serializer that only
 * encoded would happily return something typed as wire form that the schema
 * would refuse.
 */
describe('the protocol to wire boundary validates too', () => {
  it('refuses to serialise a record the wire would reject', () => {
    expect(() =>
      toWireDeviceRecord({
        deviceId: 'device-a',
        spaceId: 'space-1',
        signingPublicKey: new Uint8Array(3),
        agreementPublicKey: bytesOf(ED25519_PUBLIC_KEY_BYTES, 2),
        authorisedBy: { kind: 'self' },
        revision: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        authorisation: bytesOf(64, 3),
      })
    ).toThrow();
  });

  it('refuses to serialise a timestamp the wire would reject', () => {
    const record = parseWireDeviceRecord(canonicalRecord());
    expect(() =>
      toWireDeviceRecord({ ...record, createdAt: '2026-01-01T02:00:00.000+02:00' })
    ).toThrow();
  });
});
