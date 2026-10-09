import { afterEach, describe, expect, it, vi } from 'vitest';

import { fromBase64, toBase64 } from '@/features/album/crypto';

/**
 * The album's crypto core runs on Hermes, which has no `Buffer` global. Under
 * Node (where the tests run) `Buffer` exists, so a bare reference to it passes
 * here and throws on device — the exact way this class of bug survives a green
 * suite. These tests remove the global and prove the code does not need it.
 */
describe('album base64 without a Node Buffer global', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips bytes when Buffer is absent (the device runtime)', () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255, 128, 64]);
    // What the Buffer path produces; the fallback must agree byte for byte.
    const expected = toBase64(bytes);

    vi.stubGlobal('Buffer', undefined);

    expect(toBase64(bytes)).toBe(expected);
    expect(Array.from(fromBase64(expected))).toEqual(Array.from(bytes));
  });

  it('round-trips a 32-byte key when Buffer is absent', () => {
    const key = new Uint8Array(32).fill(7);

    vi.stubGlobal('Buffer', undefined);

    expect(Array.from(fromBase64(toBase64(key)))).toEqual(Array.from(key));
  });
});
