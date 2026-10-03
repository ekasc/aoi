import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
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
import { PARTNER_DETAIL_TEXT_MAX_LENGTH } from '@aoi/shared';

import { ThemedText } from '@/components/themed-text';
import { Divider } from '@/components/ui/divider';
import { Surface } from '@/components/ui/surface';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { Typography } from "@/constants/typography";
import {
  usePartnerDetails,
} from '@/features/partner-details/partner-details-context';
import type {
  PartnerDetail,
  PartnerDetailCategory,
} from '@/features/partner-details/types';
import { useSpace } from '@/features/space/space-context';
import { useThemeColor } from '@/hooks/use-theme-color';

const CATEGORY_LABELS: Record<PartnerDetailCategory, string> = {
  favorite: 'Favorite',
  habit: 'Habit',
  quirk: 'Quirk',
  words: 'Their words',
  other: 'Detail',
};

/** Small prompts to spark a detail — never demanding, just inviting. */
const DETAIL_PROMPTS = [
  'Their coffee order',
  'The song that is theirs',
  'The way they laugh',
  'A phrase they always say',
  'What they wear on lazy days',
];

function DetailRow({
  detail,
  muted,
  text,
  onRemove,
}: {
  detail: PartnerDetail;
  muted: string;
  text: string;
  onRemove: (detailId: string) => void;
}) {
  return (
    <View style={styles.detailRow}>
      <View style={styles.detailTextBlock}>
        <ThemedText type="meta" style={{ color: muted }}>
          {CATEGORY_LABELS[detail.category]}
        </ThemedText>
        <ThemedText type="body" selectable style={{ color: text }}>
          {detail.text}
        </ThemedText>
      </View>
      <Pressable
        accessibilityLabel={`Remove detail: ${detail.text}`}
        accessibilityRole="button"
        hitSlop={8}
        onPress={() => onRemove(detail.id)}
      >
        <Ionicons color={muted} name="close-circle" size={20} />
      </Pressable>
    </View>
  );
}

/**
 * The little things: a living portrait of the partner built from tiny,
 * concrete details. When you think of someone, you think of details.
 */
export default function LittleThingsScreen() {
  const insets = useSafeAreaInsets();
  const isIos = process.env.EXPO_OS === 'ios';
  const { details, isLoading, error, reload, addDetail, removeDetail } = usePartnerDetails();
  const { space } = useSpace();
  const accent = useThemeColor({}, 'accent');
  const border = useThemeColor({}, 'border');
  const background = useThemeColor({}, 'background');
  const muted = useThemeColor({}, 'muted');
  const onAccent = useThemeColor({}, 'onAccent');
  const surface = useThemeColor({}, 'surface');
  const text = useThemeColor({}, 'text');
  const [draft, setDraft] = useState('');
  const [category, setCategory] = useState<PartnerDetailCategory>('other');
  const [isSaving, setIsSaving] = useState(false);

  const partnerName = space?.partnerName ?? 'them';
  const trimmedDraft = draft.trim();
  const canSave = trimmedDraft.length > 0 && !isSaving && !isLoading && !error;
  const [actionError, setActionError] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    if (!canSave) {
      return;
    }

    setIsSaving(true);
    setActionError(null);

    try {
      await addDetail({ text: trimmedDraft, category });
      setDraft('');
      setCategory('other');
    } catch {
      setActionError('Could not save this detail. Your words are still here.');
    } finally {
      setIsSaving(false);
    }
  }, [addDetail, canSave, category, trimmedDraft]);

  const handleRemove = useCallback(
    (detailId: string) => {
      setActionError(null);
      void removeDetail(detailId).catch(() => setActionError('Could not remove this detail. Try again.'));
    },
    [removeDetail]
  );

  const contentContainerStyle = useMemo(
    () => [
      styles.contentContainer,
      {
        paddingTop: Spacing[16],
        paddingBottom: insets.bottom + Spacing[24],
      },
    ],
    [insets.bottom]
  );

  return (
    <KeyboardAvoidingView
      behavior={isIos ? 'padding' : undefined}
      style={[styles.root, { backgroundColor: background }]}
    >
      <Stack.Screen options={{ title: 'The little things' }} />
      <ScrollView
        contentContainerStyle={contentContainerStyle}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ThemedText type="caption" style={{ color: muted }}>
          The small details that make {partnerName} who they are. Keep them
          here, one at a time.
        </ThemedText>

        <Surface style={styles.composer}>
          <TextInput
            accessibilityLabel="A small thing about them"
            multiline
            maxLength={PARTNER_DETAIL_TEXT_MAX_LENGTH}
            onChangeText={setDraft}
            placeholder="One small thing about them…"
            placeholderTextColor={muted}
            style={[styles.input, { color: text }]}
            value={draft}
          />
          <ScrollView
            contentContainerStyle={styles.categoryRow}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {(Object.keys(CATEGORY_LABELS) as PartnerDetailCategory[]).map(
              (value) => {
                const isActive = category === value;

                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: isActive }}
                    key={value}
                    onPress={() => setCategory(value)}
                    style={[
                      styles.categoryChip,
                      {
                        backgroundColor: isActive ? accent : surface,
                        borderColor: isActive ? accent : border,
                      },
                    ]}
                  >
                    <ThemedText
                      type="meta"
                      style={{ color: isActive ? onAccent : muted }}
                    >
                      {CATEGORY_LABELS[value]}
                    </ThemedText>
                  </Pressable>
                );
              }
            )}
          </ScrollView>
          <Pressable
            accessibilityLabel="Save this detail"
            accessibilityRole="button"
            disabled={!canSave}
            onPress={() => void handleSave()}
            style={[
              styles.saveButton,
              { backgroundColor: accent, opacity: canSave ? 1 : 0.4 },
            ]}
          >
            <ThemedText type="meta" style={{ color: onAccent }}>
              Keep it
            </ThemedText>
          </Pressable>
        </Surface>

        {actionError ? (
          <ThemedText accessibilityRole="alert" type="caption" style={{ color: muted }}>
            {actionError}
          </ThemedText>
        ) : null}
        {error ? (
          <View style={{ gap: Spacing[8] }}>
            <ThemedText accessibilityRole="alert" type="caption" style={{ color: muted }}>
              {error}
            </ThemedText>
            <Button label="Try again" onPress={reload} variant="secondary" size="sm" />
          </View>
        ) : null}
        {isLoading ? (
          <ThemedText accessibilityLiveRegion="polite" type="caption" style={{ color: muted }}>
            Loading details…
          </ThemedText>
        ) : null}
        {!isLoading && !error && details.length === 0 ? (
          <Surface style={styles.promptCard}>
            <ThemedText accessibilityLiveRegion="polite" type="body" style={{ color: muted }}>
              No details yet.
            </ThemedText>
            <ThemedText type="meta" style={{ color: muted }}>
              Need a spark?
            </ThemedText>
            <Divider style={styles.promptDivider} />
            {DETAIL_PROMPTS.map((prompt) => (
              <Pressable
                accessibilityRole="button"
                key={prompt}
                onPress={() => setDraft(prompt)}
                style={styles.promptRow}
              >
                <ThemedText type="body" style={{ color: text }}>
                  {prompt}
                </ThemedText>
              </Pressable>
            ))}
          </Surface>
        ) : details.length > 0 ? (
          <Surface style={styles.listCard}>
            {details.map((detail, index) => (
              <View key={detail.id}>
                {index > 0 ? <Divider /> : null}
                <DetailRow
                  detail={detail}
                  muted={muted}
                  onRemove={handleRemove}
                  text={text}
                />
              </View>
            ))}
          </Surface>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  contentContainer: {
    gap: Spacing[16],
    paddingHorizontal: Spacing[16],
  },
  composer: {
    gap: Spacing[12],
    padding: Spacing[16],
  },
  input: {
    ...Typography.subheading,
    minHeight: 48,
  },
  categoryRow: {
    gap: Spacing[8],
  },
  categoryChip: {
    borderRadius: 16,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing[12],
    paddingVertical: 6,
  },
  saveButton: {
    alignItems: 'center',
    borderRadius: 22,
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: Spacing[12],
  },
  promptCard: {
    padding: Spacing[16],
  },
  promptDivider: {
    marginVertical: Spacing[12],
  },
  promptRow: {
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: Spacing[8],
  },
  listCard: {
    padding: Spacing[16],
  },
  detailRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing[12],
    paddingVertical: Spacing[12],
  },
  detailTextBlock: {
    flex: 1,
    gap: 2,
  },
});
