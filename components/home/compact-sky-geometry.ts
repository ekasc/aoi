// Docked system tab bar geometry (pure numbers, single source, zero imports).
// NativeTabs renders the platform bar (iOS liquid glass, Android Material 3)
// instead of the old floating capsule. Unlike the capsule, the system bar's
// height cannot be measured programmatically, so screens clear a
// conservative estimate and let scroll-view insets handle the rest.
export const SYSTEM_TAB_BAR_CONTENT_HEIGHT = 50;
export const SYSTEM_TAB_BAR_BOTTOM_GAP = 8;
// Visual gap between a floating action button and the tab bar top.
export const FAB_ABOVE_BAR_GAP = 16;

/**
 * Distance from the screen bottom to the system tab bar top, matching the
 * docked-bar footprint (max(bottomInset, 8) + SYSTEM_TAB_BAR_BOTTOM_GAP)
 * plus the bar content height.
 */
export function systemTabBarTopOffset(bottomInset: number): number {
  const bottomOffset = Math.max(bottomInset, 8) + SYSTEM_TAB_BAR_BOTTOM_GAP;
  return bottomOffset + SYSTEM_TAB_BAR_CONTENT_HEIGHT;
}

/**
 * Bottom offset for a FAB that should hover just above the tab bar.
 *
 * iOS native tab bars are folded into the screen's bottom safe-area inset
 * (react-native-screens corrects the inset for the native bar), so when the
 * inset already contains the bar we add only the visual gap. When it does
 * not (bare home indicator, or Android where the inset is just the system
 * navigation), we add the docked-bar estimate on top. Both cases land the
 * FAB in the same visual spot instead of double-counting the bar.
 */
export function fabBottomOffset(bottomInset: number, isIos: boolean): number {
  const barAlreadyInset = isIos && bottomInset >= SYSTEM_TAB_BAR_CONTENT_HEIGHT;
  const aboveBar = barAlreadyInset
    ? bottomInset
    : Math.max(bottomInset, SYSTEM_TAB_BAR_BOTTOM_GAP) +
      SYSTEM_TAB_BAR_CONTENT_HEIGHT;
  return aboveBar + FAB_ABOVE_BAR_GAP;
}
