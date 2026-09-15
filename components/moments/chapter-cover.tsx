import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { Chapter } from '@/features/moments/chapters';
import { useThemeColor } from '@/hooks/use-theme-color';

export type ChapterCoverProps = {
  chapter: Chapter;
  /** Width in points; height follows the 4:5 master ratio. */
  width: number;
};

/**
 * P1B chapter-cover grammar: 4:5 master, one representative user photo
 * (cover crop lives here, never in Story) with a restrained paper title
 * band in the lower third — never text over faces. Without photography:
 * paper ground, oversized numeral, one hairline rule. No collages,
 * gradients, badges, or filler illustration.
 */
export function ChapterCover({ chapter, width }: ChapterCoverProps) {
  const border = useThemeColor({}, 'border');
  const backgroundSubtle = useThemeColor({}, 'backgroundSubtle');
  const surface = useThemeColor({}, 'surface');
  const textMuted = useThemeColor({}, 'textMuted');
  const accent = useThemeColor({}, 'accent');

  const height = (width * 5) / 4;

  return (
    <View
      accessibilityLabel={`${chapter.title} chapter cover`}
      style={[
        styles.frame,
        {
          width,
          height,
          borderColor: border,
          backgroundColor: chapter.coverPhotoUri ? backgroundSubtle : surface,
        },
      ]}
    >
      {chapter.coverPhotoUri ? (
        <>
          <Image
            accessible={false}
            contentFit="cover"
            source={{ uri: chapter.coverPhotoUri }}
            style={styles.photo}
            transition={200}
          />
          <View style={[styles.titleBand, { backgroundColor: surface, borderColor: border }]}>
            <ThemedText type="title" numberOfLines={1}>
              {chapter.title}
            </ThemedText>
            <ThemedText type="caption" style={{ color: textMuted }}>
              {chapter.subtitle}
            </ThemedText>
          </View>
        </>
      ) : (
        <View style={styles.fallback}>
          <ThemedText type="display" style={styles.numeral}>
            {chapter.kind === 'monthly'
              ? chapter.monthKey?.split('-')[1]
              : String(chapter.anniversaryYear)}
          </ThemedText>
          <View style={[styles.rule, { backgroundColor: accent }]} />
          <ThemedText type="title" numberOfLines={2} style={styles.fallbackTitle}>
            {chapter.title}
          </ThemedText>
          <ThemedText type="caption" style={{ color: textMuted }}>
            {chapter.subtitle}
          </ThemedText>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    overflow: 'hidden',
  },
  photo: {
    flex: 1,
    width: '100%',
  },
  titleBand: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing[12],
    paddingVertical: Spacing[8],
    gap: 2,
  },
  fallback: {
    flex: 1,
    alignItems: 'flex-start',
    justifyContent: 'flex-end',
    padding: Spacing[16],
    gap: Spacing[4],
  },
  numeral: {
    fontSize: 64,
    lineHeight: 68,
  },
  rule: {
    width: 32,
    height: 2,
    borderRadius: 1,
    marginVertical: Spacing[4],
  },
  fallbackTitle: {
    textAlign: 'left',
  },
});
