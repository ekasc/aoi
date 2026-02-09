import { Stack, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
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
import { useThemeColor } from '@/hooks/use-theme-color';

export default function EditRelationshipScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isIos = process.env.EXPO_OS === 'ios';
  const { space, updateSpace } = useSpace();
  const border = useThemeColor({}, 'border');
  const surface2 = useThemeColor({}, 'surface2');
  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const danger = useThemeColor({}, 'danger');
  const background = useThemeColor({}, 'background');
  const [name, setName] = useState(space?.name ?? '');
  const [partnerName, setPartnerName] = useState(space?.partnerName ?? '');
  const [relationshipStartDate, setRelationshipStartDate] = useState(() =>
    space?.relationshipStartDate ? new Date(space.relationshipStartDate) : new Date()
  );
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const inputStyle = useMemo(
    () => [
      styles.input,
      { borderColor: border, backgroundColor: surface2, color: text },
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

  const handleSave = useCallback(async () => {
    const trimmedSpaceName = name.trim();
    const trimmedPartnerName = partnerName.trim();

    if (!trimmedSpaceName) {
      setError('Space name is required.');
      return;
    }

    if (!trimmedPartnerName) {
      setError('Partner name is required.');
      return;
    }

    setError('');

    try {
      setIsSaving(true);
      await updateSpace({
        name: trimmedSpaceName,
        partnerName: trimmedPartnerName,
        relationshipStartDate: relationshipStartDate.toISOString(),
      });
      router.back();
    } catch {
      setError('Unable to save. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [name, partnerName, relationshipStartDate, router, updateSpace]);

  if (!space) {
    return (
      <ScrollView
        style={{ backgroundColor: background }}
        contentContainerStyle={contentContainerStyle}
        contentInsetAdjustmentBehavior="never"
        keyboardDismissMode="interactive"
      >
        <Surface style={styles.section}>
          <ThemedText type="title">No relationship found</ThemedText>
          <ThemedText type="caption" style={{ color: muted }}>
            Set up your relationship first.
          </ThemedText>
          <Button label="Close" onPress={() => router.back()} />
        </Surface>
      </ScrollView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Edit relationship' }} />
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
          <Surface variant="raised" style={styles.section}>
            <ThemedText type="meta">Relationship details</ThemedText>
            <TextInput
              accessibilityLabel="Space name"
              autoCapitalize="words"
              onChangeText={(value) => {
                setName(value);
                setError('');
              }}
              placeholder="Space name"
              placeholderTextColor={muted}
              style={inputStyle}
              value={name}
            />
            <TextInput
              accessibilityLabel="Partner name"
              autoCapitalize="words"
              onChangeText={(value) => {
                setPartnerName(value);
                setError('');
              }}
              placeholder="Partner name"
              placeholderTextColor={muted}
              style={inputStyle}
              value={partnerName}
            />
            <ThemedText type="meta">Relationship start date</ThemedText>
            <NativeDateTimeField
              accessibilityLabel="Choose relationship start date"
              label="Start date"
              mode="date"
              onChange={(nextDate) => {
                setRelationshipStartDate(nextDate);
                setError('');
              }}
              value={relationshipStartDate}
            />
            <ThemedText type="caption" style={{ color: muted }} selectable>
              {relationshipStartDate.toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </ThemedText>

            {error ? (
              <ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>
                {error}
              </ThemedText>
            ) : null}
          </Surface>
        </ScrollView>

        <View style={[footerStyle, { borderColor: border, backgroundColor: background }]}>
          <Button
            disabled={isSaving}
            label={isSaving ? 'Saving…' : 'Save changes'}
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
    paddingHorizontal: Spacing[16],
    paddingTop: Spacing[16],
    gap: Spacing[12],
  },
  section: {
    gap: Spacing[8],
  },
  input: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: Spacing[12],
    paddingVertical: Spacing[12],
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing[16],
    paddingTop: Spacing[12],
    gap: Spacing[8],
  },
});
