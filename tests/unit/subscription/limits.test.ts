import { describe, expect, it } from 'vitest';

import { PLUS_FEATURES } from '@/features/subscription/limits';
import { formatBytes, formatLetterCount } from '@/features/subscription/format';

describe('subscription benefits (v1 contract)', () => {
  it('advertises exactly the three real benefits', () => {
    expect([...PLUS_FEATURES]).toEqual([
      'More room for photos and voice memories',
      'More letters for the future',
      'PDF chapter keepsakes',
    ]);
  });

  it('never promises location, unlocked everything, or unlimited storage', () => {
    const copy = PLUS_FEATURES.join(' ').toLowerCase();
    expect(copy).not.toMatch(/location|everything unlocked|unlimited|AI /);
  });
});

describe('usage formatting', () => {
  it('formats byte counts', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(10 * 1024 * 1024)).toBe('10 MiB');
    expect(formatBytes(250 * 1024 * 1024)).toBe('250 MiB');
    expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe('5 GiB');
  });

  it('formats letter counts', () => {
    expect(formatLetterCount(1)).toBe('1 future letter');
    expect(formatLetterCount(3)).toBe('3 future letters');
  });
});
