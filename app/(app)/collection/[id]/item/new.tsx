import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  EMPTY_ITEM_VALUES,
  ItemForm,
  type ItemFormValues,
} from '@/components/collections/item-form';
import { Spacing } from '@/constants/theme';
import { useCollections } from '@/features/collections/collections-context';

/**
 * Adding a thing to a list — its own page, pushed from the list. There is no
 * shared database to search, so the pair authors every entry here.
 */
export default function NewItemScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string }>();
  const collectionId = typeof params.id === 'string' ? params.id : undefined;

  const { createItem } = useCollections();

  const handleSubmit = useCallback(
    async (values: ItemFormValues) => {
      if (!collectionId) {
        return;
      }
      await createItem(collectionId, values);
      router.back();
    },
    [collectionId, createItem, router]
  );

  return (
    <>
      <Stack.Screen options={{ title: 'Add a thing' }} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing[32] }]}
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ItemForm
          initial={EMPTY_ITEM_VALUES}
          onCancel={() => router.back()}
          onSubmit={handleSubmit}
          submitLabel="Add"
        />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing[24],
    paddingTop: Spacing[24],
  },
});
