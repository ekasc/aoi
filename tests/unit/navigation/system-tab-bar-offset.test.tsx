import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

import {
  FAB_ABOVE_BAR_GAP,
  SYSTEM_TAB_BAR_CONTENT_HEIGHT,
  fabBottomOffset,
  systemTabBarTopOffset,
} from '@/components/home/compact-sky-geometry';

const GEOMETRY_SOURCE = readFileSync(
  'components/home/compact-sky-geometry.ts',
  'utf8'
);
const SKY_SOURCE = readFileSync('components/home/memory-sky.tsx', 'utf8');
const INDEX_SOURCE = readFileSync(
  'app/(app)/(tabs)/(memories)/index.tsx',
  'utf8'
);

describe('system tab bar offset (single source)', () => {
  it('uses a conservative 50pt docked-bar estimate', () => {
    expect(SYSTEM_TAB_BAR_CONTENT_HEIGHT).toBe(50);
    expect(FAB_ABOVE_BAR_GAP).toBe(16);
  });

  it('matches the docked-bar footprint plus bar height', () => {
    // max(bottomInset, SYSTEM_TAB_BAR_BOTTOM_GAP) + gap + bar height.
    expect(systemTabBarTopOffset(0)).toBe(16 + 50);
    expect(systemTabBarTopOffset(8)).toBe(16 + 50);
    expect(systemTabBarTopOffset(20)).toBe(28 + 50);
    expect(systemTabBarTopOffset(34)).toBe(42 + 50);
  });
});

describe('FAB bottom offset (no double-counted tab bar)', () => {
  it('iOS: a bar-inclusive inset adds only the gap', () => {
    // react-native-screens folds the native bar into the bottom inset, so
    // the FAB must not add the bar estimate a second time.
    expect(fabBottomOffset(83, true)).toBe(83 + FAB_ABOVE_BAR_GAP);
    expect(fabBottomOffset(91, true)).toBe(91 + FAB_ABOVE_BAR_GAP);
  });

  it('iOS: a bare home-indicator inset still clears the bar', () => {
    expect(fabBottomOffset(34, true)).toBe(34 + 50 + FAB_ABOVE_BAR_GAP);
    expect(fabBottomOffset(0, true)).toBe(8 + 50 + FAB_ABOVE_BAR_GAP);
  });

  it('lands the FAB in the same visual spot either way', () => {
    const inclusive = fabBottomOffset(83, true);
    const bare = fabBottomOffset(34, true);
    // 83 + 16 (99) against 34 + 50 + 16 (100): the conservative estimate is
    // off by at most a point, so the FAB reads as the same spot either way.
    expect(Math.abs(inclusive - bare)).toBeLessThanOrEqual(1);
  });

  it('Android adds the bar estimate on top of the system inset', () => {
    expect(fabBottomOffset(24, false)).toBe(24 + 50 + FAB_ABOVE_BAR_GAP);
    expect(fabBottomOffset(48, false)).toBe(48 + 50 + FAB_ABOVE_BAR_GAP);
  });

  it('shares the bar geometry math exactly, with zero imports', () => {
    expect(GEOMETRY_SOURCE).toContain(
      'export const SYSTEM_TAB_BAR_CONTENT_HEIGHT = 50'
    );
    expect(GEOMETRY_SOURCE).toContain('export function fabBottomOffset');
    expect(GEOMETRY_SOURCE).toContain(
      'bottomInset >= SYSTEM_TAB_BAR_CONTENT_HEIGHT'
    );
    // The old floating-capsule geometry is gone: one source, no second bar.
    expect(GEOMETRY_SOURCE).not.toContain('FLOATING');
    // memory-sky re-exports the same numbers for the tab screens' mocks.
    expect(SKY_SOURCE).toContain('fabBottomOffset');
    expect(SKY_SOURCE).not.toContain('FLOATING');
  });
});

describe('timeline clears the docked system bar', () => {
  it('pads the FAB and the list clear of the docked system bar', () => {
    // Insets are owned by the screen, so the list pad and the FAB both use
    // the shared helper to clear the bar rather than trusting the OS.
    expect(INDEX_SOURCE).toContain(
      'fabBottomOffset(insets.bottom, process.env.EXPO_OS === "ios") + Spacing[8]'
    );
    expect(INDEX_SOURCE).toContain(
      'fabBottomOffset(insets.bottom, process.env.EXPO_OS === "ios")'
    );
    expect(INDEX_SOURCE).not.toContain('FLOATING_TAB_BAR_IOS_CLEARANCE');
    expect(INDEX_SOURCE).not.toContain('tabBarRowTopOffset');
  });
});
