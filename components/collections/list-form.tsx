import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ExpoButton, ExpoField } from '@/components/ui/expo-controls';
import {
  COLLECTION_COLOR_LABELS,
  collectionColorValue,
} from '@/constants/collection-colors';
import { Radii, Spacing } from '@/constants/theme';
import {
  COLLECTION_COLORS,
  COLLECTION_NAME_MAX,
  type CollectionColor,
} from '@/features/collections/types';
import { useAoiTheme } from '@/features/theme/theme-context';
import { useThemeColor } from '@/hooks/use-theme-color';

export type ListFormValues = {
  name: string;
  color: CollectionColor | null;
};

type ListFormProps = {
  initialName?: string;
  initialColor?: CollectionColor | null;
  submitLabel: string;
  onSubmit: (values: ListFormValues) => Promise<void>;
  onCancel?: () => void;
  /** Clear the draft after a successful submit, for a reusable add form. */
  resetOnSuccess?: boolean;
  nativeHeaderActions?: boolean;
};

/**
 * A list is a name and a colour. There is no emoji and no other decoration:
 * the colour is the list's mark, chosen from a small fixed palette.
 */
export function ListForm({
  initialName = '',
  initialColor = null,
  submitLabel,
  onSubmit,
  onCancel,
  resetOnSuccess = false,
  nativeHeaderActions = false,
}: ListFormProps) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState<CollectionColor | null>(initialColor);
  const [isSaving, setIsSaving] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);

  const { mode } = useAoiTheme();
  const danger = useThemeColor({}, 'danger');
  const border = useThemeColor({}, 'border');
  const surface2 = useThemeColor({}, 'surface2');
  const text = useThemeColor({}, 'text');

  const trimmedName = name.trim();
  const useHeaderActions = nativeHeaderActions && process.env.EXPO_OS === 'ios';
  const canSubmit = trimmedName.length > 0 && !isSaving;

  const handleSubmit = async () => {
    if (!canSubmit) {
      return;
    }

    setWriteError(null);
    setIsSaving(true);

    try {
      await onSubmit({ name: trimmedName, color });
      if (resetOnSuccess) {
        setName('');
        setColor(null);
      }
    } catch {
      // Keep the draft: the reader's words are not lost to a network blip.
      setWriteError("Couldn't save this list. Your draft is still here.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={styles.form}>
      {useHeaderActions ? (
        <>
          <Stack.Screen options={{ gestureEnabled: !isSaving }} />
          <Stack.Toolbar placement="left">
            <Stack.Toolbar.Button disabled={isSaving} onPress={onCancel}>Cancel</Stack.Toolbar.Button>
          </Stack.Toolbar>
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.Button variant="done" disabled={!canSubmit} onPress={() => void handleSubmit()}>
              {isSaving ? 'Creating…' : submitLabel}
            </Stack.Toolbar.Button>
          </Stack.Toolbar>
        </>
      ) : null}
      <ExpoField
        accessibilityLabel="List name"
        editable={!isSaving}
        label="List name"
        maxLength={COLLECTION_NAME_MAX}
        onChangeText={setName}
        placeholder="Films to watch"
        value={name}
      />

      <View style={styles.colorGroup}>
        <ThemedText type="supporting">Colour</ThemedText>
        <View style={styles.colorRow}>
          <Pressable
            accessibilityLabel="No colour"
            accessibilityRole="button"
            accessibilityState={{ selected: color === null, disabled: isSaving }}
            disabled={isSaving}
            onPress={() => setColor(null)}
            style={[
              styles.swatch,
              { borderColor: color === null ? text : border, backgroundColor: surface2 },
            ]}
          >
            <ThemedText accessible={false} type="caption" style={{ color: text }}>
              —
            </ThemedText>
          </Pressable>
          {COLLECTION_COLORS.map((choice) => {
            const selected = color === choice;
            const value = collectionColorValue(choice, mode) ?? text;
            return (
              <Pressable
                key={choice}
                accessibilityLabel={COLLECTION_COLOR_LABELS[choice]}
                accessibilityRole="button"
                accessibilityState={{ selected, disabled: isSaving }}
                disabled={isSaving}
                onPress={() => setColor(choice)}
                style={[
                  styles.swatch,
                  { borderColor: selected ? text : border },
                ]}
              >
                <View
                  accessible={false}
                  style={[styles.swatchDot, { backgroundColor: value }]}
                />
              </Pressable>
            );
          })}
        </View>
      </View>

      {writeError ? (
        <ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>
          {writeError}
        </ThemedText>
      ) : null}

      {!useHeaderActions ? <View style={styles.actions}>
        <ExpoButton
          disabled={!canSubmit}
          label={isSaving ? 'Saving…' : submitLabel}
          variant="primary"
          onPress={() => void handleSubmit()}
        />
        {onCancel ? (
          <ExpoButton
            disabled={isSaving}
            label="Cancel"
            onPress={onCancel}
            variant="secondary"
          />
        ) : null}
      </View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: Spacing[24],
  },
  colorGroup: {
    gap: Spacing[8],
  },
  colorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[8],
  },
  swatch: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
    borderRadius: Radii.pill,
    borderCurve: 'continuous',
    borderWidth: 2,
  },
  swatchDot: {
    width: 22,
    height: 22,
    borderRadius: Radii.pill,
  },
  actions: {
    flexWrap: 'wrap',
    flexDirection: 'row',
    gap: Spacing[8],
  },
});
