import { Ionicons } from '@expo/vector-icons';
import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { GallerySection } from '@/features/moments/gallery';
import { formatGalleryCounts } from '@/features/moments/labels';
import { useThemeColor } from '@/hooks/use-theme-color';

export type GalleryMonthHeaderProps = {
  section: GallerySection;
  /** Opens the month's chapter. Undated media has none, so it stays a heading. */
  onOpen?: (section: GallerySection) => void;
  /** The first divider already sits under the pinned header: no air above it. */
  first?: boolean;
};

/**
 * One album divider: the month in the display serif, what it holds beneath
 * it, and a way into the month's chapter — the same door the feed's month
 * rows open. Undated media reads as a heading, because there is no chapter
 * behind it to open.
 */
function GalleryMonthHeaderComponent({ section, onOpen, first }: GalleryMonthHeaderProps) {
  const muted = useThemeColor({}, 'muted');
  const openable = section.monthKey !== 'undated' && !!onOpen;
  const handlePress = useCallback(() => {
    onOpen?.(section);
  }, [onOpen, section]);

  const heading = (
    <View style={styles.text}>
      {/* Serif display, matching the chapter cover this divider opens. */}
      <ThemedText type="title">{section.label}</ThemedText>
      <ThemedText type="meta" style={{ color: muted }}>
        {formatGalleryCounts(section.counts)}
      </ThemedText>
    </View>
  );

  if (!openable) {
    return (
      <View style={[styles.header, first ? styles.headerFirst : null]}>{heading}</View>
    );
  }

  return (
    <Pressable
      accessibilityHint="Opens this month as a chapter"
      accessibilityLabel={`Open ${section.label} chapter`}
      accessibilityRole="button"
      onPress={handlePress}
      style={[styles.header, first ? styles.headerFirst : null]}
    >
      {heading}
      <Ionicons color={muted} name="chevron-forward" size={16} />
    </Pressable>
  );
}

export const GalleryMonthHeader = memo(GalleryMonthHeaderComponent);

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing[8],
    // 44 minimum: the divider is a press target when the month is openable.
    minHeight: 44,
    paddingHorizontal: Spacing[24],
    // Air above an album divider, tighter below it: 24 over, 8 under.
    paddingTop: Spacing[24],
    paddingBottom: Spacing[8],
  },
  headerFirst: {
    paddingTop: Spacing[8],
  },
  text: {
    flex: 1,
    gap: Spacing[4],
  },
});
