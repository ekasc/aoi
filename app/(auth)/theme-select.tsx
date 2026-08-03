import { Stack, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemeSelector } from '@/components/theme/theme-selector';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/features/session/session-context';
import { useThemeColor } from '@/hooks/use-theme-color';

export default function ThemeSelectScreen() {
  const router = useRouter();
  const { status } = useSession();
  const muted = useThemeColor({}, 'muted');
  const background = useThemeColor({}, 'background');

  const handleContinue = useCallback(() => {
    if (status !== 'signed_in') {
      router.replace('/(public)');
      return;
    }

    router.replace('/');
  }, [router, status]);

  return (
    <>
      <Stack.Screen options={{ title: 'Theme' }} />
      <ScrollView
        style={{ backgroundColor: background }}
        contentContainerStyle={styles.contentContainer}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
      >
        <Surface variant="raised" style={styles.heroCard}>
          <ThemedText type="meta" style={{ color: muted }} selectable>
            Final step
          </ThemedText>
          <ThemedText type="title" selectable>
            Choose a theme
          </ThemedText>
          <ThemedText type="caption" style={{ color: muted }} selectable>
            This look is for both of you. Pick the one that feels like your space.
          </ThemedText>
        </Surface>

        <Surface style={styles.selectorCard}>
          <ThemeSelector />
        </Surface>

        <View style={styles.readyCard}>
          <ThemedText type="title" style={styles.readyTitle}>
            Your space is ready
          </ThemedText>
          <ThemedText type="body" style={{ color: muted }}>
            Start adding moments to your shared timeline — each one is a page in your story.
          </ThemedText>
          <Button label="Start your timeline" onPress={handleContinue} />
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  contentContainer: {
    paddingHorizontal: Spacing[16],
    paddingTop: Spacing[16],
    paddingBottom: Spacing[40],
    gap: Spacing[12],
  },
  heroCard: {
    gap: Spacing[8],
  },
  selectorCard: {
    gap: Spacing[8],
  },
  readyCard: {
    gap: Spacing[8],
    paddingTop: Spacing[8],
  },
  readyTitle: {
    fontSize: 26,
    lineHeight: 32,
  },
});
