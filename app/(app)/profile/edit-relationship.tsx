import { Stack, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NativeDateTimeField } from '@/components/forms/native-date-time-field';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Divider } from '@/components/ui/divider';
import { Spacing } from '@/constants/theme';
import { useSpace } from '@/features/space/space-context';
import { parseRelationshipStart } from '@/features/calendar/calendar-date-utils';
import { buildRelationshipUpdateInput } from '@/features/space/update-input';
import { useThemeColor } from '@/hooks/use-theme-color';

export default function EditRelationshipScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { space, updateSpace } = useSpace();
  const border = useThemeColor({}, 'border');
  const surface2 = useThemeColor({}, 'surface2');
  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const danger = useThemeColor({}, 'danger');
  const background = useThemeColor({}, 'background');
  const [name, setName] = useState(space?.name ?? '');
  const [partnerName, setPartnerName] = useState(space?.partnerName ?? '');
  const [relationshipStartDate, setRelationshipStartDate] = useState<Date | null>(() =>
    space?.relationshipStartDate ? parseRelationshipStart(space.relationshipStartDate) : null
  );
  const [relationshipDateChanged, setRelationshipDateChanged] = useState(false);
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [contentHeight, setContentHeight] = useState<number>();
  const handleContentSizeChange = useCallback((_width: number, height: number) => {
    setContentHeight(height);
  }, []);

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
      await updateSpace(
        buildRelationshipUpdateInput(
          trimmedSpaceName,
          trimmedPartnerName,
          relationshipDateChanged ? relationshipStartDate : null,
        ),
      );
      router.back();
    } catch {
      setError('Unable to save. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [name, partnerName, relationshipDateChanged, relationshipStartDate, router, updateSpace]);

  if (!space) {
    return (
      <View
        style={[styles.centered, { backgroundColor: background }]}
      >
        <ThemedText type="display" style={styles.hero}>No relationship found</ThemedText>
        <ThemedText type="caption" style={{ color: muted }}>
          Set up your relationship first.
        </ThemedText>
        <Button label="Close" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Edit relationship' }} />
        <ScrollView
          testID="relationship-form"
          style={[styles.scroll, { backgroundColor: background, height: contentHeight }]}
          onContentSizeChange={handleContentSizeChange}
          contentContainerStyle={contentContainerStyle}
          contentInsetAdjustmentBehavior="automatic"
          automaticallyAdjustKeyboardInsets
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.section}>
            <ThemedText type="label">
              Space name
            </ThemedText>
            <TextInput
              accessibilityLabel="Space name"
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="next"
              onChangeText={(value) => {
                setName(value);
                setError('');
              }}
              placeholder="Space name"
              placeholderTextColor={muted}
              style={inputStyle}
              value={name}
            />
            <ThemedText type="label">
              Partner name
            </ThemedText>
            <TextInput
              accessibilityLabel="Partner name"
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="done"
              onChangeText={(value) => {
                setPartnerName(value);
                setError('');
              }}
              placeholder="Partner name"
              placeholderTextColor={muted}
              style={inputStyle}
              value={partnerName}
            />
          </View>

          <Divider />

          <View style={styles.section}>
            {relationshipStartDate ? (
              <NativeDateTimeField
                accessibilityLabel="Choose relationship start date"
                label="Relationship start date (optional)"
                mode="date"
                textColor={text}
                onChange={(nextDate) => {
                  setRelationshipStartDate(nextDate);
                  setRelationshipDateChanged(true);
                  setError('');
                }}
                value={relationshipStartDate}
              />
            ) : (
              <Button
                label="Add relationship start date"
                onPress={() => {
                  setRelationshipStartDate(new Date());
                  setRelationshipDateChanged(true);
                  setError('');
                }}
                variant="secondary"
              />
            )}
            {!relationshipStartDate ? (
              <ThemedText type="caption" style={{ color: muted }}>
                Optional. Used for milestones and photo discovery.
              </ThemedText>
            ) : null}

            {error ? (
              <ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>
                {error}
              </ThemedText>
            ) : null}
          </View>
        <View style={[footerStyle, { borderColor: border, backgroundColor: background }]}>
          <Button
            disabled={isSaving}
            label={isSaving ? 'Saving…' : 'Save changes'}
            onPress={handleSave}
          />
          <Button label="Cancel" onPress={() => router.back()} variant="secondary" />
        </View>
        </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing[24],
    paddingBottom: Spacing[24],
    gap: Spacing[12],
  },
  contentContainer: {
    paddingHorizontal: Spacing[24],
    paddingTop: Spacing[16],
    gap: Spacing[32],
  },
  hero: {
    letterSpacing: -0.6,
    fontWeight: '400',
    marginBottom: Spacing[4],
    flexWrap: 'wrap',
  },
  section: {
    gap: Spacing[12],
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
    paddingTop: Spacing[12],
    gap: Spacing[8],
  },
});
