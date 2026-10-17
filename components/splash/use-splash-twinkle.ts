import { useEffect } from 'react';
import { cancelAnimation, Easing, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { SPLASH_TWINKLE_MS } from '@/components/splash/timing';

/**
 * A short star flicker once the artwork has settled. Resolves to a steady 1
 * under reduced motion, so the scene stays a still frame and still gets held.
 */
export function useSplashTwinkle(active: boolean) {
  const reducedMotion = useReducedMotion();
  const twinkle = useSharedValue(1);

  useEffect(() => {
    if (!active || reducedMotion) {
      twinkle.value = 1;
      return;
    }
    const half = SPLASH_TWINKLE_MS / 4;
    twinkle.value = withRepeat(
      withSequence(
        withTiming(0.25, { duration: half, easing: Easing.inOut(Easing.quad) }),
        withTiming(1, { duration: half, easing: Easing.inOut(Easing.quad) }),
      ),
      2,
      false,
    );
    return () => cancelAnimation(twinkle);
  }, [active, reducedMotion, twinkle]);

  return twinkle;
}
