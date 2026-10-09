import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ItemForm,
  itemToFormValues,
  type ItemFormValues,
} from '@/components/collections/item-form';
import { ThemedText } from '@/components/themed-text';
import { ExpoButton } from '@/components/ui/expo-controls';
import { Spacing } from '@/constants/theme';
import { isExternalLink } from '@/features/collections/collection-link';
import { useCollections } from '@/features/collections/collections-context';
import type { CollectionItem } from '@/features/collections/types';
import { useThemeColor } from '@/hooks/use-theme-color';

/**
 * One thing's own page: what it is, and the way to change or remove it.
 *
 * Editing lives here rather than inside the list, so the list stays a browsing
 * surface. The page is pushed, so the back button and the swipe both return to
 * the list, which re-reads itself on focus.
 */
export default function EditItemScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string; itemId?: string }>();
  const collectionId = typeof params.id === 'string' ? params.id : undefined;
  const itemId = typeof params.itemId === 'string' ? params.itemId : undefined;

  const { listItems, updateItem, deleteItem } = useCollections();

  const muted = useThemeColor({}, 'muted');
  const accentInk = useThemeColor({}, 'accentInk');
  const danger = useThemeColor({}, 'danger');

  const [item, setItem] = useState<CollectionItem | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!collectionId || !itemId) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await listItems(collectionId);
        if (!cancelled) {
          setItem(loaded.find((row) => row.id === itemId) ?? null);
          setLoadError(false);
        }
      } catch {
        if (!cancelled) {
          setLoadError(true);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [collectionId, itemId, listItems, reloadTick]);

  const handleSave = useCallback(
    async (values: ItemFormValues) => {
      if (!itemId) {
        return;
      }
      await updateItem(itemId, values);
      router.back();
    },
    [itemId, router, updateItem]
  );

  const handleRemove = useCallback(async () => {
    if (!collectionId || !itemId) {
      return;
    }
    setActionError(null);
    try {
      await deleteItem(collectionId, itemId);
      router.back();
    } catch {
      setActionError("Couldn't remove this thing. Please try again.");
    }
  }, [collectionId, deleteItem, itemId, router]);

  const openLink = useCallback((link: string) => {
    void Linking.openURL(link).catch(() => setActionError("Couldn't open that link."));
  }, []);

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={accentInk} />
        <ThemedText accessibilityLiveRegion="polite" type="caption" style={{ color: muted }}>
          Loading…
        </ThemedText>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.centered}>
        <ThemedText accessibilityRole="alert" type="body" style={{ color: muted }}>
          This thing could not be loaded right now.
        </ThemedText>
        <ExpoButton
          label="Try again"
          onPress={() => {
            setIsLoading(true);
            setReloadTick((tick) => tick + 1);
          }}
          variant="secondary"
        />
      </View>
    );
  }

  if (!item) {
    return (
      <View style={styles.centered}>
        <ThemedText type="title" style={{ color: muted }}>
          Not here any more
        </ThemedText>
        <ThemedText type="caption" style={{ color: muted }}>
          It may have been removed from the list.
        </ThemedText>
        <ExpoButton label="Back" onPress={() => router.back()} variant="secondary" />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: item.title }} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing[32] }]}
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ItemForm
          a11yPrefix="Edit "
          initial={itemToFormValues(item)}
          onCancel={() => router.back()}
          onSubmit={handleSave}
          submitLabel="Save"
        />

        {item.link ? (
          isExternalLink(item.link) ? (
            <ExpoButton
              accessibilityLabel={`Open link: ${item.link}`}
              label="Open link"
              onPress={() => openLink(item.link as string)}
              variant="secondary"
            />
          ) : (
            <ThemedText type="caption" style={{ color: muted }}>
              {item.link}
            </ThemedText>
          )
        ) : null}

        {actionError ? (
          <ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>
            {actionError}
          </ThemedText>
        ) : null}

        {confirmingRemove ? (
          <View style={styles.confirmRow}>
            <ThemedText type="caption" style={{ color: muted }}>
              Remove “{item.title}” from the list?
            </ThemedText>
            <View style={styles.actions}>
              <ExpoButton
                accessibilityLabel={`Confirm remove ${item.title}`}
                label="Remove"
                onPress={() => void handleRemove()}
                variant="destructive"
              />
              <ExpoButton
                label="Keep"
                onPress={() => setConfirmingRemove(false)}
                variant="secondary"
              />
            </View>
          </View>
        ) : (
          <ExpoButton
            label="Remove from list"
            onPress={() => {
              if (Platform.OS === 'web') {
                setConfirmingRemove(true);
                return;
              }
              Alert.alert('Remove from list?', `Remove “${item.title}” from this list?`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Remove', style: 'destructive', onPress: () => void handleRemove() },
              ]);
            }}
            variant="destructive"
          />
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    flex: 1,
    gap: Spacing[12],
    justifyContent: 'center',
    padding: Spacing[24],
  },
  content: {
    gap: Spacing[16],
    paddingHorizontal: Spacing[24],
    paddingTop: Spacing[16],
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing[8],
  },
  confirmRow: {
    gap: Spacing[8],
  },
});
