import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AudioPlayer } from '@/components/media/audio-player';
import { VideoPlayer } from '@/components/media/video-player';
import { ThemedText } from '@/components/themed-text';
import { Surface } from '@/components/ui/surface';
import { Spacing } from '@/constants/theme';
import type { GalleryItem } from '@/features/moments/gallery';
import { formatMomentShortDate } from '@/features/moments/labels';
import { useThemeColor } from '@/hooks/use-theme-color';

export type GalleryMediaRowProps = {
  item: GalleryItem;
  /** Month the row belongs to, so its label stands on its own. */
  sectionLabel: string;
};

/**
 * A video or voice note, full width: the two kinds that need a transport
 * rather than a frame of their own. Above the media sits the same kind of
 * byline the feed prints — kind, date, who kept it — and beneath it the
 * memory's own title when it has one, so a clip is never anonymous.
 */
function GalleryMediaRowComponent({ item, sectionLabel }: GalleryMediaRowProps) {
  const muted = useThemeColor({}, 'muted');
  const kindLabel = item.kind === 'video' ? 'Video' : 'Voice';
  const date = formatMomentShortDate(item.occurredAt);
  const byline = useMemo(
    () => [kindLabel, date, item.authorName].filter((part) => !!part).join(' · '),
    [date, item.authorName, kindLabel],
  );
  // The player announces this: a title when the memory has one, otherwise
  // when and where the media sits, never just "video".
  const playerLabel = useMemo(() => {
    const context = date ? `${date}, ${sectionLabel}` : sectionLabel;
    return item.title ? `${item.title} (${context})` : context;
  }, [date, item.title, sectionLabel]);

  return (
    <View style={styles.row}>
      <ThemedText type="meta" style={{ color: muted }}>
        {byline}
      </ThemedText>
      {item.kind === 'video' ? (
        <VideoPlayer
          aspectRatio={16 / 9}
          label={playerLabel}
          posterUri={item.posterUri}
          uri={item.uri}
        />
      ) : (
        <Surface style={styles.voiceCard}>
          <AudioPlayer label={playerLabel} uri={item.uri} />
        </Surface>
      )}
      {item.title ? (
        <ThemedText type="bodyEmphasis" style={styles.title}>
          {item.title}
        </ThemedText>
      ) : null}
    </View>
  );
}

export const GalleryMediaRow = memo(GalleryMediaRowComponent);

const styles = StyleSheet.create({
  row: {
    gap: Spacing[8],
    paddingHorizontal: Spacing[24],
    // The grid rows below sit 2pt apart; a full-width line of the album keeps
    // the same rhythm with a little more air above it.
    paddingTop: Spacing[8],
    paddingBottom: Spacing[12],
  },
  voiceCard: {
    padding: Spacing[12],
  },
  title: {
    paddingTop: Spacing[4],
  },
});
