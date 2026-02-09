import { Link } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { Spacing } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';

export default function VerifyCodeScreen() {
  const muted = useThemeColor({}, 'muted');
  const background = useThemeColor({}, 'background');

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
          Auth moved
        </ThemedText>
        <ThemedText type="title" selectable>
          Use provider sign in
        </ThemedText>
        <ThemedText type="caption" style={{ color: muted }} selectable>
          Email code verification is deprecated for MVP. Continue with Apple or Google from the
          landing screen.
        </ThemedText>

        <View style={styles.actions}>
          <Link href="/(public)" asChild>
            <Button label="Back to landing" />
          </Link>
          <Link href="/(auth)/sign-in" asChild>
            <Button label="Provider sign in" variant="secondary" />
          </Link>
        </View>
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
    gap: Spacing[8],
  },
  actions: {
    gap: Spacing[8],
    marginTop: Spacing[4],
  },
});
