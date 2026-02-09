import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { ProviderAuthActions } from '@/components/auth/provider-auth-actions';
import { ThemedText } from '@/components/themed-text';
import { Surface } from '@/components/ui/surface';
import { Spacing } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';

export default function SignInScreen() {
  const router = useRouter();
  const muted = useThemeColor({}, 'muted');
  const background = useThemeColor({}, 'background');

  const handleContinue = useCallback(() => {
    router.replace('/');
  }, [router]);

  return (
    <ScrollView
      style={{ backgroundColor: background }}
      contentContainerStyle={styles.contentContainer}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <Surface variant="raised" style={styles.card}>
        <ThemedText type="meta" style={{ color: muted }} selectable>
          Sign in
        </ThemedText>
        <ThemedText type="title" selectable>
          Continue to your private space
        </ThemedText>
        <ThemedText type="caption" style={{ color: muted }} selectable>
          Use Apple or Google to continue.
        </ThemedText>
        <ProviderAuthActions onSuccess={handleContinue} />
      </Surface>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  contentContainer: {
    paddingHorizontal: Spacing[16],
    paddingTop: Spacing[16],
    paddingBottom: Spacing[40],
  },
  card: {
    gap: Spacing[12],
  },
});
