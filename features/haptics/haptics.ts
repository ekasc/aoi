import * as Haptics from 'expo-haptics';

/**
 * Haptics, in one place, iOS-only and failure-proof.
 *
 * Following Apple's multimodal rules: fire on the causal event, on the same
 * frame as the visual change, and only for moments that earn it — a commit
 * (success), a failure (error), a destructive choice (warning), a selection
 * change, or a physical gesture (impact). Navigational taps and scrolling get
 * nothing, so the feedback keeps its meaning.
 */
const enabled = () => process.env.EXPO_OS === 'ios';

function fire(run: () => Promise<void>) {
  if (!enabled()) {
    return;
  }
  try {
    void run().catch(() => {});
  } catch {
    // Haptics must never break the flow that triggered them.
  }
}

export const haptics = {
  /** A selection moved (segment, theme, menu choice). */
  select() {
    fire(() => Haptics.selectionAsync());
  },
  /** A light, physical tap (add, remove, start/stop). */
  tap() {
    fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
  },
  /** A medium, deliberate impact (record start). */
  impact() {
    fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
  },
  /** A commit landed. */
  success() {
    fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
  },
  /** Something went wrong. */
  error() {
    fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
  },
  /** A destructive choice is about to happen (leave, delete). */
  warning() {
    fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
  },
};
