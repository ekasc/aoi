import { useEffect, useState } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import Animated, { cancelAnimation, Easing, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { StatusBar } from 'expo-status-bar';

import { AnimatedIntro, SPLASH_MOTIFS } from '@/components/splash/animated-intro';
import { AoiMark } from '@/components/splash/aoi-mark';
import { SPLASH_EXIT_MS, SPLASH_SCENE_MS, SPLASH_SETTLE_MS } from '@/components/splash/timing';
import { useSplashTwinkle } from '@/components/splash/use-splash-twinkle';
import { ThemedText } from '@/components/themed-text';
import { useAoiTheme } from '@/features/theme/theme-context';

type LaunchSplashProps = {
  ready?: boolean;
  onHidden?: () => void;
  onLayout?: ViewProps['onLayout'];
  artworkProgress?: SharedValue<number>;
  exitProgress?: SharedValue<number>;
};

export function LaunchSplash({ ready = false, onHidden, onLayout, artworkProgress, exitProgress: controlledExit }: LaunchSplashProps) {
  const { selectedThemeId, colors, mode } = useAoiTheme();
  const reducedMotion = useReducedMotion();
  const [artworkSettled, setArtworkSettled] = useState(false);
  const [sceneElapsed, setSceneElapsed] = useState(false);
  const exiting = ready && sceneElapsed;
  const exit = useSharedValue(0);
  const exitProgress = controlledExit ?? exit;
  const twinkle = useSplashTwinkle(artworkSettled && !exiting);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: 1 - exitProgress.value }));
  const textFadeStyle = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, exitProgress.value / 0.5) }));

  useEffect(() => {
    if (controlledExit) return;
    if (reducedMotion) {
      exit.value = exiting ? 1 : 0;
      if (exiting) onHidden?.();
      return;
    }
    exit.value = withTiming(exiting ? 1 : 0, { duration: SPLASH_EXIT_MS, easing: Easing.in(Easing.quad) }, finished => {
      if (finished && exiting && onHidden) runOnJS(onHidden)();
    });
    return () => cancelAnimation(exit);
  }, [controlledExit, exit, exiting, onHidden, reducedMotion]);

  // The artwork draws first, the stars twinkle, then a quick crossfade out.
  // These two beats are fixed and independent of loading; loading only decides
  // whether the exit waits for it.
  useEffect(() => {
    const settleTimer = setTimeout(() => setArtworkSettled(true), SPLASH_SETTLE_MS);
    const sceneTimer = setTimeout(() => setSceneElapsed(true), SPLASH_SCENE_MS);
    return () => {
      clearTimeout(settleTimer);
      clearTimeout(sceneTimer);
    };
  }, []);

  return (
    <Animated.View
      testID="launch-splash"
      onLayout={onLayout}
      pointerEvents={exiting ? 'none' : 'auto'}
      accessibilityElementsHidden={exiting}
      importantForAccessibility={exiting ? 'no-hide-descendants' : 'auto'}
      aria-hidden={exiting}
      style={[styles.root, { backgroundColor: colors.background }, fadeStyle]}
    >
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <AnimatedIntro themeId={selectedThemeId} colors={colors} progress={artworkProgress} />
      <View style={styles.identity}>
        <AoiMark motif={SPLASH_MOTIFS[selectedThemeId]} colors={colors} progress={artworkProgress} twinkle={twinkle} />
        <Animated.View style={textFadeStyle}>
          <ThemedText type="hero" style={styles.wordmark}>aoi</ThemedText>
        </Animated.View>
      </View>
      <Animated.View style={[styles.status, textFadeStyle]}>
        <ThemedText type="caption" accessibilityRole="text" accessibilityLiveRegion="polite">
          Opening your space
        </ThemedText>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  identity: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 40,
    gap: 12,
  },
  wordmark: {
    fontWeight: '300',
    letterSpacing: -1.5,
    textAlign: 'center',
  },
  status: {
    position: 'absolute',
    bottom: '10%',
    left: 24,
    right: 24,
    textAlign: 'center',
  },
});
