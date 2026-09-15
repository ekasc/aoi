import { describe, expect, it } from 'vitest';

import { settleTargetForProgress } from '@/features/moments/header-settle';

describe('settleTargetForProgress', () => {
  it('leaves resting endpoints alone', () => {
    expect(settleTargetForProgress(0, 30, 60)).toBeNull();
    expect(settleTargetForProgress(1, 90, 60)).toBeNull();
  });

  it('passes overshoot and non-finite progress through', () => {
    expect(settleTargetForProgress(-0.2, 10, 60)).toBeNull();
    expect(settleTargetForProgress(1.4, 90, 60)).toBeNull();
    expect(settleTargetForProgress(Number.NaN, 90, 60)).toBeNull();
  });

  it('always reopens below the shed distance', () => {
    expect(settleTargetForProgress(0.25, 30, 60)).toBe(0);
    expect(settleTargetForProgress(0.9, 59, 60)).toBe(0);
  });

  it('snaps to the nearer endpoint at and above the shed distance', () => {
    expect(settleTargetForProgress(0.25, 75, 60)).toBe(0);
    expect(settleTargetForProgress(0.49, 90, 60)).toBe(0);
    expect(settleTargetForProgress(0.5, 90, 60)).toBe(1);
    expect(settleTargetForProgress(0.75, 120, 60)).toBe(1);
  });
});
