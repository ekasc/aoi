import { Ionicons } from '@expo/vector-icons';
import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Divider } from '@/components/ui/divider';
import { Surface } from '@/components/ui/surface';
import { Spacing } from '@/constants/theme';
import { formatResurfaceLabel, type Resurface } from '@/features/moments/resurface';
import { useThemeColor } from '@/hooks/use-theme-color';

export type ResurfaceCardProps = {
  resurfaces: Resurface[];
};

/**
 * "On this day" — memories that surface back to the couple on the timeline.
 * Delivered to you, not something you have to go looking for.
 */
function ResurfaceCardComponent({ resurfaces }: ResurfaceCardProps) {
  const accent = useThemeColor({}, 'accent');
  const surface = useThemeColor({}, 'surface');
  const muted = useThemeColor({}, 'muted');
  const text = useThemeColor({}, 'text');

  const cardStyle = useMemo(
    () => [styles.card, { backgroundColor: surface, borderColor: accent }],
    [accent, surface]
  );

  if (resurfaces.length === 0) {
    return null;
  }

  return (
    <Surface variant="raised" style={cardStyle} accessibilityRole="summary">
      <View style={styles.headerRow}>
        <Ionicons color={accent} name="sparkles" size={16} />
        <ThemedText type="meta" style={{ color: accent }}>
          On this day
        </ThemedText>
      </View>
      <Divider style={styles.divider} />
      {resurfaces.map((resurface, index) => (
        <View key={resurface.moment.id}>
          {index > 0 ? <Divider style={styles.entryDivider} /> : null}
          <View style={styles.entry}>
            <ThemedText type="caption" style={{ color: muted }}>
              {formatResurfaceLabel(resurface.yearsAgo)}
            </ThemedText>
            <ThemedText
              type="body"
              style={[styles.excerpt, { color: text }]}
              numberOfLines={2}
            >
              {resurface.moment.title.trim() || resurface.moment.body.trim() || 'Untitled moment'}
            </ThemedText>
          </View>
        </View>
      ))}
    </Surface>
  );
}

export const ResurfaceCard = memo(ResurfaceCardComponent);

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    padding: Spacing[16],
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[8],
  },
  divider: {
    marginTop: Spacing[12],
  },
  entry: {
    paddingTop: Spacing[12],
    gap: Spacing[4],
  },
  entryDivider: {
    marginTop: Spacing[12],
  },
  excerpt: {
    fontStyle: 'italic',
  },
});
