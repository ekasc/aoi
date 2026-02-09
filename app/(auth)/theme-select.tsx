import { Stack, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemeSelector } from '@/components/theme/theme-selector';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/features/session/session-context';
import { useAoiTheme } from '@/features/theme/theme-context';
import { useThemeColor } from '@/hooks/use-theme-color';

export default function ThemeSelectScreen() {
  const router = useRouter();
  const { status } = useSession();
  const { selectedTheme } = useAoiTheme();
  const muted = useThemeColor({}, 'muted');
  const background = useThemeColor({}, 'background');

  const handleContinue = useCallback(() => {
    if (status !== 'signed_in') {
      router.replace('/(auth)/sign-in');
      return;
    }

    router.replace('/(app)/(tabs)');
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
            Step 2 of 2
          </ThemedText>
          <ThemedText type="title" selectable>
            Choose a theme
          </ThemedText>
          <ThemedText type="caption" style={{ color: muted }} selectable>
            This look is for both of you.
          </ThemedText>
        </Surface>

        <Surface style={styles.selectorCard}>
          <ThemeSelector />
        </Surface>

        <View style={styles.footer}>
          <ThemedText type="caption" style={{ color: muted }} selectable>
            Selected: {selectedTheme.name}
          </ThemedText>
          <Button label="Continue" onPress={handleContinue} />
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
  footer: {
    gap: Spacing[8],
  },
});
