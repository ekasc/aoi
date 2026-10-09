import { Stack, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ListForm, type ListFormValues } from '@/components/collections/list-form';
import { Spacing } from '@/constants/theme';
import { useCollections } from '@/features/collections/collections-context';

export default function NewListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { createCollection } = useCollections();

  const handleCreate = useCallback(async (values: ListFormValues) => {
    await createCollection(values);
    router.back();
  }, [createCollection, router]);

  return (
    <>
      <Stack.Screen options={{ title: 'New list' }} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing[24] }]}
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
      >
        <ListForm
          nativeHeaderActions
          onCancel={() => router.back()}
          onSubmit={handleCreate}
          submitLabel="Create"
        />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing[24], paddingTop: Spacing[24] },
});
