import { describe, expect, it } from 'vitest';

import {
  BACKUP_MAX_ENTRIES,
  SEALED_CIPHERTEXT_MAX,
  albumUploadIntentRequestSchema,
  spaceBackupSchema,
} from '../index';

/**
 * The backup and the upload intent are the two places a client hands the
 * server a payload it will persist verbatim. Every string and array in them
 * has to be bounded, or "very large" is a row the server is asked to store.
 */
describe('album backup contract bounds', () => {
  const identity = {
    deviceId: 'device-1',
    signingPublicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    agreementPublicKey: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=',
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  it('accepts a realistic backup', () => {
    const result = spaceBackupSchema.safeParse({
      identities: [identity],
      deviceKeys: [],
      envelopes: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unbounded identity list', () => {
    const result = spaceBackupSchema.safeParse({
      identities: Array.from({ length: BACKUP_MAX_ENTRIES + 1 }, (_, index) => ({
        ...identity,
        deviceId: `device-${index}`,
      })),
      deviceKeys: [],
      envelopes: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a sealed ciphertext that is not a key-sized blob', () => {
    const result = albumUploadIntentRequestSchema.safeParse({
      mimeType: 'image/jpeg',
      byteLength: 1024,
      sealedNonce: 'nonce',
      wrappedKey: {
        nonce: 'nonce',
        ciphertext: 'A'.repeat(SEALED_CIPHERTEXT_MAX + 1),
      },
    });
    expect(result.success).toBe(false);
  });
});
