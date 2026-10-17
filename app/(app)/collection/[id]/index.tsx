import { Ionicons } from '@expo/vector-icons';
import {
  Stack,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
  type Href,
} from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SelectedFilters } from '@/components/collections/selected-filters';
import { FilterMenu } from '@/components/collections/filter-menu';
import { ItemListRow, ItemTile, nextCollectionStatus } from '@/components/collections/item-tile';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { GlassSurface } from '@/components/ui/glass-surface';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { collectionColorValue } from '@/constants/collection-colors';
import { sortCollectionItems, type CollectionSort } from '@/constants/collection-sort';
import {
  COLLECTION_STATUS_LABELS,
  type CollectionFilter,
} from '@/constants/collection-status';
import { Elevation, Spacing, shadow, withAlpha } from '@/constants/theme';
import { useCollections } from '@/features/collections/collections-context';
import { COLLECTION_ITEM_TITLE_MAX, type CollectionItem } from '@/features/collections/types';
import { haptics } from '@/features/haptics/haptics';
import { useAoiTheme } from '@/features/theme/theme-context';
import { useThemeColor } from '@/hooks/use-theme-color';

/**
 * A list, as a page rather than a sheet.
 *
 * Browsing plus two fast paths: a thing's status flips in place on its tile,
 * and a title-only quick add sits above the catalogue for rapid capture.
 * Anything beyond that — annotating, scoring, covering, or removing a thing —
 * happens on the thing's own page, so the full add form behind the add button
 * stays the place for curation.
 *
 * Things are re-read whenever the screen regains focus, which is how an edit
 * made on a thing's page shows up here on the way back.
 */
/** The floating add button, the same size the other screens use. */
const FAB_SIZE = 56;

/** The air between grid rows, rendered as the list's own row separator. */
function GridRowGap() {
  return <View style={styles.gridRowGap} />;
}

export default function CollectionDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string }>();
  const collectionId = typeof params.id === 'string' ? params.id : undefined;

  const { collections, isLoading, listItems, updateItem, createItem } =
    useCollections();

  const muted = useThemeColor({}, 'muted');
  const accentInk = useThemeColor({}, 'accentInk');
  const accent = useThemeColor({}, 'accent');
  const background = useThemeColor({}, 'background');
  const text = useThemeColor({}, 'text');
  const shadowColor = useThemeColor({}, 'shadow');
  const danger = useThemeColor({}, 'danger');
  const { mode } = useAoiTheme();
  const isIos = process.env.EXPO_OS === 'ios';

  const collection = useMemo(
    () => collections.find((row) => row.id === collectionId),
    [collectionId, collections]
  );

  const [items, setItems] = useState<CollectionItem[]>([]);
  const [itemsError, setItemsError] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [loadedTick, setLoadedTick] = useState<number | null>(null);
  const itemsLoading = Boolean(collectionId) && loadedTick !== reloadTick;

  const [actionError, setActionError] = useState<string | null>(null);
  const [filter, setFilter] = useState<CollectionFilter>('all');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [sort, setSort] = useState<CollectionSort>('added');
  const [statusSavingIds, setStatusSavingIds] = useState<string[]>([]);
  const [quickTitle, setQuickTitle] = useState('');
  const [isQuickSaving, setIsQuickSaving] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);
  const quickInputRef = useRef<TextInput>(null);

  useFocusEffect(
    useCallback(() => {
      if (!collectionId) {
        return;
      }
      let cancelled = false;
      void (async () => {
        try {
          const loaded = await listItems(collectionId);
          if (!cancelled) {
            setItems(loaded);
            setItemsError(false);
          }
        } catch {
          if (!cancelled) {
            setItemsError(true);
          }
        } finally {
          if (!cancelled) {
            setLoadedTick(reloadTick);
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [collectionId, listItems, reloadTick])
  );

  const counts = useMemo(() => {
    const next: Record<CollectionFilter, number> = {
      all: items.length,
      want: 0,
      doing: 0,
      done: 0,
    };
    items.forEach((item) => {
      if (item.status) {
        next[item.status] += 1;
      }
    });
    return next;
  }, [items]);

  const visible = useMemo(
    () =>
      sortCollectionItems(
        filter === 'all' ? items : items.filter((item) => item.status === filter),
        sort
      ),
    [filter, items, sort]
  );


  const collectionPathId = collection?.id;
  const itemPath = useCallback(
    (suffix: string) => `/(app)/collection/${collectionPathId ?? ''}/${suffix}` as Href,
    [collectionPathId]
  );
  // The tiles are memoized, so the press handler has to keep one identity for
  // the whole screen: a fresh closure each render would redraw every cover.
  const openItem = useCallback(
    (item: CollectionItem) => router.push(itemPath(`item/${item.id}`)),
    [itemPath, router]
  );
  // A tap on a thing's status moves it one step along Want → Doing → Done,
  // optimistically: the tile flips at once, and a failed write puts it back
  // and says so, through the same update path the thing's own page uses.
  const handleToggleStatus = useCallback(
    async (item: CollectionItem) => {
      const next = nextCollectionStatus(item.status);
      const previous = item.status;
      setStatusSavingIds((ids) => [...ids, item.id]);
      setItems((current) =>
        current.map((row) => (row.id === item.id ? { ...row, status: next } : row))
      );
      try {
        const updated = await updateItem(item.id, { status: next });
        setItems((current) =>
          current.map((row) =>
            row.id === item.id ? { ...row, status: updated.status ?? next } : row
          )
        );
      } catch {
        setItems((current) =>
          current.map((row) => (row.id === item.id ? { ...row, status: previous } : row))
        );
        setActionError(`Couldn't save “${item.title}”. Please try again.`);
        haptics.error();
      } finally {
        setStatusSavingIds((ids) => ids.filter((id) => id !== item.id));
      }
    },
    [updateItem]
  );
  // Title-only entry for rapid capture: one field that stays focused, so
  // adding N things costs N taps instead of N form round trips. Anything
  // beyond a title stays on the thing's own page, behind the add button.
  const handleQuickAdd = useCallback(async () => {
    const title = quickTitle.trim();
    if (!collectionId || title.length === 0 || isQuickSaving) {
      return;
    }
    setIsQuickSaving(true);
    setQuickError(null);
    try {
      const created = await createItem(collectionId, { title });
      haptics.success();
      setItems((current) => [...current, created]);
      // A filtered list would swallow the new thing — it has no status yet —
      // so the catalogue resets to everything the entry lands in.
      setFilter('all');
      setQuickTitle('');
      quickInputRef.current?.focus();
    } catch {
      // Keep the draft: a failed write must not cost what was typed.
      setQuickError("Couldn't save this item. Your draft is still here.");
      haptics.error();
    } finally {
      setIsQuickSaving(false);
    }
  }, [collectionId, createItem, isQuickSaving, quickTitle]);
  // One list over rows, not things: the grid is a pair per row and the list is
  // one, and either way only the rows in view mount. Three hundred things stop
  // being three hundred covers at once.
  const rows = useMemo(() => {
    if (view === 'list') {
      return visible.map((item) => [item]);
    }
    const chunked: CollectionItem[][] = [];
    for (let index = 0; index < visible.length; index += 2) {
      chunked.push(visible.slice(index, index + 2));
    }
    return chunked;
  }, [view, visible]);

  if (!collection && isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: background }]}>
        <ActivityIndicator color={accentInk} />
        <ThemedText accessibilityLiveRegion="polite" type="caption" style={{ color: muted }}>
          Loading list…
        </ThemedText>
      </View>
    );
  }

  if (!collection) {
    return (
      <View style={[styles.centered, { backgroundColor: background }]}>
        <ThemedText type="title" style={{ color: muted }}>
          List not found
        </ThemedText>
        <ThemedText type="caption" style={{ color: muted }}>
          It may have been removed.
        </ThemedText>
        <Button label="Back" onPress={() => router.back()} variant="secondary" />
      </View>
    );
  }

  const colorValue = collectionColorValue(collection.color, mode);
  // The FAB has no tab bar to clear — this is a pushed screen — so it sits one
  // margin above the bottom inset, and the content clears it plus its height.
  const fabBottom = insets.bottom + Spacing[24];
  const fabClearance = fabBottom + FAB_SIZE + Spacing[16];

  const renderItem = ({ item: row, index }: { item: CollectionItem[]; index: number }) => {
    if (view === 'list') {
      return (
        <ItemListRow
          colorValue={colorValue}
          divider={index > 0}
          item={row[0]}
          onPress={openItem}
          onToggleStatus={handleToggleStatus}
          statusSaving={statusSavingIds.includes(row[0].id)}
        />
      );
    }
    return (
      <View style={styles.gridRow}>
        {row.map((item) => (
          <View key={item.id} style={styles.gridCell}>
            <ItemTile
              colorValue={colorValue}
              item={item}
              onPress={openItem}
              onToggleStatus={handleToggleStatus}
              statusSaving={statusSavingIds.includes(item.id)}
            />
          </View>
        ))}
        {row.length === 1 ? <View style={styles.gridCell} /> : null}
      </View>
    );
  };

  const keyExtractor = (row: CollectionItem[]) => row.map((item) => item.id).join('|');

  // The controls only exist once there are things to control. While loading or
  // after a failed read there is nothing to filter or re-view, so the header
  // stays empty rather than offering switches that do nothing.
  const showControls = items.length > 0 && !itemsLoading && !itemsError;
  // The quick add only needs the list to be readable. It stays up for an
  // empty list too, so the first thing lands without a round trip.
  const showQuickAdd = !itemsLoading && !itemsError;

  const viewSwitch = (
    <View style={styles.viewSwitch}>
      <SegmentedControl
        accessibilityLabel="List view"
        onChange={setView}
        size="compact"
        options={[
          { value: 'grid', label: 'Grid', icon: 'grid-outline', accessibilityHint: 'Show items in a grid' },
          { value: 'list', label: 'List', icon: 'list-outline', accessibilityHint: 'Show items in a list' },
        ]}
        value={view}
      />
    </View>
  );

  const header =
    actionError || showControls ? (
      <View style={styles.header}>
        {actionError ? (
          <ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>
            {actionError}
          </ThemedText>
        ) : null}

        {showControls ? (
          /* Browsing controls live below the navigation title so long names fit. */
          <View style={styles.browseHeader}>
            <View style={styles.browseTools}>
              {viewSwitch}
              <FilterMenu
                counts={counts}
                filter={filter}
                onFilterChange={setFilter}
                onSortChange={setSort}
                sort={sort}
              />
            </View>
            <SelectedFilters
              counts={counts}
              filter={filter}
              onFilterChange={setFilter}
              onSortChange={setSort}
              sort={sort}
            />
          </View>
        ) : null}
      </View>
    ) : null;

  const empty = itemsLoading ? (
    <View style={styles.state}>
      <ActivityIndicator color={accentInk} />
      <ThemedText accessibilityLiveRegion="polite" type="caption" style={{ color: muted }}>
        Loading items…
      </ThemedText>
    </View>
  ) : itemsError ? (
    <View style={styles.state}>
      <ThemedText accessibilityRole="alert" type="body" style={{ color: muted }}>
        These items could not be loaded right now.
      </ThemedText>
      <Button
        label="Try again"
        onPress={() => setReloadTick((tick) => tick + 1)}
        variant="secondary"
      />
    </View>
  ) : items.length === 0 ? (
    <View style={styles.emptyBlock}>
      <ThemedText type="body" style={{ color: text }}>
        Nothing in this list yet.
      </ThemedText>
      {/* An empty list is the one place with room to say what a list is for, so
          it teaches the shape of a thing rather than reporting an absence. */}
      <ThemedText type="caption" style={{ color: muted }}>
        Add a film, a place, a recipe. Mark each one Want, Doing or Done as you go.
      </ThemedText>
    </View>
  ) : (
    <ThemedText type="body" style={{ color: muted }}>
      {filter === 'all'
        ? 'Nothing in this list yet.'
        : `Nothing marked ${COLLECTION_STATUS_LABELS[filter]} yet.`}
    </ThemedText>
  );



  return (
    <>
      <Stack.Screen
        options={{
          title: collection.name,
          headerBackTitle: 'Lists',
          // iOS gets real toolbar buttons; everywhere else keeps the
          // cross-platform header view. Native where native exists, and never
          // a custom text element doing a title's job.
          ...(isIos
            ? null
            : {
                headerRight: () => (
                  <View style={styles.headerActions}>
                    <Pressable
                      accessibilityLabel="Edit list"
                      accessibilityRole="button"
                      onPress={() => router.push(itemPath('edit'))}
                      style={styles.headerAction}
                    >
                      <ThemedText type="body" style={{ color: accentInk }}>
                        Edit
                      </ThemedText>
                    </Pressable>
                  </View>
                ),
              }),
        }}
      />
      {/* Editing stays in the chrome; the full add form stays behind the FAB
          below, the same floating button the other screens use, so curation
          lands under a thumb instead of at the end of the content. Titles
          alone go through the quick add above the catalogue. */}
      {isIos ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button onPress={() => router.push(itemPath('edit'))}>
            Edit
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      ) : null}
      <View style={[styles.page, { backgroundColor: background }]}>
        {showQuickAdd ? (
          <View style={styles.quickAdd}>
            <View style={styles.quickAddRow}>
              <TextInput
                accessibilityLabel="Quick add an item"
                editable={!isQuickSaving}
                maxLength={COLLECTION_ITEM_TITLE_MAX}
                onChangeText={(value) => {
                  setQuickTitle(value);
                  if (quickError) {
                    setQuickError(null);
                  }
                }}
                onSubmitEditing={() => void handleQuickAdd()}
                placeholder={`Add to ${collection.name}…`}
                ref={quickInputRef}
                returnKeyType="done"
                style={[styles.quickInput, { borderColor: muted, color: text }]}
                value={quickTitle}
              />
              <Button
                accessibilityLabel="Quick add"
                disabled={quickTitle.trim().length === 0 || isQuickSaving}
                label={isQuickSaving ? 'Adding…' : 'Add'}
                onPress={() => void handleQuickAdd()}
                size="sm"
                variant="secondary"
              />
            </View>
            {quickError ? (
              <ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>
                {quickError}
              </ThemedText>
            ) : null}
          </View>
        ) : null}
        <FlatList
          ItemSeparatorComponent={view === 'grid' ? GridRowGap : undefined}
          ListEmptyComponent={empty}
          ListHeaderComponent={header}
          contentContainerStyle={[styles.content, { paddingBottom: fabClearance }]}
          contentInsetAdjustmentBehavior="automatic"
          data={rows}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
        />
        <Pressable
          accessibilityHint="Adds an item to this list"
          accessibilityLabel="Add an item"
          accessibilityRole="button"
          onPress={() => router.push(itemPath('item/new'))}
          style={({ pressed }) => [
            styles.fab,
            {
              bottom: fabBottom,
              boxShadow: shadow(Elevation.floating, shadowColor),
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <GlassSurface
            effect="clear"
            style={[
              styles.fabGlass,
              {
                backgroundColor: withAlpha(
                  accent,
                  process.env.EXPO_OS === 'ios' ? 0.25 : 0.6
                ),
              },
            ]}
          >
            <Ionicons accessible={false} aria-hidden color={accent} name="add" size={26} />
          </GlassSurface>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  // The same floating add button the Memories and Plans tabs use: tinted glass
  // over a shaped container, on the shared floating elevation.
  fab: {
    alignItems: 'center',
    borderRadius: FAB_SIZE / 2,
    height: FAB_SIZE,
    justifyContent: 'center',
    position: 'absolute',
    right: Spacing[24],
    width: FAB_SIZE,
  },
  fabGlass: {
    alignItems: 'center',
    alignSelf: 'stretch',
    borderRadius: FAB_SIZE / 2,
    flex: 1,
    justifyContent: 'center',
  },
  // One rhythm for the page: a tight cluster of controls, then generous
  // separation between it, the things, and the actions at the foot. The
  // spacing lives on the header and footer rather than a container gap, so it
  // holds whether the list has rows or only an empty state.
  content: {
    paddingHorizontal: Spacing[24],
    paddingTop: Spacing[16],
  },
  // One field and its button, pinned above the catalogue so rapid entry never
  // scrolls away. The field names the list it feeds, modelling what goes in.
  quickAdd: {
    gap: Spacing[8],
    paddingBottom: Spacing[12],
    paddingHorizontal: Spacing[24],
    paddingTop: Spacing[8],
  },
  quickAddRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing[12],
  },
  quickInput: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    flex: 1,
    minHeight: 44,
    paddingVertical: Spacing[8],
  },
  header: {
    gap: Spacing[12],
    marginBottom: Spacing[24],
  },
  browseHeader: { gap: Spacing[8] },
  browseTools: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing[12],
  },
  viewSwitch: {
    width: 116,
    minHeight: 44,
    justifyContent: 'center',
  },
  // The add row and the destructive action, held apart by the block's own gap.
  foot: {
    gap: Spacing[32],
    marginTop: Spacing[24],
  },
  centered: {
    alignItems: 'center',
    flex: 1,
    gap: Spacing[12],
    justifyContent: 'center',
    padding: Spacing[24],
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing[4],
  },
  headerAction: {
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: Spacing[8],
  },
  // Rows are separated more than columns: each tile carries a caption, and
  // that caption belongs to the cover above it, not the cover below.
  gridRow: {
    flexDirection: 'row',
    gap: Spacing[12],
  },
  gridRowGap: {
    height: Spacing[24],
  },
  gridCell: {
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing[8],
  },
  removeBlock: {
    gap: Spacing[8],
  },
  emptyBlock: {
    gap: Spacing[8],
  },
  state: {
    alignItems: 'center',
    gap: Spacing[12],
    paddingVertical: Spacing[16],
  },
});
