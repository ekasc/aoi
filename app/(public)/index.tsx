import { Link } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { Motion, Spacing } from '@/constants/theme';
import { FontFamilies } from '@/constants/typography';
import { useThemeColor } from '@/hooks/use-theme-color';

export default function LandingScreen() {
  const muted = useThemeColor({}, 'muted');

  return (
    <ScrollView
      contentContainerStyle={styles.contentContainer}
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
    >
      <Animated.View
        entering={FadeInDown.duration(Motion.slow)
          .delay(20)
          .reduceMotion(ReduceMotion.System)}
        style={styles.hero}
      >
        <ThemedText type="meta" style={{ color: muted }}>
          Private for two
        </ThemedText>
        <ThemedText type="display">Aoi</ThemedText>
        <ThemedText type="body" style={{ color: muted }}>
          A quiet relationship scrapbook for moments, milestones, dates, and
          memories. No social feed. No public sharing.
        </ThemedText>
      </Animated.View>

      <Animated.View
        entering={FadeInDown.duration(Motion.base)
          .delay(110)
          .reduceMotion(ReduceMotion.System)}
      >
        <Surface variant="raised" style={styles.card}>
          <ThemedText type="title" style={styles.cardTitle}>
            Build your chapter together
          </ThemedText>
          <ThemedText type="caption" style={{ color: muted }}>
            Media stays private to your relationship. Recaps are deterministic.
            You control what is stored.
          </ThemedText>
          <View style={styles.actions}>
            <Link href="/(auth)/sign-in" asChild>
              <Button label="Get started" />
            </Link>
            <Button
              label="I have an invite code"
              variant="ghost"
              disabled
              onPress={() => {}}
            />
          </View>
        </Surface>
      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  contentContainer: {
    paddingHorizontal: Spacing[16],
    paddingTop: Spacing[24],
    paddingBottom: Spacing[40],
    gap: Spacing[16],
  },
  hero: {
    gap: Spacing[8],
  },
  card: {
    gap: Spacing[8],
  },
  cardTitle: {
    fontFamily: FontFamilies.display,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.3,
  },
  actions: {
    marginTop: Spacing[8],
    gap: Spacing[8],
  },
});
