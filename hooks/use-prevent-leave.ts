import { useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/build/react-navigation/core/usePreventRemove';

/**
 * Guard the current screen against removal (header back, native swipe-down,
 * Android back) while `prevent` is true. On an attempt, `onBlocked` receives
 * a `leave` callback that replays the intercepted navigation action — call it
 * once the user confirms (after the guard is released by flipping `prevent`
 * to false), or drop it to keep the screen.
 *
 * Wraps React Navigation's `usePreventRemove`, which on iOS native-stack sets
 * `preventNativeDismiss` so a form-sheet drag is blocked and reported instead
 * of silently dropping the screen.
 */
export function usePreventLeave(
  prevent: boolean,
  onBlocked: (leave: () => void) => void
): void {
  const navigation = useNavigation();
  usePreventRemove(prevent, ({ data }) => {
    onBlocked(() => navigation.dispatch(data.action));
  });
}
