import { Ionicons } from '@expo/vector-icons';
import { PARTNER_DETAIL_TEXT_MAX_LENGTH } from '@aoi/shared';
import { Stack } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { PaperTextInput } from '@/components/ui/text-input';
import { Radii, Spacing } from '@/constants/theme';
import { usePartnerDetails } from '@/features/partner-details/partner-details-context';
import type { PartnerDetail, PartnerDetailCategory } from '@/features/partner-details/types';
import { useSpace } from '@/features/space/space-context';
import { useThemeColor } from '@/hooks/use-theme-color';

/**
 * A partner's portrait, built from small things.
 *
 * This is the rebuilt "little things": instead of a settings row, the partner
 * in Space opens a portrait you add to. The entry is the person, the content
 * is the details, and the page keeps an empty state that invites one detail
 * rather than a blank list.
 */

const CATEGORY_LABELS: Record<PartnerDetailCategory, string> = {
  favorite: 'Favorites',
  habit: 'Habits',
  quirk: 'Quirks',
  words: 'Their words',
  other: 'Details',
};

const CATEGORY_CHIPS: { value: PartnerDetailCategory; label: string }[] = [
  { value: 'favorite', label: 'Favorite' },
  { value: 'habit', label: 'Habit' },
  { value: 'quirk', label: 'Quirk' },
  { value: 'words', label: 'Their words' },
  { value: 'other', label: 'Detail' },
];

const CATEGORY_ORDER: PartnerDetailCategory[] = ['favorite', 'habit', 'quirk', 'words', 'other'];

/** Prompt rotation: a small nudge, always one step ahead of what is written. */
const DETAIL_PROMPTS = [
  'Their coffee order',
  'The song that is theirs',
  'The way they laugh',
  'A phrase they always say',
  'What they wear on lazy days',
  'How they take their tea',
  'The film they always return to',
];

export default function PartnerPortraitScreen() {
  const insets = useSafeAreaInsets();
  const isIos = process.env.EXPO_OS === 'ios';
  const { details, isLoading, error, reload, addDetail, removeDetail } = usePartnerDetails();
  const { space } = useSpace();
  const background = useThemeColor({}, 'background');
  const surface = useThemeColor({}, 'surface');
  const surface2 = useThemeColor({}, 'surface2');
  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const border = useThemeColor({}, 'border');
  const accentInk = useThemeColor({}, 'accentInk');
  const danger = useThemeColor({}, 'danger');
  const [draft, setDraft] = useState('');
  const [category, setCategory] = useState<PartnerDetailCategory>('other');
  const [isSaving, setIsSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const partnerName = space?.partnerName ?? 'them';
  const trimmedDraft = draft.trim();
  const canSave = trimmedDraft.length > 0 && !isSaving && !isLoading && !error;
  const prompt = DETAIL_PROMPTS[details.length % DETAIL_PROMPTS.length];

  const grouped = useMemo(
    () =>
      CATEGORY_ORDER.map((value) => ({
        value,
        items: details.filter((detail) => detail.category === value),
      })).filter((group) => group.items.length > 0),
    [details],
  );

  const handleSave = useCallback(async () => {
    if (!canSave) return;
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
      void removeDetail(detailId).catch(() =>
        setActionError('Could not remove this detail. Try again.'),
      );
    },
    [removeDetail],
  );

  const header = (
    <View style={styles.intro}>
      <ThemedText type="caption" style={{ color: muted }}>
        A portrait in small things — the details you notice.
      </ThemedText>
    </View>
  );

  return (
    <KeyboardAvoidingView
      behavior={isIos ? 'padding' : undefined}
      style={[styles.root, { backgroundColor: background }]}
    >
      <Stack.Screen options={{ title: `About ${partnerName}` }} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + Spacing[40] },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {header}

        <View style={[styles.promptCard, { backgroundColor: surface, borderColor: border }]}>
          <ThemedText type="meta" style={{ color: muted }}>
            Something to notice
          </ThemedText>
          <ThemedText type="subheading" selectable>
            {prompt}
          </ThemedText>
        </View>

        <View style={styles.composer}>
          <PaperTextInput
            accessibilityLabel={`Add a detail about ${partnerName}`}
            label={`Add a detail about ${partnerName}`}
            maxLength={PARTNER_DETAIL_TEXT_MAX_LENGTH}
            multiline
            onChangeText={setDraft}
            placeholder="The small thing you don't want to forget"
            value={draft}
          />
          <View style={styles.chips}>
            {CATEGORY_CHIPS.map((chip) => {
              const selected = chip.value === category;
              return (
                <Pressable
                  accessibilityLabel={chip.label}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  key={chip.value}
                  onPress={() => setCategory(chip.value)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: selected ? accentInk : surface2,
                      borderColor: border,
                    },
                  ]}
                >
                  <ThemedText
                    type="caption"
                    style={{ color: selected ? background : text, fontWeight: '600' }}
                  >
                    {chip.label}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
          <Button
            disabled={!canSave}
            label={isSaving ? 'Saving…' : 'Add detail'}
            onPress={() => void handleSave()}
          />
          {actionError ? (
            <ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>
              {actionError}
            </ThemedText>
          ) : null}
        </View>

        {isLoading ? (
          <View style={styles.state}>
            <ActivityIndicator />
            <ThemedText type="caption" style={{ color: muted }}>
              Loading what you have noticed…
            </ThemedText>
          </View>
        ) : error ? (
          <View style={styles.state}>
            <ThemedText accessibilityRole="alert" type="body" style={{ color: danger }}>
              {error}
            </ThemedText>
            <Button label="Try again" onPress={reload} variant="secondary" />
          </View>
        ) : grouped.length === 0 ? (
          <View style={styles.state}>
            <ThemedText type="body" style={{ color: muted, textAlign: 'center' }}>
              Nothing here yet. Start with the first thing you think of when
              you think of {partnerName}.
            </ThemedText>
          </View>
        ) : (
          grouped.map((group) => (
            <View key={group.value} style={styles.group}>
              <ThemedText type="meta" style={[styles.groupHeading, { color: muted }]}>
                {CATEGORY_LABELS[group.value]}
              </ThemedText>
              <View style={[styles.groupBody, { backgroundColor: surface, borderColor: border }]}>
                {group.items.map((detail, index) => (
                  <DetailRow
                    key={detail.id}
                    detail={detail}
                    dividerColor={border}
                    first={index === 0}
                    muted={muted}
                    text={text}
                    onRemove={handleRemove}
                  />
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function DetailRow({
  detail,
  dividerColor,
  first,
  muted,
  text,
  onRemove,
}: {
  detail: PartnerDetail;
  dividerColor: string;
  first: boolean;
  muted: string;
  text: string;
  onRemove: (id: string) => void;
}) {
  return (
    <View
      style={[
        styles.detailRow,
        first ? null : { borderTopWidth: StyleSheet.hairlineWidth, borderColor: dividerColor },
      ]}
    >
      <ThemedText selectable type="body" style={[styles.detailText, { color: text }]}>
        {detail.text}
      </ThemedText>
      <Pressable
        accessibilityLabel={`Remove detail: ${detail.text}`}
        accessibilityRole="button"
        hitSlop={8}
        onPress={() => onRemove(detail.id)}
        style={styles.remove}
      >
        <Ionicons color={muted} name="close-circle" size={20} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: {
    gap: Spacing[24],
    paddingHorizontal: Spacing[24],
    paddingTop: Spacing[16],
  },
  intro: { gap: Spacing[4] },
  promptCard: {
    borderRadius: Radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing[4],
    padding: Spacing[16],
  },
  composer: { gap: Spacing[12] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing[8] },
  chip: {
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: Spacing[12],
  },
  state: {
    alignItems: 'center',
    gap: Spacing[12],
    paddingVertical: Spacing[24],
  },
  group: { gap: Spacing[8] },
  groupHeading: {
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  groupBody: {
    borderRadius: Radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  detailRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: Spacing[12],
    minHeight: 52,
    paddingHorizontal: Spacing[16],
    paddingVertical: Spacing[12],
  },
  detailText: { flex: 1 },
  remove: { paddingTop: 2 },
});
