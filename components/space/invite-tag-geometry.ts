/**
 * Invite tag geometry (pure numbers, single source, zero imports).
 *
 * The floating invite tag lives outside any screen's layout (it overlays
 * the tab bar chrome), so bottom-anchored sheets that would sit underneath
 * it reserve this much extra bottom padding while the tag is up. Kept here
 * rather than with the tag component so screens can read it without
 * importing the component's whole dependency tree (session, sharing).
 */
export const INVITE_TAG_CLEARANCE = 40;
