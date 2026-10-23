import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

  const { collections, isLoading, updateCollection, deleteCollection } = useCollections();

  const muted = useThemeColor({}, 'muted');
  const danger = useThemeColor({}, 'danger');
  const accentInk = useThemeColor({}, 'accentInk');

  const collection = useMemo(
    () => collections.find((row) => row.id === collectionId),
    [collectionId, collections]
  );

  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const mountedRef = useRef(false);
  const focusRef = useRef<symbol | null>(null);
  const removingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useFocusEffect(useCallback(() => {
    focusRef.current = Symbol();
    return () => { focusRef.current = null; };
  }, []));

  const handleRemove = useCallback(async () => {
    if (!collectionId || removingRef.current || !mountedRef.current) {
      return;
    }
    removingRef.current = true;
    const focus = focusRef.current;
    setIsRemoving(true);
    setRemoveError(null);
    try {
      await deleteCollection(collectionId);
      if (mountedRef.current && focus !== null && focusRef.current === focus) router.dismissTo('/(app)/(tabs)/ours');
    } catch {
      if (mountedRef.current) setRemoveError("Couldn't remove this list. Please try again.");
    } finally {
      removingRef.current = false;
      if (mountedRef.current) setIsRemoving(false);
    }
  }, [collectionId, deleteCollection, router]);

  const handleSubmit = useCallback(
    async (values: ListFormValues) => {
      if (!collectionId) {
        return;
      }
      const focus = focusRef.current;
      await updateCollection(collectionId, { name: values.name, color: values.color });
      if (mountedRef.current && focus !== null && focusRef.current === focus) router.back();
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
        <View style={styles.removeSection}>
          {confirmingRemove ? (
            <>
              <ThemedText type="bodyEmphasis">Remove “{collection.name}”?</ThemedText>
              <ThemedText type="caption" style={{ color: muted }}>
                This removes the list and everything in it for both of you.
              </ThemedText>
              {removeError ? (
                <ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>
                  {removeError}
                </ThemedText>
              ) : null}
              <View style={styles.removeActions}>
                <Button
                  accessibilityLabel={`Confirm remove ${collection.name}`}
                  disabled={isRemoving}
                  label={isRemoving ? 'Removing…' : 'Remove list'}
                  onPress={() => void handleRemove()}
                  variant="destructive"
                />
                <Button
                  disabled={isRemoving}
                  label="Keep"
                  onPress={() => setConfirmingRemove(false)}
                  variant="secondary"
                />
              </View>
            </>
          ) : (
            <Button
              label="Remove list"
              onPress={() => setConfirmingRemove(true)}
              variant="secondary"
            />
          )}
        </View>
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
  removeSection: {
    gap: Spacing[12],
    marginTop: Spacing[32],
  },
  removeActions: {
    flexDirection: 'row',
    gap: Spacing[12],
  },
});
