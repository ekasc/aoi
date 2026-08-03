import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  ReduceMotion,
  withRepeat,
  withSequence,
  withTiming,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Motion, Spacing } from '@/constants/theme';
import { useSpace } from '@/features/space/space-context';
import { useSqueeze } from '@/features/squeeze/squeeze-context';
import { useThemeColor } from '@/hooks/use-theme-color';

/**
 * Full-screen soft pulse shown when a squeeze arrives from the partner.
 * Tap anywhere to dismiss; auto-dismisses after a few calm seconds.
 */
export function SqueezeOverlay() {
  const { incomingSqueeze, dismissIncoming } = useSqueeze();
  const { space } = useSpace();
  const partnerAccent = useThemeColor({}, 'partnerAccent');
  const background = useThemeColor({}, 'background');
  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');

  const pulse = useSharedValue(1);

  useEffect(() => {
    if (!incomingSqueeze) {
      pulse.value = 1;
      return;
    }

    pulse.value = withRepeat(
      withSequence(
        withTiming(1.12, { duration: Motion.slow, easing: Easing.out(Easing.ease) }),
        withTiming(1, { duration: Motion.slow, easing: Easing.in(Easing.ease) })
      ),
      -1,
      false
    );

    const autoDismiss = setTimeout(dismissIncoming, 6500);

    return () => clearTimeout(autoDismiss);
  }, [dismissIncoming, incomingSqueeze, pulse]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));

  const partnerName = useMemo(() => space?.partnerName ?? 'Your partner', [space?.partnerName]);

  if (!incomingSqueeze) {
    return null;
  }

  return (
    <Pressable
      accessibilityLabel="Squeeze received. Tap to dismiss."
      accessibilityRole="button"
      onPress={dismissIncoming}
      style={[styles.root, { backgroundColor: `${background}F2` }]}
    >
      <Animated.View
        entering={FadeIn.duration(Motion.slow).reduceMotion(ReduceMotion.System)}
        exiting={FadeOut.duration(Motion.base).reduceMotion(ReduceMotion.System)}
        style={styles.content}
      >
        <Animated.View
          style={[pulseStyle, styles.heartCircle, { backgroundColor: partnerAccent }]}
        >
          <Ionicons color="#FFFFFF" name="heart" size={40} />
        </Animated.View>
        <View style={styles.textBlock}>
          <ThemedText type="title" style={{ color: text }}>
            {partnerName} squeezed back
          </ThemedText>
          <ThemedText type="caption" style={{ color: muted }}>
            They are thinking of you.
          </ThemedText>
        </View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  content: {
    alignItems: 'center',
    gap: Spacing[24],
    padding: Spacing[24],
  },
  heartCircle: {
    alignItems: 'center',
    borderRadius: 56,
    height: 112,
    justifyContent: 'center',
    width: 112,
  },
  textBlock: {
    alignItems: 'center',
    gap: Spacing[4],
  },
});
