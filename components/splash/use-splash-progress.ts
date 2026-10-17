import { useEffect } from 'react';
import { cancelAnimation, Easing, useReducedMotion, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

import { SPLASH_SETTLE_MS } from '@/components/splash/timing';

export function useSplashProgress(controlled?: SharedValue<number>) {
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(reducedMotion ? 1 : 0);

  useEffect(() => {
    if (controlled) return;
    progress.value = reducedMotion ? 1 : withTiming(1, { duration: SPLASH_SETTLE_MS, easing: Easing.linear });
    return () => cancelAnimation(progress);
  }, [controlled, progress, reducedMotion]);

  return controlled ?? progress;
}
