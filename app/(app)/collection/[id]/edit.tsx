import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ListForm, type ListFormValues } from '@/components/collections/list-form';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { useCollections } from '@/features/collections/collections-context';
import { useThemeColor } from '@/hooks/use-theme-color';

/**
 * Renaming and recolouring a list — its own page, reached from the list's
 * header, so the list screen itself stays a browsing surface.
 */
export default function EditListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string }>();
  const collectionId = typeof params.id === 'string' ? params.id : undefined;

  const { collections, isLoading, updateCollection } = useCollections();

  const muted = useThemeColor({}, 'muted');
  const accentInk = useThemeColor({}, 'accentInk');

  const collection = useMemo(
    () => collections.find((row) => row.id === collectionId),
    [collectionId, collections]
  );

  const handleSubmit = useCallback(
    async (values: ListFormValues) => {
      if (!collectionId) {
        return;
      }
      await updateCollection(collectionId, { name: values.name, color: values.color });
      router.back();
    },
    [collectionId, router, updateCollection]
  );

  if (!collection && isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={accentInk} />
        <ThemedText accessibilityLiveRegion="polite" type="caption" style={{ color: muted }}>
          Loading list…
        </ThemedText>
      </View>
    );
  }

  if (!collection) {
    return (
      <View style={styles.centered}>
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

  return (
    <>
      <Stack.Screen options={{ title: 'Edit list' }} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing[32] }]}
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ListForm
          initialColor={collection.color ?? null}
          initialName={collection.name}
          onCancel={() => router.back()}
          onSubmit={handleSubmit}
          submitLabel="Save"
        />
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
    paddingHorizontal: Spacing[24],
    paddingTop: Spacing[24],
  },
});
