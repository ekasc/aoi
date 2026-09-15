import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Apple's Reduce Transparency setting: translucent materials must fall back
 * to solid, defined surfaces. Listens for live changes.
 */
export function useReduceTransparency(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceTransparencyEnabled?.()
      .then((value) => {
        if (active) {
          setEnabled(value);
        }
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener?.(
      'reduceTransparencyChanged',
      (value: boolean) => setEnabled(value)
    );
    return () => {
      active = false;
      subscription?.remove?.();
    };
  }, []);

  return enabled;
}
