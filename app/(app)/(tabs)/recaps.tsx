import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Divider } from '@/components/ui/divider';
import { Surface } from '@/components/ui/surface';
import { Spacing } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';

export default function RecapsScreen() {
  const muted = useThemeColor({}, 'muted');

  return (
    <ScrollView
      contentContainerStyle={styles.contentContainer}
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.hero}>
        <ThemedText type="meta" style={{ color: muted }}>
          Deterministic recaps
        </ThemedText>
        <ThemedText type="title">Monthly and anniversary views</ThemedText>
        <ThemedText type="body" style={{ color: muted }}>
          Recaps stay chronological and private, with no AI interpretation.
        </ThemedText>
      </View>

      <Surface variant="raised" style={styles.card}>
        <ThemedText type="meta">February 2026</ThemedText>
        <Divider style={styles.divider} />
        <ThemedText type="body">Monthly recap pipeline will appear here.</ThemedText>
      </Surface>

      <Surface style={styles.card}>
        <ThemedText type="meta">Anniversary</ThemedText>
        <Divider style={styles.divider} />
        <ThemedText type="body">
          Anniversary selection is planned after relationship metadata is wired.
        </ThemedText>
      </Surface>

      <View style={styles.actions}>
        <Button label="Refresh recaps" variant="secondary" disabled onPress={() => {}} />
      </View>
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
  actions: {
    marginTop: Spacing[8],
  },
});
