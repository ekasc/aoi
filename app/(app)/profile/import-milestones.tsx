import { Stack, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NativeDateTimeField } from '@/components/forms/native-date-time-field';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { Spacing } from '@/constants/theme';
import { useSpace } from '@/features/space/space-context';
import type {
  ImportedMilestoneInput,
  ImportedMilestoneType,
} from '@/features/space/types';
import { useThemeColor } from '@/hooks/use-theme-color';

type DraftMilestoneRow = {
  id: string;
  type: ImportedMilestoneType;
  title: string;
  body: string;
  occurredAt: Date;
  hasTargetDate: boolean;
  targetAt: Date;
};

const IMPORT_TYPES: ImportedMilestoneType[] = ['milestone', 'goal', 'date', 'note'];

function createDraftMilestoneRow(): DraftMilestoneRow {
  const now = new Date();
  const inThreeMonths = new Date(now);
  inThreeMonths.setMonth(inThreeMonths.getMonth() + 3);

  return {
    id: `draft_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    type: 'milestone',
    title: '',
    body: '',
    occurredAt: now,
    hasTargetDate: false,
    targetAt: inThreeMonths,
  };
}

export default function ImportMilestonesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isIos = process.env.EXPO_OS === 'ios';
  const { importMilestones } = useSpace();
  const border = useThemeColor({}, 'border');
  const surface2 = useThemeColor({}, 'surface2');
  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const danger = useThemeColor({}, 'danger');
  const accent = useThemeColor({}, 'accent');
  const onAccent = useThemeColor({}, 'onAccent');
  const background = useThemeColor({}, 'background');
  const [rows, setRows] = useState<DraftMilestoneRow[]>([createDraftMilestoneRow()]);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const inputStyle = useMemo(
    () => [
      styles.input,
      {
        borderColor: border,
        backgroundColor: surface2,
        color: text,
      },
    ],
    [border, surface2, text]
  );
  const contentContainerStyle = useMemo(
    () => [styles.contentContainer, { paddingBottom: insets.bottom + Spacing[24] }],
    [insets.bottom]
  );
  const footerStyle = useMemo(
    () => [styles.footer, { paddingBottom: insets.bottom + Spacing[12] }],
    [insets.bottom]
  );

  const updateRow = useCallback(
    (rowId: string, updater: (row: DraftMilestoneRow) => DraftMilestoneRow) => {
      setRows((currentRows) =>
        currentRows.map((row) => (row.id === rowId ? updater(row) : row))
      );
    },
    []
  );
  const addRow = useCallback(() => {
    setRows((currentRows) => [...currentRows, createDraftMilestoneRow()]);
  }, []);
  const removeRow = useCallback((rowId: string) => {
    setRows((currentRows) => currentRows.filter((row) => row.id !== rowId));
    setRowErrors((currentErrors) => {
      const nextErrors = { ...currentErrors };
      delete nextErrors[rowId];
      return nextErrors;
    });
  }, []);

  const handleSave = useCallback(async () => {
    const nextErrors: Record<string, string> = {};
    const preparedInputs: ImportedMilestoneInput[] = [];

    rows.forEach((row) => {
      const trimmedTitle = row.title.trim();
      const trimmedBody = row.body.trim();

      if (!trimmedTitle) {
        nextErrors[row.id] = 'Title is required.';
        return;
      }

      if (row.type === 'goal' && row.hasTargetDate) {
        const targetTime = row.targetAt.getTime();
        if (Number.isNaN(targetTime)) {
          nextErrors[row.id] = 'Choose a valid target date.';
          return;
        }
      }

      preparedInputs.push({
        type: row.type,
        title: trimmedTitle,
        body: trimmedBody || undefined,
        occurredAt: row.occurredAt.toISOString(),
        targetAt:
          row.type === 'goal' && row.hasTargetDate ? row.targetAt.toISOString() : null,
      });
    });

    setRowErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      setError('Fix the highlighted rows before continuing.');
      return;
    }

    if (preparedInputs.length === 0) {
      setError('Add at least one milestone.');
      return;
    }

    setError('');

    try {
      setIsSaving(true);
      await importMilestones(preparedInputs);
      router.back();
    } catch {
      setError('Unable to import milestones. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [importMilestones, router, rows]);

  return (
    <>
      <Stack.Screen options={{ title: 'Import milestones' }} />
      <KeyboardAvoidingView
        behavior={isIos ? 'padding' : undefined}
        style={[styles.root, { backgroundColor: background }]}
      >
        <ScrollView
          contentContainerStyle={contentContainerStyle}
          contentInsetAdjustmentBehavior="never"
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Surface variant="raised" style={styles.heroCard}>
            <ThemedText type="meta" style={{ color: muted }} selectable>
              Backfill history
            </ThemedText>
            <ThemedText type="title" selectable>
              Import milestones
            </ThemedText>
            <ThemedText type="caption" style={{ color: muted }} selectable>
              Add important entries from earlier chapters.
            </ThemedText>
          </Surface>

          {rows.map((row, index) => {
            const rowError = rowErrors[row.id];
            return (
              <Surface key={row.id} style={styles.rowCard}>
                <View style={styles.rowHeader}>
                  <ThemedText type="meta" selectable>
                    Entry {index + 1}
                  </ThemedText>
                  {rows.length > 1 ? (
                    <Button
                      accessibilityLabel={`Remove milestone ${index + 1}`}
                      label="Remove"
                      onPress={() => removeRow(row.id)}
                      size="sm"
                      variant="ghost"
                    />
                  ) : null}
                </View>

                <View style={styles.typeRow}>
                  {IMPORT_TYPES.map((candidate) => {
                    const isSelected = candidate === row.type;
                    return (
                      <Pressable
                        accessibilityLabel={`Set type ${candidate}`}
                        accessibilityRole="button"
                        key={candidate}
                        onPress={() =>
                          updateRow(row.id, (currentRow) => ({
                            ...currentRow,
                            type: candidate,
                            hasTargetDate:
                              candidate === 'goal' ? currentRow.hasTargetDate : false,
                          }))
                        }
                        style={[
                          styles.typeChip,
                          {
                            borderColor: isSelected ? accent : border,
                            backgroundColor: isSelected ? accent : surface2,
                          },
                        ]}
                      >
                        <ThemedText type="caption" style={{ color: isSelected ? onAccent : text }}>
                          {candidate}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </View>

                <TextInput
                  accessibilityLabel={`Title for entry ${index + 1}`}
                  autoCapitalize="sentences"
                  onChangeText={(value) =>
                    updateRow(row.id, (currentRow) => ({ ...currentRow, title: value }))
                  }
                  placeholder="Title"
                  placeholderTextColor={muted}
                  style={inputStyle}
                  value={row.title}
                />

                <TextInput
                  accessibilityLabel={`Details for entry ${index + 1}`}
                  autoCapitalize="sentences"
                  multiline
                  onChangeText={(value) =>
                    updateRow(row.id, (currentRow) => ({ ...currentRow, body: value }))
                  }
                  placeholder="Optional note"
                  placeholderTextColor={muted}
                  style={[inputStyle, styles.textArea]}
                  value={row.body}
                />

                <NativeDateTimeField
                  accessibilityLabel={`Choose occurred date for entry ${index + 1}`}
                  label="Occurred on"
                  mode="date"
                  onChange={(value) =>
                    updateRow(row.id, (currentRow) => ({ ...currentRow, occurredAt: value }))
                  }
                  value={row.occurredAt}
                />

                {row.type === 'goal' ? (
                  <View style={styles.goalBlock}>
                    <Pressable
                      accessibilityLabel="Toggle target date"
                      accessibilityRole="button"
                      onPress={() =>
                        updateRow(row.id, (currentRow) => ({
                          ...currentRow,
                          hasTargetDate: !currentRow.hasTargetDate,
                        }))
                      }
                      style={[
                        styles.targetToggle,
                        {
                          borderColor: row.hasTargetDate ? accent : border,
                          backgroundColor: row.hasTargetDate ? accent : surface2,
                        },
                      ]}
                    >
                      <ThemedText
                        type="caption"
                        style={{ color: row.hasTargetDate ? onAccent : text }}
                      >
                        {row.hasTargetDate ? 'Target date enabled' : 'No target date (Someday)'}
                      </ThemedText>
                    </Pressable>

                    {row.hasTargetDate ? (
                      <NativeDateTimeField
                        accessibilityLabel={`Choose target date for entry ${index + 1}`}
                        label="Target date"
                        mode="date"
                        onChange={(value) =>
                          updateRow(row.id, (currentRow) => ({
                            ...currentRow,
                            targetAt: value,
                          }))
                        }
                        value={row.targetAt}
                      />
                    ) : null}
                  </View>
                ) : null}

                {rowError ? (
                  <ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>
                    {rowError}
                  </ThemedText>
                ) : null}
              </Surface>
            );
          })}

          <Button label="Add another entry" onPress={addRow} variant="secondary" />

          {error ? (
            <ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>
              {error}
            </ThemedText>
          ) : null}
        </ScrollView>

        <View style={[footerStyle, { borderColor: border, backgroundColor: background }]}>
          <Button
            disabled={isSaving}
            label={isSaving ? 'Importing…' : 'Import entries'}
            onPress={handleSave}
          />
          <Button label="Cancel" onPress={() => router.back()} variant="secondary" />
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  contentContainer: {
    gap: Spacing[12],
    paddingHorizontal: Spacing[16],
    paddingTop: Spacing[16],
  },
  heroCard: {
    gap: Spacing[8],
  },
  rowCard: {
    gap: Spacing[8],
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing[8],
  },
  typeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[8],
  },
  typeChip: {
    minHeight: 44,
    minWidth: 44,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing[12],
    justifyContent: 'center',
    alignItems: 'center',
  },
  input: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: Spacing[12],
    paddingVertical: Spacing[12],
  },
  textArea: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  goalBlock: {
    gap: Spacing[8],
  },
  targetToggle: {
    minHeight: 44,
    minWidth: 44,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing[12],
    justifyContent: 'center',
    alignItems: 'center',
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing[16],
    paddingTop: Spacing[12],
    gap: Spacing[8],
  },
});
