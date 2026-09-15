import { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  AppState,
  StyleSheet,
  View,
} from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import type { AppStateStatus } from 'react-native';

// Subtle water trails sliding down the upper glass of the Midnight welcome.
// The photo stays completely still; this is the only motion on the screen.

export type RainTrailSpec = {
  left: `${number}%`;
  top: `${number}%`;
  length: number;
  droplet: number;
  peak: number;
  slide: number;
  hold: number;
  rest: number;
  delay: number;
};

export const RAIN_SLIDE_DISTANCE = 64;
export const RAIN_FADE_DURATION = 800;

export const WINDOW_RAIN_TRAILS: RainTrailSpec[] = [
  { left: '24%', top: '6%', length: 44, droplet: 3, peak: 0.1, slide: 4600, hold: 3000, rest: 9000, delay: 0 },
  { left: '46%', top: '3%', length: 32, droplet: 2, peak: 0.08, slide: 5200, hold: 5200, rest: 11000, delay: 2600 },
  { left: '63%', top: '9%', length: 48, droplet: 3, peak: 0.12, slide: 4200, hold: 2200, rest: 8000, delay: 5200 },
  { left: '78%', top: '4%', length: 28, droplet: 2, peak: 0.07, slide: 5800, hold: 6400, rest: 12000, delay: 7800 },
];

export type WindowRainProps = {
  focused?: boolean;
};

// Both loops total slide + hold + rest. y holds the full slide distance
// through the opacity fade and resets during the dark rest, so the jump
// back to the top is never visible.
export function rainTimings(spec: RainTrailSpec) {
  return {
    yHold: spec.hold + RAIN_FADE_DURATION,
    yRest: spec.rest - RAIN_FADE_DURATION,
    visibleHold: spec.slide - RAIN_FADE_DURATION + spec.hold,
    darkRest: spec.rest - RAIN_FADE_DURATION,
  };
}

function useSystemReduceMotion(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then(
      (value) => {
        if (alive) {
          setEnabled(value);
        }
      },
      () => {},
    );
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      if (alive) {
        setEnabled(value);
      }
    });
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);
  return enabled;
}

function useAppActive(): boolean {
  const [active, setActive] = useState(
    () => AppState.currentState == null || AppState.currentState === 'active',
  );
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      setActive(next === 'active');
    });
    return () => subscription.remove();
  }, []);
  return active;
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  );
  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const onChange = () => {
      setVisible(document.visibilityState !== 'hidden');
    };
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}

function RainTrail({ spec, index }: { spec: RainTrailSpec; index: number }) {
  const y = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    const timings = rainTimings(spec);
    y.value = withDelay(
      spec.delay,
      withRepeat(
        withSequence(
          withTiming(RAIN_SLIDE_DISTANCE, { duration: spec.slide, easing: Easing.linear }),
          withTiming(RAIN_SLIDE_DISTANCE, { duration: timings.yHold }),
          withTiming(0, { duration: 0 }),
          withTiming(0, { duration: timings.yRest }),
        ),
        -1,
        false,
      ),
    );
    opacity.value = withDelay(
      spec.delay,
      withRepeat(
        withSequence(
          withTiming(spec.peak, { duration: RAIN_FADE_DURATION }),
          withTiming(spec.peak, { duration: timings.visibleHold }),
          withTiming(0, { duration: RAIN_FADE_DURATION }),
          withTiming(0, { duration: timings.darkRest }),
        ),
        -1,
        false,
      ),
    );
    return () => {
      cancelAnimation(y);
      cancelAnimation(opacity);
    };
  }, [spec, y, opacity]);

  const animated = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      testID={`rain-trail-${index}`}
      pointerEvents="none"
      style={[styles.trail, { left: spec.left, top: spec.top }, animated]}
    >
      <View pointerEvents="none" style={[styles.streak, { height: spec.length }]} />
      <View
        pointerEvents="none"
        style={[
          styles.droplet,
          { width: spec.droplet, height: spec.droplet, borderRadius: spec.droplet / 2 },
        ]}
      />
    </Animated.View>
  );
}

export function WindowRain({ focused = true }: WindowRainProps = {}) {
  const reanimatedReduce = useReducedMotion();
  const systemReduce = useSystemReduceMotion();
  const appActive = useAppActive();
  const docVisible = useDocumentVisible();

  if (reanimatedReduce || systemReduce || !appActive || !docVisible || !focused) {
    return null;
  }

  return (
    <View
      testID="window-rain"
      pointerEvents="none"
      accessible={false}
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.root}
    >
      {WINDOW_RAIN_TRAILS.map((spec, index) => (
        <RainTrail key={`${spec.left}-${spec.top}`} spec={spec} index={index} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: '50%',
    overflow: 'hidden',
  },
  trail: {
    position: 'absolute',
    width: 5,
    alignItems: 'center',
  },
  streak: {
    width: 1,
    borderRadius: 1,
    backgroundColor: 'rgba(255,242,224,0.9)',
  },
  droplet: {
    marginTop: 2,
    backgroundColor: 'rgba(255,250,240,1)',
  },
});
