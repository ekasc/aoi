import { describe, it, expect } from 'vitest';
import { isOwnMoment } from '@/features/moments/ownership';

describe('isOwnMoment', () => {
  it('returns true only when isOwn is explicitly true', () => {
    expect(isOwnMoment({ isOwn: true })).toBe(true);
  });

  it('returns false when isOwn is false', () => {
    expect(isOwnMoment({ isOwn: false })).toBe(false);
  });

  it('treats a missing isOwn as not own (never widens access)', () => {
    // Regression: the old gate keyed off authorRole, which the remote API
    // hardcoded to "you" for every moment. Unknown ownership must block.
    expect(isOwnMoment({})).toBe(false);
    expect(isOwnMoment({ isOwn: undefined })).toBe(false);
  });
});
