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

import { ThemedText } from '@/components/themed-text';
import { Divider } from '@/components/ui/divider';
import { Surface } from '@/components/ui/surface';
import { Spacing } from '@/constants/theme';
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
  const { details, addDetail, removeDetail } = usePartnerDetails();
  const { space } = useSpace();
  const accent = useThemeColor({}, 'accent');
  const border = useThemeColor({}, 'border');
  const background = useThemeColor({}, 'background');
  const muted = useThemeColor({}, 'muted');
  const surface = useThemeColor({}, 'surface');
  const text = useThemeColor({}, 'text');
  const [draft, setDraft] = useState('');
  const [category, setCategory] = useState<PartnerDetailCategory>('other');
  const [isSaving, setIsSaving] = useState(false);

  const partnerName = space?.partnerName ?? 'them';
  const trimmedDraft = draft.trim();
  const canSave = trimmedDraft.length > 0 && !isSaving;

  const handleSave = useCallback(async () => {
    if (!canSave) {
      return;
    }

    setIsSaving(true);

    try {
      await addDetail({ text: trimmedDraft, category });
      setDraft('');
      setCategory('other');
    } finally {
      setIsSaving(false);
    }
  }, [addDetail, canSave, category, trimmedDraft]);

  const handleRemove = useCallback(
    (detailId: string) => {
      void removeDetail(detailId);
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
            multiline
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
                      style={{ color: isActive ? '#FFFFFF' : muted }}
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
            <ThemedText type="meta" style={{ color: '#FFFFFF' }}>
              Keep it
            </ThemedText>
          </Pressable>
        </Surface>

        {details.length === 0 ? (
          <Surface style={styles.promptCard}>
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
        ) : (
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
        )}
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
    fontSize: 17,
    lineHeight: 24,
    minHeight: 48,
  },
  categoryRow: {
    gap: Spacing[8],
  },
  categoryChip: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: Spacing[12],
    paddingVertical: 6,
  },
  saveButton: {
    alignItems: 'center',
    borderRadius: 22,
    paddingVertical: Spacing[12],
  },
  promptCard: {
    padding: Spacing[16],
  },
  promptDivider: {
    marginVertical: Spacing[12],
  },
  promptRow: {
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
