import { Link } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { Spacing } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';

export default function VerifyCodeScreen() {
  const insets = useSafeAreaInsets();
  const muted = useThemeColor({}, 'muted');
  const background = useThemeColor({}, 'background');

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: background,
          paddingTop: insets.top + Spacing[16],
          paddingBottom: insets.bottom + Spacing[40],
        },
      ]}
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing[16],
  },
  card: {
    gap: Spacing[8],
  },
  actions: {
    gap: Spacing[8],
    marginTop: Spacing[4],
  },
});
