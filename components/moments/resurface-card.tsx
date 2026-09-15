import { Image } from 'expo-image';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing } from '@/constants/theme';
import { formatResurfaceLabel, type Resurface } from '@/features/moments/resurface';
import type { Moment } from '@/features/moments/types';
import { useThemeColor } from '@/hooks/use-theme-color';

export type ResurfaceCardProps = {
  resurfaces: Resurface[];
  onOpenMemory: (moment: Moment) => void;
};

/**
 * A quiet "on this day" section near the top of Story: at most a few
 * past memories (same month/day, at least a year back — the date claim is
 * true by construction), each with its photo or a short excerpt, a
 * historical date, and one tap into the source memory. Renders nothing
 * when there is no eligible candidate. Visually secondary to chronology:
 * no badges, no autoplay, no promotional hero.
 */
function ResurfaceCardComponent({ resurfaces, onOpenMemory }: ResurfaceCardProps) {
  const muted = useThemeColor({}, 'muted');
  const surface2 = useThemeColor({}, 'surface2');

  if (resurfaces.length === 0) {
    return null;
  }

  return (
    <View
      accessibilityRole="summary"
      style={[styles.section, { backgroundColor: surface2 }]}
    >
      <ThemedText type="meta" style={{ color: muted }}>
        On this day
      </ThemedText>
      {resurfaces.map((resurface) => {
        const { moment } = resurface;
        const excerpt =
          moment.title.trim() ||
          moment.body.trim() ||
          (moment.audioUri ? 'A voice memory' : '');
        const accessibilityLabel = `Open memory from ${formatResurfaceLabel(
          resurface.yearsAgo,
        )}`;

        return (
          <Pressable
            accessibilityLabel={accessibilityLabel}
            accessibilityRole="button"
            key={moment.id}
            onPress={() => onOpenMemory(moment)}
            style={styles.entry}
          >
            {moment.mediaPreview ? (
              <Image
                accessible={false}
                contentFit="cover"
                source={{ uri: moment.mediaPreview }}
                style={styles.thumb}
                transition={200}
              />
            ) : null}
            <View style={styles.textBlock}>
              <ThemedText type="caption" style={{ color: muted }}>
                {formatResurfaceLabel(resurface.yearsAgo)}
              </ThemedText>
              {excerpt ? (
                <ThemedText type="body" numberOfLines={2}>
                  {excerpt}
                </ThemedText>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export const ResurfaceCard = memo(ResurfaceCardComponent);

const styles = StyleSheet.create({
  section: {
    gap: Spacing[12],
    borderRadius: Radii.md,
    padding: Spacing[16],
  },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[12],
    minHeight: 44,
    paddingVertical: Spacing[4],
  },
  thumb: {
    width: 48,
    height: 48,
    borderRadius: 6,
  },
  textBlock: {
    flex: 1,
    gap: Spacing[4],
  },
});
