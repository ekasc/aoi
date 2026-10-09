import { describe, expect, it } from 'vitest';

import { DISMISS_PROGRESS, DISMISS_VELOCITY, shouldDismissOnRelease } from '@/components/moments/zoomable-photo';

describe('shouldDismissOnRelease', () => {
  it('closes once the pull is past the distance that means it', () => {
    expect(shouldDismissOnRelease(DISMISS_PROGRESS, 0)).toBe(true);
    expect(shouldDismissOnRelease(DISMISS_PROGRESS - 0.01, 0)).toBe(false);
  });

  it('closes on a fling even from a short pull', () => {
    expect(shouldDismissOnRelease(0.05, DISMISS_VELOCITY + 1)).toBe(true);
    expect(shouldDismissOnRelease(0.05, DISMISS_VELOCITY - 1)).toBe(false);
  });
});
