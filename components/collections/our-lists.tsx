import { useRouter, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { CollectionLink } from '@/components/collections/collection-link';
import { ItemCover } from '@/components/collections/item-tile';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ExpoButton, ExpoMenu } from '@/components/ui/expo-controls';
import { Surface } from '@/components/ui/surface';
import { collectionColorValue } from '@/constants/collection-colors';
import { Radii, Spacing } from '@/constants/theme';
import { useCollections } from '@/features/collections/collections-context';
import { listSummary, useListPreviews } from '@/features/collections/use-list-previews';
import { useAoiTheme } from '@/features/theme/theme-context';
import { useThemeColor } from '@/hooks/use-theme-color';

/**
 * The pair's lists — the Ours tab's whole body.
 *
 * Each list shows what is inside it before you open it: the first covers, and
 * how many of its things are done. A list is not a name, it is a shelf with
 * something on it. Creation opens its own sheet, and reordering only appears
 * once there is more than one list to order.
 */
export function OurLists({ onCreate }: { onCreate?: () => void }) {
  const router = useRouter();
  const {
    collections,
    isLoading,
    error,
    reload,
    moveCollection,
  } = useCollections();
  const previews = useListPreviews(collections);

  const muted = useThemeColor({}, 'muted');
  const accentInk = useThemeColor({}, 'accentInk');
  const border = useThemeColor({}, 'border');
  const { mode } = useAoiTheme();
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const danger = useThemeColor({}, 'danger');

  const openList = useCallback(
    (id: string) => {
      router.push(`/(app)/collection/${id}` as Href);
    },
    [router]
  );

  if (isLoading) {
    return (
      <View style={styles.state}>
        <ActivityIndicator color={accentInk} />
        <ThemedText accessibilityLiveRegion="polite" type="caption" style={{ color: muted }}>
          Loading your lists…
        </ThemedText>
      </View>
    );
  }

  if (error) {
    return (
      <Surface variant="raised" style={styles.empty}>
        <ThemedText accessibilityRole="alert" type="body">
          Your lists could not be loaded right now.
        </ThemedText>
        <Button label="Try again" onPress={() => void reload()} variant="secondary" />
      </Surface>
    );
  }

  if (collections.length === 0) {
    return (
      <View style={styles.emptyBlock}>
        <ThemedText type="body" style={{ color: muted }}>
          No lists yet. Name one, then add whatever belongs in it.
        </ThemedText>
        <ExpoButton label="New list" onPress={onCreate ?? (() => router.push('/(app)/collection/new'))} variant="secondary" />
      </View>
    );
  }

  // Reordering only makes sense with a neighbour to swap with.
  const canReorder = collections.length > 1;
  const move = async (id: string, direction: -1 | 1) => {
    if (moving) return;
    setMoving(true);
    setReorderError(null);
    try {
      await moveCollection(id, direction);
    } catch {
      setReorderError("Couldn't reorder your lists. Please try again.");
    } finally {
      setMoving(false);
    }
  };

  return (
    <View style={styles.shelves}>
      {collections.map((collection, index) => {
        const colorValue = collectionColorValue(collection.color, mode);
        const preview = previews[collection.id];
        const summary = listSummary(preview);
        const covers = (preview?.covers ?? []).flatMap((uri, coverIndex) =>
          uri ? [{ uri, title: preview?.titles[coverIndex] ?? collection.name }] : []
        );

        return (
          <View
            key={collection.id}
            style={[
              styles.row,
              index > 0
                ? { borderTopWidth: StyleSheet.hairlineWidth, borderColor: border }
                : null,
            ]}
          >
            <CollectionLink
              label={`${collection.name}, ${summary}`}
              onPress={() => openList(collection.id)}
              style={styles.rowMain}
            >
              <View style={[styles.covers, covers.length === 0 ? styles.emptyCovers : null]}>
                {covers.length === 0 ? (
                  <ItemCover colorValue={colorValue} style={styles.cover} title={collection.name} />
                ) : (
                  covers.map((cover, coverIndex) => (
                    <ItemCover
                      key={coverIndex}
                      colorValue={colorValue}
                      style={[styles.cover, coverIndex === 0 && covers.length > 1 ? styles.leadCover : null]}
                      title={cover.title}
                      uri={cover.uri}
                    />
                  ))
                )}
              </View>
              <View style={styles.rowText}>
                <ThemedText numberOfLines={2} type="subheading" style={styles.label}>
                  {collection.name}
                </ThemedText>
                <ThemedText accessible={false} type="caption" style={{ color: muted }}>
                  {summary}
                </ThemedText>
              </View>
            </CollectionLink>
            {canReorder ? (
              <View style={styles.shelfActions}>
                <ExpoMenu
                  label="•••"
                  accessibilityLabel={`Actions for ${collection.name}`}
                  disabled={moving}
                  actions={[
                    ...(index > 0 ? [{ id: 'up', title: 'Move up' }] : []),
                    ...(index < collections.length - 1 ? [{ id: 'down', title: 'Move down' }] : []),
                  ]}
                  onSelect={(id) => {
                    if (id === 'up' && index > 0) void move(collection.id, -1);
                    if (id === 'down' && index < collections.length - 1) void move(collection.id, 1);
                  }}
                />
              </View>
            ) : null}
          </View>
        );
      })}

      {reorderError ? (
        <ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>
          {reorderError}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    alignItems: 'flex-start',
    gap: Spacing[12],
  },
  emptyBlock: {
    alignItems: 'flex-start',
    gap: Spacing[12],
  },
  row: {
    position: 'relative',
    paddingTop: Spacing[24],
  },
  rowMain: {
    gap: Spacing[12],
  },
  covers: {
    flexDirection: 'row',
    gap: Spacing[4],
    height: 148,
  },
  emptyCovers: { height: 96 },
  leadCover: { flex: 1.6 },
  cover: {
    borderRadius: Radii.md,
    flex: 1,
    height: '100%',
  },
  rowText: {
    paddingRight: 88,
    gap: Spacing[4],
  },
  label: {
    flexShrink: 1,
  },
  shelfActions: { position: 'absolute', right: 0, bottom: 0 },
  shelves: { gap: Spacing[24] },
  state: {
    alignItems: 'center',
    gap: Spacing[12],
    paddingVertical: Spacing[24],
  },
});
