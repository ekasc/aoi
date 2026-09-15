import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';

import {
  LANDING_BACKGROUND_DARK,
  LANDING_BACKGROUND_LIGHT,
  landingInk,
  landingSubtle,
  landingThemeForColorScheme,
} from '@/constants/landing-theme';
import { Motion } from '@/constants/theme';
import { FontFamilies } from '@/constants/typography';

export { LANDING_BACKGROUND_DARK, LANDING_BACKGROUND_LIGHT, landingInk, landingSubtle };

export type ImmersiveHeroVariant = 'welcome' | 'signin';

type ImmersiveHeroProps = {
  cta: ReactNode;
  legal?: ReactNode;
  variant?: ImmersiveHeroVariant;
};

export function ImmersiveHero({ cta, legal, variant = 'welcome' }: ImmersiveHeroProps) {
  const theme = landingThemeForColorScheme('dark');
  const ink = theme.ink;
  const subtle = theme.subtle;
  const headline = variant === 'signin' ? 'Welcome\nback.' : 'The world\ncan wait.';
  const body =
    variant === 'signin'
      ? 'Your moments, letters, and everything in between are waiting.'
      : 'A private place for your moments, letters, and everything in between.';

  return (
    <Animated.View
      entering={FadeIn.duration(Motion.slow).reduceMotion(ReduceMotion.System)}
      style={styles.root}
    >
      <View style={styles.wordmarkWrap}>
        <Text style={[styles.wordmark, { color: subtle }]}>aoi</Text>
      </View>
      <View style={styles.spacer} />
      <View style={styles.copy}>
        <Text accessibilityRole="header" style={[styles.headline, { color: ink }]}>
          {headline}
        </Text>
        <Text style={[styles.body, { color: subtle }]}>{body}</Text>
      </View>
      <View style={styles.actions}>
        {cta}
        {legal}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    width: '100%',
  },
  wordmarkWrap: {
    alignItems: 'flex-start',
  },
  wordmark: {
    fontFamily: FontFamilies.display,
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '400',
  },
  spacer: {
    flex: 1,
    minHeight: 160,
  },
  copy: {
    gap: 12,
    alignItems: 'flex-start',
  },
  headline: {
    fontFamily: FontFamilies.display,
    fontSize: 44,
    lineHeight: 49,
    fontWeight: '400',
    textAlign: 'left',
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400',
    textAlign: 'left',
    maxWidth: 340,
  },
  actions: {
    width: '100%',
    marginTop: 28,
    gap: 16,
  },
});
