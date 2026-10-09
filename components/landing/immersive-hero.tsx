import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Reveal } from '@/components/ui/reveal';
import { Motion, Spacing } from '@/constants/theme';
import type { LandingTheme } from '@/constants/landing-theme';

export type ImmersiveHeroVariant = 'welcome' | 'signin';

type ImmersiveHeroProps = {
  cta: ReactNode;
  legal?: ReactNode;
  variant?: ImmersiveHeroVariant;
  /**
   * The screen's palette, already resolved from the app's dark tokens.
   * Passed in rather than read from a module constant so the same component
   * serves the landing and the sign-in screen without either hardcoding a
   * colour.
   */
  theme: LandingTheme;
};

/**
 * The get-started hero.
 *
 * Same type scale, same spacing rhythm, same reveal timing as every other
 * screen. What it no longer does is carry its own numbers: the gaps, the
 * measure and the sizes were literals, so this screen drifted from the
 * system the moment the system moved, and nothing noticed.
 */
export function ImmersiveHero({ cta, legal, variant = 'welcome', theme }: ImmersiveHeroProps) {
  const headline = variant === 'signin' ? 'Welcome\nback.' : 'The world\ncan wait.';
  const body =
    variant === 'signin'
      ? 'Your moments, letters, and everything in between are waiting.'
      : 'A private place for your moments, letters, and everything in between.';

  return (
    <Animated.View entering={Reveal.in(Motion.slow)} style={styles.root}>
      {/* A wordmark, not a heading. type="title" would put it in the
          screen-reader heading outline, where it competes with the line
          underneath for the position of "the first thing you read". */}
      <ThemedText
        accessibilityRole="text"
        type="title"
        style={[styles.wordmark, { color: theme.subtle }]}
      >
        aoi
      </ThemedText>

      {/* Pushes the copy to the lower third on a tall screen, without the
          min-height a landing page reaches for when it wants to fill one. */}
      <View style={styles.gap} />

      <View style={styles.copy}>
        <ThemedText type="hero" style={[styles.headline, { color: theme.ink }]}>
          {headline}
        </ThemedText>
        <ThemedText type="body" style={[styles.body, { color: theme.subtle }]}>
          {body}
        </ThemedText>
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
  wordmark: {
    // The mark is set in the serif, at body scale. It is a wordmark, not a
    // heading, and it should not compete with the line under it.
    fontWeight: '400',
  },
  gap: {
    flexGrow: 1,
    minHeight: Spacing[56],
  },
  copy: {
    gap: Spacing[12],
  },
  headline: {
    fontWeight: '400',
  },
  body: {
    // A measure, not a size: long enough to read comfortably, short enough
    // that the rag stays tidy on a narrow phone.
    maxWidth: 340,
  },
  actions: {
    gap: Spacing[16],
    marginTop: Spacing[24],
    width: '100%',
  },
});
