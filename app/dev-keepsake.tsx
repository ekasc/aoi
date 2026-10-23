import { Redirect } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { KeepsakeCard } from '@/components/keepsake/keepsake-card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { BeachThemes } from '@/constants/theme-presets';
import { DevErrorBoundary } from '@/features/dev/preview';

/**
 * Development-only keepsake card preview: the same month rendered in both
 * themes × both modes, so theme adaptation reads at a glance. Not linked
 * from any navigation; sharing leaves from the chapter screen on device.
 */
const PREVIEWS = [
  { id: 'after-hours', mode: 'light' },
  { id: 'after-hours', mode: 'dark' },
  { id: 'beach', mode: 'light' },
  { id: 'beach', mode: 'dark' },
] as const;

const SAMPLE = {
  title: 'August 2026',
  subtitle: '14 memories',
  dateRange: 'Aug 1 – Aug 31, 2026',
  coverPhotoUri: null,
};

export default function DevKeepsake() {
  if (!__DEV__) {
    return <Redirect href="/" />;
  }
  return (
    <DevErrorBoundary label="KeepsakeCard">
      <ScrollView contentContainerStyle={styles.content}>
        {PREVIEWS.map((preview) => {
          const theme = BeachThemes[preview.id];
          return (
            <View key={`${preview.id}-${preview.mode}`} style={styles.cell}>
              <ThemedText type="caption">
                {theme.name} · {preview.mode}
              </ThemedText>
              <KeepsakeCard
                card={SAMPLE}
                colors={theme[preview.mode]}
                themeName={theme.name}
              />
            </View>
          );
        })}
      </ScrollView>
    </DevErrorBoundary>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing[24],
    padding: Spacing[24],
  },
  cell: {
    gap: Spacing[8],
  },
});
