// Docked system tab bar geometry (pure numbers, single source, zero imports).
// NativeTabs renders the platform bar (iOS liquid glass, Android Material 3)
// instead of the old floating capsule. Unlike the capsule, the system bar's
// height cannot be measured programmatically, so screens clear a
// conservative estimate and let scroll-view insets handle the rest.
// The tab bar is not the same thing on both platforms. iOS draws UITabBar and
// reserves its own space; Android draws the app's floating glass capsule (see
// components/navigation/aoi-tab-bar.tsx) over the content, so its footprint is
// ours to declare — and screens have to pad for it themselves.
const IS_IOS = process.env.EXPO_OS === 'ios';

/** Content height of the Android bar, above the system navigation inset. */
export const ANDROID_TAB_BAR_HEIGHT = 64;
/** Side margin the Android bar's items keep from the screen edge. */
export const ANDROID_TAB_BAR_SIDE_MARGIN = 20;

export const SYSTEM_TAB_BAR_CONTENT_HEIGHT = IS_IOS ? 50 : ANDROID_TAB_BAR_HEIGHT;
export const SYSTEM_TAB_BAR_BOTTOM_GAP = 8;
// Visual gap between a floating action button and the tab bar top.
export const FAB_ABOVE_BAR_GAP = 16;

/**
 * True when the reported bottom inset already contains the native tab bar.
 *
 * react-native-screens folds the system bar into the inset on both platforms,
 * so adding the bar height on top of an inset like that counts it twice — on
 * Android that pushed every FAB 100+ points above the bar it belongs to.
 * An inset at or above the bar's own height can only be bar-inclusive: a bare
 * gesture inset is 24–34pt, well under it.
 */
function insetIncludesBar(bottomInset: number): boolean {
  return bottomInset >= SYSTEM_TAB_BAR_CONTENT_HEIGHT;
}

/**
 * Distance from the screen bottom to the system tab bar top.
 *
 * A bar-inclusive inset *is* that distance. Anything smaller is a bare system
 * inset, so the docked bar's footprint is added on top of it.
 */
export function systemTabBarTopOffset(bottomInset: number): number {
  if (IS_IOS) {
    // The native bar is folded into the inset; only a bare inset needs the
    // estimate added.
    return insetIncludesBar(bottomInset)
      ? bottomInset
      : Math.max(bottomInset, SYSTEM_TAB_BAR_BOTTOM_GAP) + SYSTEM_TAB_BAR_CONTENT_HEIGHT;
  }
  // Android's bar is docked (a printed footer, not a floating capsule): the
  // system navigation inset plus the bar's own content height.
  return bottomInset + ANDROID_TAB_BAR_HEIGHT;
}

/**
 * Bottom offset for a FAB that should hover just above the tab bar.
 *
 * Whatever the bar's top is, the FAB sits one visual gap above it. On iOS the
 * native bar is already inside the inset; on Android the floating capsule is
 * ours, so its footprint is added to the system inset.
 */
export function fabBottomOffset(bottomInset: number): number {
  return systemTabBarTopOffset(bottomInset) + FAB_ABOVE_BAR_GAP;
}
