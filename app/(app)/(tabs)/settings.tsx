import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemeSelector } from '@/components/theme/theme-selector';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Divider } from '@/components/ui/divider';
import { Surface } from '@/components/ui/surface';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/features/session/session-context';
import { useThemeColor } from '@/hooks/use-theme-color';

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signOut } = useSession();
  const muted = useThemeColor({}, 'muted');
  const background = useThemeColor({}, 'background');

  const handleSignOut = useCallback(async () => {
    await signOut();
    router.replace('/(public)');
  }, [router, signOut]);
  const contentContainerStyle = useMemo(
    () => [
      styles.contentContainer,
      {
        paddingTop: insets.top + Spacing[8],
        paddingBottom: insets.bottom + Spacing[16],
      },
    ],
    [insets.bottom, insets.top]
  );

  return (
    <ScrollView
      style={{ backgroundColor: background }}
      contentContainerStyle={contentContainerStyle}
      contentInsetAdjustmentBehavior="never"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.hero}>
        <ThemedText type="meta" style={{ color: muted }}>
          Your space
        </ThemedText>
        <ThemedText type="title" selectable>
          Settings
        </ThemedText>
        <ThemedText type="body" style={{ color: muted }}>
          Customize how it looks and feels.
        </ThemedText>
      </View>

      <Surface variant="raised" style={styles.card}>
        <ThemedText type="meta">Appearance</ThemedText>
        <Divider style={styles.divider} />
        <ThemeSelector />
      </Surface>

      <Surface style={styles.card}>
        <ThemedText type="meta">Session</ThemedText>
        <Divider style={styles.divider} />
        <Button label="Sign out" variant="secondary" onPress={handleSignOut} />
      </Surface>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  contentContainer: {
    gap: Spacing[12],
    paddingHorizontal: Spacing[16],
    paddingBottom: Spacing[24],
  },
  hero: {
    gap: Spacing[8],
    marginBottom: Spacing[4],
  },
  card: {
    gap: Spacing[4],
  },
  divider: {
    marginVertical: Spacing[12],
  },
});
