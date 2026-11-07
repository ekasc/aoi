import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

import {
  ANDROID_TAB_BAR_HEIGHT,
  FAB_ABOVE_BAR_GAP,
  SYSTEM_TAB_BAR_BOTTOM_GAP,
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

// The bar's own height differs by platform (iOS ~50, Material 3 80), so these
// assertions are written against the constant rather than a literal.
const BAR = SYSTEM_TAB_BAR_CONTENT_HEIGHT;
// An inset that can only be bar-inclusive: the bar plus a gesture strip.
const BAR_INCLUSIVE_INSET = BAR + 24;

describe('system tab bar offset (single source)', () => {
  it('carries the platform bar height and one FAB gap', () => {
    // iOS: UITabBar's own height. Android: the docked footer we draw.
    expect([50, ANDROID_TAB_BAR_HEIGHT]).toContain(BAR);
    expect(FAB_ABOVE_BAR_GAP).toBe(16);
  });

  it('adds the docked bar to a bare system inset (Android footer)', () => {
    // Vitest runs without EXPO_OS, so this exercises the Android path: the
    // footer is drawn by the app, so its height sits on top of the system
    // navigation inset.
    expect(systemTabBarTopOffset(0)).toBe(BAR);
    expect(systemTabBarTopOffset(24)).toBe(24 + BAR);
  });

  it('keeps a bar-inclusive inset for the iOS native bar', () => {
    // The iOS branch returns the inset unchanged; asserted through the source
    // because the platform cannot be switched inside one test run.
    expect(GEOMETRY_SOURCE).toContain('insetIncludesBar(bottomInset)');
  });
});

describe('FAB bottom offset (native tabs already reserve the bar)', () => {
  it('sits one gap above the docked footer', () => {
    expect(fabBottomOffset(24)).toBe(24 + BAR + FAB_ABOVE_BAR_GAP);
    expect(fabBottomOffset(0)).toBe(BAR + FAB_ABOVE_BAR_GAP);
  });

  it('is one formula for both platforms', () => {
    expect(GEOMETRY_SOURCE).toContain('export function fabBottomOffset');
    expect(GEOMETRY_SOURCE).toContain(
      'bottomInset >= SYSTEM_TAB_BAR_CONTENT_HEIGHT'
    );
    // No platform branch in the bar estimate: the inset decides, not the OS.
    expect(GEOMETRY_SOURCE).not.toContain('isIos');
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
    //
    // The list pad has to clear the FAB as well as the bar, so it adds the
    // button's own size plus a gap on top of the helper.
    expect(INDEX_SOURCE).toContain(
      'fabBottomOffset(insets.bottom) + FAB_SIZE + Spacing[24]'
    );
    expect(INDEX_SOURCE).toContain('fabBottomOffset(insets.bottom)');
    expect(INDEX_SOURCE).not.toContain('FLOATING_TAB_BAR_IOS_CLEARANCE');
    expect(INDEX_SOURCE).not.toContain('tabBarRowTopOffset');
  });
});
