import * as Haptics from 'expo-haptics';

/**
 * Haptics, in one place, native-only (iOS + Android) and failure-proof.
 *
 * Following Apple's multimodal rules: fire on the causal event, on the same
 * frame as the visual change, and only for moments that earn it — a commit
 * (success), a failure (error), a destructive choice (warning), a selection
 * change, or a physical gesture (impact). Navigational taps and scrolling get
 * nothing, so the feedback keeps its meaning.
 *
 * Android is included deliberately: expo-haptics abstracts the motor
 * differences, and the OS-level haptics toggle is always respected, so
 * users who disabled vibration never feel anything. Web stays silent —
 * a preview buzzing the phone would surprise, not delight.
 */
const enabled = () => process.env.EXPO_OS === 'ios' || process.env.EXPO_OS === 'android';

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
  /** A physical transition settling into place. */
  soft() {
    fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft));
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
