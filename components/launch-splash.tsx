import { StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  ReduceMotion,
} from 'react-native-reanimated';

import { Colors, Spacing } from '@/constants/theme';
import type { BeachThemeColors } from '@/constants/theme-presets';
import { FontFamilies } from '@/constants/typography';

type LaunchSplashProps = {
  themeName: 'light' | 'dark';
  colors?: BeachThemeColors;
  relationship?: {
    youName: string;
    partnerName: string;
    sinceLabel: string;
  } | null;
};

export function LaunchSplash({ themeName, colors, relationship }: LaunchSplashProps) {
  const palette = colors ?? Colors[themeName];

  return (
    <Animated.View
      entering={FadeIn.duration(420).reduceMotion(ReduceMotion.System)}
      exiting={FadeOut.duration(380).reduceMotion(ReduceMotion.System)}
      style={[styles.container, { backgroundColor: palette.background }]}
    >
      <View style={[styles.orb, styles.orbTop, { borderColor: palette.border }]} />
      <View
        style={[styles.orb, styles.orbBottom, { borderColor: palette.partnerAccent }]}
      />
      <View style={[styles.petal, styles.petalLeft, { borderColor: palette.accent }]} />
      <View
        style={[styles.petal, styles.petalRight, { borderColor: palette.partnerAccent }]}
      />
      <View style={[styles.frame, { borderColor: palette.border, backgroundColor: palette.surface }]}>
        <View style={[styles.innerFrame, { borderColor: palette.thread }]}>
          <Animated.Text
            entering={FadeInDown.duration(500)
              .delay(80)
              .reduceMotion(ReduceMotion.System)}
            style={[styles.mark, { color: palette.text }]}
          >
            Aoi
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.duration(520)
              .delay(150)
              .reduceMotion(ReduceMotion.System)}
            style={[styles.caption, { color: palette.muted }]}
          >
            {relationship
              ? `${relationship.youName} & ${relationship.partnerName}`
              : 'a private suite for two'}
          </Animated.Text>
          {relationship ? (
            <Animated.Text
              entering={FadeInDown.duration(520)
                .delay(220)
                .reduceMotion(ReduceMotion.System)}
              style={[styles.relationshipSince, { color: palette.muted }]}
            >
              Since {relationship.sinceLabel}
            </Animated.Text>
          ) : null}
        </View>
      </View>
      <Animated.View
        entering={FadeIn.duration(520).delay(260).reduceMotion(ReduceMotion.System)}
        style={styles.dotRow}
      >
        <View style={[styles.dot, { backgroundColor: palette.accent }]} />
        <View style={[styles.dot, { backgroundColor: palette.partnerAccent }]} />
        <View style={[styles.dot, { backgroundColor: palette.thread }]} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orb: {
    position: 'absolute',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
  },
  orbTop: {
    width: 220,
    height: 220,
    top: 84,
    right: -72,
    opacity: 0.45,
  },
  orbBottom: {
    width: 280,
    height: 280,
    bottom: -118,
    left: -104,
    opacity: 0.4,
  },
  petal: {
    position: 'absolute',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    opacity: 0.45,
  },
  petalLeft: {
    width: 72,
    height: 120,
    top: 184,
    left: 50,
    transform: [{ rotate: '-18deg' }],
  },
  petalRight: {
    width: 72,
    height: 120,
    top: 184,
    right: 50,
    transform: [{ rotate: '18deg' }],
  },
  frame: {
    width: 256,
    height: 256,
    borderRadius: 36,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing[12],
  },
  innerFrame: {
    width: '100%',
    height: '100%',
    borderRadius: 30,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[8],
  },
  mark: {
    fontFamily: FontFamilies.display,
    fontSize: 54,
    lineHeight: 56,
    letterSpacing: -0.8,
  },
  caption: {
    fontFamily: FontFamilies.body,
    fontSize: 14,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  relationshipSince: {
    fontFamily: FontFamilies.body,
    fontSize: 12,
    lineHeight: 18,
    letterSpacing: 0.25,
  },
  dotRow: {
    position: 'absolute',
    bottom: 112,
    flexDirection: 'row',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    opacity: 0.8,
  },
});
