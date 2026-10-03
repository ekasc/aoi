import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

// The preparation script performs Node-only artifact checks, without a native build.
import { verifyModelBytes } from '@/scripts/prepare-face-model.mjs';

describe('pinned model artifact checks', () => {
  it('accepts only the expected size and digest', () => {
    const bytes = Buffer.from('test artifact');
    const expected = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    expect(() => verifyModelBytes(bytes, expected)).not.toThrow();
    expect(() => verifyModelBytes(Buffer.from('TEST artifact'), expected)).toThrow('SHA-256');
    expect(() => verifyModelBytes(bytes.subarray(1), expected)).toThrow('size');
  });

  it('rejects an LFS pointer or truncated download as the actual SFace weights', () => {
    expect(() => verifyModelBytes(Buffer.from('version https://git-lfs.github.com/spec/v1'))).toThrow();
  });
});
