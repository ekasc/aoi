import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Divider } from '@/components/ui/divider';
import { Surface } from '@/components/ui/surface';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/features/session/session-context';
import { useThemeColor } from '@/hooks/use-theme-color';

export default function SettingsScreen() {
  const router = useRouter();
  const { signOut } = useSession();
  const muted = useThemeColor({}, 'muted');

  const handleSignOut = useCallback(() => {
    signOut();
    router.replace('/(public)');
  }, [router, signOut]);

  return (
    <ScrollView
      contentContainerStyle={styles.contentContainer}
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.hero}>
        <ThemedText type="meta" style={{ color: muted }}>
          Account and relationship
        </ThemedText>
        <ThemedText type="title">Settings</ThemedText>
        <ThemedText type="body" style={{ color: muted }}>
          Export and archive controls are scaffolded for backend integration.
        </ThemedText>
      </View>

      <Surface variant="raised" style={styles.card}>
        <ThemedText type="meta">Data</ThemedText>
        <Divider style={styles.divider} />
        <Button label="Export data" variant="secondary" disabled onPress={() => {}} />
      </Surface>

      <Surface style={styles.card}>
        <ThemedText type="meta">Relationship</ThemedText>
        <Divider style={styles.divider} />
        <View style={styles.actionStack}>
          <Button
            label="Archive relationship"
            variant="secondary"
            disabled
            onPress={() => {}}
          />
          <Button label="Delete account" variant="destructive" disabled onPress={() => {}} />
        </View>
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
    paddingTop: Spacing[16],
    paddingBottom: Spacing[40],
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
  actionStack: {
    gap: Spacing[8],
  },
});
