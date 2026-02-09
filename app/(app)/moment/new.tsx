import { Stack, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { Spacing } from '@/constants/theme';
import { useMoments } from '@/features/moments/moments-context';
import { useSession } from '@/features/session/session-context';
import type { MomentType } from '@/features/moments/types';
import { useThemeColor } from '@/hooks/use-theme-color';

type MomentTypeOption = {
  value: MomentType;
  label: string;
  disabled?: boolean;
};

const MOMENT_TYPES: MomentTypeOption[] = [
  { value: 'note', label: 'Note' },
  { value: 'milestone', label: 'Milestone' },
  { value: 'date', label: 'Date' },
  { value: 'goal', label: 'Goal' },
  { value: 'media', label: 'Media', disabled: true },
];

export default function NewMomentScreen() {
  const router = useRouter();
  const { addMoment } = useMoments();
  const { user } = useSession();
  const border = useThemeColor({}, 'border');
  const accent = useThemeColor({}, 'accent');
  const onAccent = useThemeColor({}, 'onAccent');
  const surface2 = useThemeColor({}, 'surface2');
  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const danger = useThemeColor({}, 'danger');
  const background = useThemeColor({}, 'background');

  const [type, setType] = useState<MomentType>('note');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');

  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();
  const canSubmit = trimmedTitle.length > 0 || trimmedBody.length > 0;

  const inputStyle = useMemo(
    () => [
      styles.input,
      {
        backgroundColor: surface2,
        borderColor: border,
        color: text,
      },
    ],
    [border, surface2, text]
  );
  const textAreaStyle = useMemo(() => [inputStyle, styles.textArea], [inputStyle]);
  const errorStyle = useMemo(() => [styles.error, { color: danger }], [danger]);
  const mutedStyle = useMemo(() => [styles.muted, { color: muted }], [muted]);

  const handleCancel = useCallback(() => {
    router.back();
  }, [router]);

  const handleSave = useCallback(() => {
    if (!canSubmit) {
      setError('Add a title or note before saving.');
      return;
    }

    addMoment({
      type,
      title: trimmedTitle,
      body: trimmedBody,
      occurredAt: new Date().toISOString(),
      authorId: user?.id ?? 'user_you',
      authorRole: 'you',
      authorName: user?.displayName ?? 'You',
    });

    router.back();
  }, [addMoment, canSubmit, router, trimmedBody, trimmedTitle, type, user]);

  return (
    <>
      <Stack.Screen options={{ title: 'Add moment' }} />
      <ScrollView
        style={{ backgroundColor: background }}
        contentContainerStyle={styles.contentContainer}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Surface variant="raised" style={styles.section}>
          <ThemedText type="meta">Type</ThemedText>
          <View style={styles.typeGrid}>
            {MOMENT_TYPES.map((option) => {
              const selected = option.value === type;
              return (
                <Pressable
                  accessibilityLabel={`Moment type ${option.label}`}
                  accessibilityRole="button"
                  disabled={option.disabled}
                  key={option.value}
                  onPress={() => {
                    setType(option.value);
                    setError('');
                  }}
                  style={({ pressed }) => [
                    styles.typeChip,
                    {
                      borderColor: selected ? accent : border,
                      backgroundColor: selected ? accent : surface2,
                    },
                    option.disabled ? styles.typeChipDisabled : undefined,
                    pressed && !option.disabled ? styles.typeChipPressed : undefined,
                  ]}
                >
                  <ThemedText
                    type="caption"
                    style={[
                      styles.typeLabel,
                      { color: selected ? onAccent : text },
                      option.disabled ? styles.typeLabelDisabled : undefined,
                    ]}
                  >
                    {option.label}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </Surface>

        <Surface style={styles.section}>
          <ThemedText type="meta">Title</ThemedText>
          <TextInput
            accessibilityLabel="Moment title"
            autoCapitalize="sentences"
            onChangeText={setTitle}
            placeholder="What was it?"
            placeholderTextColor={muted}
            style={inputStyle}
            value={title}
          />
          <ThemedText type="meta">Note</ThemedText>
          <TextInput
            accessibilityLabel="Moment note"
            autoCapitalize="sentences"
            multiline
            onChangeText={setBody}
            placeholder="The details you'll want later"
            placeholderTextColor={muted}
            style={textAreaStyle}
            textAlignVertical="top"
            value={body}
          />
          <ThemedText type="caption" style={mutedStyle}>
            Saved on {new Date().toLocaleDateString('en-US')}
          </ThemedText>
          {error ? (
            <ThemedText accessibilityRole="alert" type="caption" style={errorStyle}>
              {error}
            </ThemedText>
          ) : null}
        </Surface>

        <View style={styles.actions}>
          <Button label="Save moment" onPress={handleSave} />
          <Button label="Cancel" onPress={handleCancel} variant="secondary" />
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  contentContainer: {
    paddingHorizontal: Spacing[16],
    paddingTop: Spacing[16],
    paddingBottom: Spacing[40],
    gap: Spacing[12],
  },
  section: {
    gap: Spacing[8],
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[8],
  },
  typeChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  typeChipPressed: {
    opacity: 0.92,
  },
  typeChipDisabled: {
    opacity: 0.5,
  },
  typeLabel: {
    fontWeight: '600',
  },
  typeLabelDisabled: {
    textDecorationLine: 'line-through',
  },
  input: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: Spacing[12],
    paddingVertical: Spacing[12],
  },
  textArea: {
    minHeight: 116,
  },
  muted: {
    marginTop: 2,
  },
  error: {
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[8],
  },
});
