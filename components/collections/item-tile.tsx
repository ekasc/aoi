import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { collectionStatusLabel } from '@/constants/collection-status';
import { Radii, Spacing, withAlpha } from '@/constants/theme';
import type { CollectionItem } from '@/features/collections/types';
import { useThemeColor } from '@/hooks/use-theme-color';

/**
 * A thing's cover: the photo when there is one, otherwise a block in the list's
 * colour carrying the thing's first letter. The placeholder is deliberately a
 * real design rather than an empty box, so a list with no photos yet still reads
 * as a catalogue.
 */
export function ItemCover({
  uri,
  title,
  colorValue,
  style,
}: {
  uri?: string | null;
  title: string;
  colorValue: string | null;
  style?: StyleProp<ViewStyle>;
}) {
  const surface2 = useThemeColor({}, 'surface2');
  const text = useThemeColor({}, 'text');
  const tint = colorValue ? withAlpha(colorValue, 0.2) : surface2;
  const initial = title.trim().charAt(0) || '·';

  return (
    <View style={[styles.cover, { backgroundColor: tint }, style]}>
      {uri ? (
        <Image
          accessible={false}
          contentFit="cover"
          source={{ uri }}
          style={styles.coverImage}
        />
      ) : (
        // The block carries the list's colour; the letter is drawn in the
        // theme's own ink. Drawing it in the colour put a mid-tone on a tint
        // of itself, which measured about 2.6:1 on the dark theme.
        <ThemedText
          accessible={false}
          type="title"
          style={[styles.coverInitial, { color: text }]}
        >
          {initial}
        </ThemedText>
      )}
    </View>
  );
}

/** The status and score line a thing carries, when it carries either. */
function ItemMeta({ item }: { item: CollectionItem }) {
  const muted = useThemeColor({}, 'muted');
  const textSecondary = useThemeColor({}, 'textSecondary');
  const statusLabel = collectionStatusLabel(item.status);
  const score = item.score ?? null;

  if (!statusLabel && score === null) {
    return null;
  }

  return (
    <View style={styles.meta}>
      {/* The status is a secondary ink, not the accent. Accent on every
          item's status, the selected filter and the add row at once meant the
          colour marked nothing in particular. */}
      {statusLabel ? (
        <ThemedText type="caption" style={{ color: textSecondary }}>
          {statusLabel}
        </ThemedText>
      ) : null}
      {statusLabel && score !== null ? (
        <ThemedText accessible={false} type="caption" style={{ color: muted }}>
          ·
        </ThemedText>
      ) : null}
      {score !== null ? (
        <View style={styles.score}>
          <Ionicons accessible={false} aria-hidden color={muted} name="star" size={11} />
          <ThemedText type="caption" style={{ color: muted }}>
            {score}/10
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

function accessibleNameFor(item: CollectionItem): string {
  const statusLabel = collectionStatusLabel(item.status);
  const score = item.score ?? null;
  const parts = [item.title];
  if (statusLabel) {
    parts.push(statusLabel);
  }
  if (score !== null) {
    parts.push(`scored ${score} of 10`);
  }
  return parts.join(', ');
}

/**
 * A thing as a cover tile, for the grid.
 *
 * Memoized, and the press handler takes the item rather than closing over it,
 * so a row re-renders only when its own thing changes. A catalogue that grows
 * re-renders its visible window on a keystroke; without this, every cover
 * redraws.
 */
export const ItemTile = memo(function ItemTile({
  item,
  colorValue,
  onPress,
}: {
  item: CollectionItem;
  colorValue: string | null;
  onPress: (item: CollectionItem) => void;
}) {
  const text = useThemeColor({}, 'text');

  return (
    <Pressable
      accessibilityLabel={accessibleNameFor(item)}
      accessibilityRole="button"
      onPress={() => onPress(item)}
      style={({ pressed }) => [styles.tile, pressed ? styles.pressed : undefined]}
    >
      <ItemCover
        colorValue={colorValue}
        style={styles.tileCover}
        title={item.title}
        uri={item.coverUrl}
      />
      {/* The caption block sits as one unit under the cover: a little air from
          the photo, none between the title and what qualifies it.

          The note stays out of the grid. It used to appear here only when a
          thing had neither a status nor a score, so the same thing showed its
          note or did not depending on an unrelated field. The grid is the
          cover wall — title and state; the note is prose, and lives in the
          list view and on the thing's own page. */}
      <View style={styles.tileCaption}>
        <ThemedText numberOfLines={2} type="subheading" style={{ color: text }}>
          {item.title}
        </ThemedText>
        <ItemMeta item={item} />
      </View>
    </Pressable>
  );
});

/** A thing as a dense row, for the list view. */
export const ItemListRow = memo(function ItemListRow({
  item,
  colorValue,
  onPress,
  divider,
}: {
  item: CollectionItem;
  colorValue: string | null;
  onPress: (item: CollectionItem) => void;
  divider: boolean;
}) {
  const muted = useThemeColor({}, 'muted');
  const border = useThemeColor({}, 'border');
  const text = useThemeColor({}, 'text');

  return (
    <Pressable
      accessibilityLabel={accessibleNameFor(item)}
      accessibilityRole="button"
      onPress={() => onPress(item)}
      style={({ pressed }) => [
        styles.row,
        divider ? { borderTopWidth: StyleSheet.hairlineWidth, borderColor: border } : null,
        pressed ? styles.pressed : undefined,
      ]}
    >
      <ItemCover
        colorValue={colorValue}
        style={styles.rowCover}
        title={item.title}
        uri={item.coverUrl}
      />
      <View style={styles.rowBody}>
        <ThemedText numberOfLines={1} type="bodyEmphasis" style={{ color: text }}>
          {item.title}
        </ThemedText>
        <ItemMeta item={item} />
        {item.note ? (
          <ThemedText numberOfLines={1} type="caption" style={{ color: muted }}>
            {item.note}
          </ThemedText>
        ) : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  cover: {
    alignItems: 'center',
    borderCurve: 'continuous',
    borderRadius: Radii.md,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  coverImage: {
    height: '100%',
    width: '100%',
  },
  coverInitial: {
    fontSize: 28,
    fontWeight: '400',
  },
  meta: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing[4],
  },
  score: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing[4],
  },
  tile: {
    gap: Spacing[8],
  },
  tileCaption: {
    gap: Spacing[4],
  },
  tileCover: {
    aspectRatio: 0.88,
    width: '100%',
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing[12],
    minHeight: 92,
    paddingVertical: Spacing[12],
  },
  rowCover: {
    height: 72,
    width: 60,
  },
  rowBody: {
    flex: 1,
    gap: Spacing[4],
  },
  pressed: {
    opacity: 0.6,
  },
});
