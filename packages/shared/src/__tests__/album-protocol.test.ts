import { describe, expect, it } from 'vitest';

import {
  PROTOCOL_FORMAT_VERSION,
  ProtocolWriter,
  UINT64_MAX_SAFE,
  encodeDeviceRecord,
  encodeDeviceTombstone,
  encodeEnvelopeContext,
  encodeMediaContext,
  encodeMediaManifest,
  encodeMediaTombstone,
  encodeRecoveryEnvelopeContext,
  encodeRecoverySigningContext,
  encodeRecoveryWrapContext,
} from '../album-protocol';

const hex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

/**
 * Golden vectors.
 *
 * These matter more than round-trip tests. A round trip proves that two copies
 * of the same wrong encoder agree with each other; a frozen vector proves the
 * wire format did not move. Every one of these was checked by hand against the
 * rules in the protocol document before it was written down: the version byte,
 * each length prefix, and the big-endian word order.
 */
describe('canonical protocol encoding', () => {
  it('leads every structure with the format version', () => {
    expect(PROTOCOL_FORMAT_VERSION).toBe(0x01);
    const everyStructure = [
      encodeEnvelopeContext({ spaceId: 's', generation: 0, recipientDeviceId: 'r', authoriserDeviceId: 'a', recipientRevision: 0 }),
      encodeRecoveryWrapContext(),
      encodeRecoverySigningContext(),
      encodeRecoveryEnvelopeContext({ spaceId: 's', generation: 0 }),
      encodeMediaContext({ mediaId: 'm', generation: 0 }),
      encodeDeviceRecord({ deviceId: 'd', spaceId: 's', signingPublicKey: new Uint8Array(0), agreementPublicKey: new Uint8Array(0), authorisedBy: 'self', revision: 0, createdAt: 't' }),
      encodeDeviceTombstone({ targetDeviceId: 'd', revision: 0, revokedByDeviceId: 'a', revokedAt: 't' }),
      encodeMediaManifest({ mediaId: 'm', spaceId: 's', generation: 0, revision: 0, wrappedKey: { nonce: new Uint8Array(0), ciphertext: new Uint8Array(0) }, sealedNonce: new Uint8Array(0), byteLength: 0, mimeType: 'x', uploaderDeviceId: 'd', createdAt: 't' }),
      encodeMediaTombstone({ mediaId: 'm', revision: 0, deletedAt: 't', deletedByDeviceId: 'd' }),
    ];
    for (const bytes of everyStructure) {
      expect(bytes[0]).toBe(PROTOCOL_FORMAT_VERSION);
    }
  });

  it('encodes the envelope context', () => {
    expect(
      hex(
        encodeEnvelopeContext({
          spaceId: 'space-1',
          generation: 1,
          recipientDeviceId: 'device-b',
          authoriserDeviceId: 'device-a',
          recipientRevision: 3,
        })
      )
    ).toBe(
      '010000000f616f692f656e76656c6f70652f76310000000773706163652d310000000000000001000000086465766963652d62000000086465766963652d610000000000000003'
    );
  });

  it('encodes the recovery contexts, which carry only their label', () => {
    expect(hex(encodeRecoveryWrapContext())).toBe('0100000014616f692f7265636f766572792d777261702f7631');
    expect(hex(encodeRecoverySigningContext())).toBe('0100000017616f692f7265636f766572792d7369676e696e672f7631');
  });

  it('encodes the recovery envelope context', () => {
    expect(hex(encodeRecoveryEnvelopeContext({ spaceId: 'space-1', generation: 1 }))).toBe(
      '0100000018616f692f7265636f766572792d656e76656c6f70652f76310000000773706163652d310000000000000001'
    );
  });

  it('encodes the media context', () => {
    expect(hex(encodeMediaContext({ mediaId: 'm-1', generation: 1 }))).toBe(
      '010000000c616f692f6d656469612f7631000000036d2d310000000000000001'
    );
  });

  it('encodes a device record', () => {
    expect(
      hex(
        encodeDeviceRecord({
          deviceId: 'device-a',
          spaceId: 'space-1',
          signingPublicKey: new Uint8Array(32).fill(1),
          agreementPublicKey: new Uint8Array(32).fill(2),
          authorisedBy: 'self',
          revision: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
        })
      )
    ).toBe(
      '0100000014616f692f6465766963652d7265636f72642f7631000000086465766963652d610000000773706163652d310000002001010101010101010101010101010101010101010101010101010101010101010000002002020202020202020202020202020202020202020202020202020202020202020000000473656c66000000000000000100000018323032362d30312d30315430303a30303a30302e3030305a'
    );
  });

  it('encodes a device tombstone', () => {
    expect(
      hex(
        encodeDeviceTombstone({
          targetDeviceId: 'device-b',
          revision: 2,
          revokedByDeviceId: 'device-a',
          revokedAt: '2026-02-01T00:00:00.000Z',
        })
      )
    ).toBe(
      '0100000017616f692f6465766963652d746f6d6273746f6e652f7631000000086465766963652d620000000000000002000000086465766963652d6100000018323032362d30322d30315430303a30303a30302e3030305a'
    );
  });

  it('encodes a media manifest with its optionals present', () => {
    expect(
      hex(
        encodeMediaManifest({
          mediaId: 'm-1',
          spaceId: 'space-1',
          generation: 1,
          revision: 1,
          wrappedKey: { nonce: new Uint8Array(12).fill(3), ciphertext: new Uint8Array(48).fill(4) },
          sealedNonce: new Uint8Array(12).fill(5),
          byteLength: 1024,
          mimeType: 'image/jpeg',
          width: 640,
          height: 480,
          personTag: 'you',
          uploaderDeviceId: 'device-a',
          createdAt: '2026-01-01T00:00:00.000Z',
        })
      )
    ).toBe(
      '0100000015616f692f6d656469612d6d616e69666573742f7631000000036d2d310000000773706163652d31000000000000000100000000000000010000000c030303030303030303030303000000300404040404040404040404040404040404040404040404040404040404040404040404040404040404040404040404040000000c05050505050505050505050500000000000004000000000a696d6167652f6a7065670100000000000002800100000000000001e00100000003796f75000000086465766963652d6100000018323032362d30312d30315430303a30303a30302e3030305a'
    );
  });

  it('encodes a media manifest with its optionals absent', () => {
    expect(
      hex(
        encodeMediaManifest({
          mediaId: 'm-1',
          spaceId: 'space-1',
          generation: 1,
          revision: 1,
          wrappedKey: { nonce: new Uint8Array(12).fill(3), ciphertext: new Uint8Array(48).fill(4) },
          sealedNonce: new Uint8Array(12).fill(5),
          byteLength: 1024,
          mimeType: 'image/jpeg',
          uploaderDeviceId: 'device-a',
          createdAt: '2026-01-01T00:00:00.000Z',
        })
      )
    ).toBe(
      '0100000015616f692f6d656469612d6d616e69666573742f7631000000036d2d310000000773706163652d31000000000000000100000000000000010000000c030303030303030303030303000000300404040404040404040404040404040404040404040404040404040404040404040404040404040404040404040404040000000c05050505050505050505050500000000000004000000000a696d6167652f6a706567000000000000086465766963652d6100000018323032362d30312d30315430303a30303a30302e3030305a'
    );
  });

  it('encodes a media tombstone', () => {
    expect(
      hex(
        encodeMediaTombstone({
          mediaId: 'm-1',
          revision: 2,
          deletedAt: '2026-03-01T00:00:00.000Z',
          deletedByDeviceId: 'device-b',
        })
      )
    ).toBe(
      '0100000016616f692f6d656469612d746f6d6273746f6e652f7631000000036d2d31000000000000000200000018323032362d30332d30315430303a30303a30302e3030305a000000086465766963652d62'
    );
  });
});

describe('the primitives', () => {
  it('writes uint64 big-endian across both words', () => {
    expect(hex(new ProtocolWriter().uint64(4294967296).toBytes())).toBe('0000000100000000');
    expect(hex(new ProtocolWriter().uint64(4294967297).toBytes())).toBe('0000000100000001');
    expect(hex(new ProtocolWriter().uint64(UINT64_MAX_SAFE).toBytes())).toBe('001fffffffffffff');
    expect(hex(new ProtocolWriter().uint64(0).toBytes())).toBe('0000000000000000');
  });

  it('writes uint32 big-endian', () => {
    expect(hex(new ProtocolWriter().uint32(4294967295).toBytes())).toBe('ffffffff');
    expect(hex(new ProtocolWriter().uint32(0).toBytes())).toBe('00000000');
  });

  it('writes strings and byte strings with a length prefix', () => {
    expect(hex(new ProtocolWriter().string('').toBytes())).toBe('00000000');
    expect(hex(new ProtocolWriter().string('ab').toBytes())).toBe('000000026162');
    expect(hex(new ProtocolWriter().bytes(new Uint8Array([1, 2, 3])).toBytes())).toBe('00000003010203');
    expect(hex(new ProtocolWriter().bytes(new Uint8Array(0)).toBytes())).toBe('00000000');
  });

  it('writes UTF-8 rather than UTF-16 code units', () => {
    // é is two bytes, the em dash is three, and each CJK character is three.
    expect(hex(new ProtocolWriter().string('café — 東京').toBytes())).toBe(
      '00000010636166c3a920e2809420e69db1e4baac'
    );
  });

  it('writes lists with a count prefix', () => {
    expect(hex(new ProtocolWriter().list(['a', 'bb'], (writer, value) => writer.string(value)).toBytes())).toBe(
      '000000020000000161000000026262'
    );
    expect(hex(new ProtocolWriter().list([], (writer: ProtocolWriter, value: string) => writer.string(value)).toBytes())).toBe(
      '00000000'
    );
  });

  it('distinguishes an absent optional from a present zero', () => {
    expect(hex(new ProtocolWriter().optional(null, (writer, value: number) => writer.uint64(value)).toBytes())).toBe('00');
    expect(hex(new ProtocolWriter().optional(undefined, (writer, value: number) => writer.uint64(value)).toBytes())).toBe('00');
    expect(hex(new ProtocolWriter().optional(0, (writer, value: number) => writer.uint64(value)).toBytes())).toBe(
      '010000000000000000'
    );
  });
});

/**
 * The ambiguity the length prefixes exist to remove. Without them, the pair
 * ("ab", "c") and the pair ("a", "bc") would produce the same bytes.
 */
describe('the encoding is unambiguous', () => {
  it('separates field boundaries', () => {
    const first = hex(new ProtocolWriter().version().string('ab').string('c').toBytes());
    const second = hex(new ProtocolWriter().version().string('a').string('bc').toBytes());
    expect(first).toBe('010000000261620000000163');
    expect(second).toBe('010000000161000000026263');
    expect(first).not.toBe(second);
  });

  it('separates a label from the data behind it', () => {
    // Same bytes on the wire, different structure: one string, or two.
    const one = hex(new ProtocolWriter().version().string('ab').toBytes());
    const two = hex(new ProtocolWriter().version().string('a').string('b').toBytes());
    expect(one).not.toBe(two);
  });
});

describe('integers outside the supported range are refused', () => {
  it('refuses an integer above the safe range rather than truncating it', () => {
    expect(() => new ProtocolWriter().uint64(UINT64_MAX_SAFE + 1)).toThrow(RangeError);
    expect(() => new ProtocolWriter().uint64(2 ** 53)).toThrow(RangeError);
  });

  it('refuses a negative or fractional integer', () => {
    expect(() => new ProtocolWriter().uint64(-1)).toThrow(RangeError);
    expect(() => new ProtocolWriter().uint64(1.5)).toThrow(RangeError);
    expect(() => new ProtocolWriter().uint32(-1)).toThrow(RangeError);
    expect(() => new ProtocolWriter().uint32(2 ** 32)).toThrow(RangeError);
  });

  it('refuses bigint rather than guessing at its range', () => {
    expect(() => new ProtocolWriter().uint64(1n as unknown as number)).toThrow(TypeError);
  });
});
