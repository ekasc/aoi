import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { CoverPicker } from '@/components/media/cover-picker';
import { ThemedText } from '@/components/themed-text';
import { ExpoButton, ExpoField, ExpoMenu } from '@/components/ui/expo-controls';
import {
  COLLECTION_STATUS_LABELS,
  COLLECTION_STATUS_ORDER,
} from '@/constants/collection-status';
import { Spacing } from '@/constants/theme';
import {
  COLLECTION_ITEM_NOTE_MAX,
  COLLECTION_ITEM_TITLE_MAX,
  COLLECTION_LINK_MAX,
  COLLECTION_SCORE_MAX,
  type CollectionItem,
  type CollectionStatus,
} from '@/features/collections/types';
import { useThemeColor } from '@/hooks/use-theme-color';

export type ItemFormValues = {
  title: string;
  note: string | null;
  link: string | null;
  coverUrl: string | null;
  status: CollectionStatus | null;
  score: number | null;
};

/** A blank thing, for the page that adds one. */
export const EMPTY_ITEM_VALUES: ItemFormValues = {
  title: '',
  note: null,
  link: null,
  coverUrl: null,
  status: null,
  score: null,
};

/** An existing thing, in the form's own shape. */
export function itemToFormValues(item: CollectionItem): ItemFormValues {
  return {
    title: item.title,
    note: item.note ?? null,
    link: item.link ?? null,
    coverUrl: item.coverUrl ?? null,
    status: item.status ?? null,
    score: item.score ?? null,
  };
}

/**
 * One thing in a list: a title, a cover, how far along it is, and a score out of
 * ten. Reused for adding and for editing, so the two can never drift.
 *
 * Native menus retain the selected value; explicit clearing choices keep
 * an accidental repeat selection from erasing it.
 */
export function ItemForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  a11yPrefix = 'Item ',
}: {
  initial: ItemFormValues;
  submitLabel: string;
  onSubmit: (values: ItemFormValues) => Promise<void>;
  onCancel?: () => void;
  /** Distinguishes the inline add form from an item's edit form for a reader. */
  a11yPrefix?: string;
}) {
  const [title, setTitle] = useState(initial.title);
  const [note, setNote] = useState(initial.note ?? '');
  const [link, setLink] = useState(initial.link ?? '');
  const [coverUrl, setCoverUrl] = useState<string | null>(initial.coverUrl ?? null);
  const [status, setStatus] = useState<CollectionStatus | null>(initial.status ?? null);
  const [score, setScore] = useState<number | null>(initial.score ?? null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const danger = useThemeColor({}, 'danger');
  const canSubmit = title.trim().length > 0 && !isSaving;

  const handleSubmit = async () => {
    if (!canSubmit) {
      return;
    }

    setError(null);
    setIsSaving(true);

    try {
      await onSubmit({
        title: title.trim(),
        note: note.trim() ? note.trim() : null,
        link: link.trim() ? link.trim() : null,
        coverUrl,
        status,
        score,
      });
    } catch {
      // Keep the draft: a failed write must not cost the reader their words.
      setError("Couldn't save this thing. Your draft is still here.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={styles.form}>
      <CoverPicker disabled={isSaving} uri={coverUrl} onChange={setCoverUrl} />

      <ExpoField
        accessibilityLabel={`${a11yPrefix}title`}
        editable={!isSaving}
        label="Title"
        maxLength={COLLECTION_ITEM_TITLE_MAX}
        onChangeText={setTitle}
        placeholder="Name it"
        value={title}
      />

      <View style={styles.choices}>
        <ExpoMenu
          label={`Status: ${status ? COLLECTION_STATUS_LABELS[status] : 'None'}`}
          accessibilityLabel={`${a11yPrefix}status`}
          disabled={isSaving}
          actions={[
            { id: 'none', title: 'No status', state: status === null ? 'on' : 'off' },
            ...COLLECTION_STATUS_ORDER.map((option) => ({ id: option, title: COLLECTION_STATUS_LABELS[option], state: status === option ? 'on' as const : 'off' as const })),
          ]}
          onSelect={(id) => {
            const next = COLLECTION_STATUS_ORDER.find((option) => option === id);
            if (id === 'none') setStatus(null);
            else if (next) setStatus(next);
          }}
        />
        <ExpoMenu
          label={`Score: ${score === null ? 'Unrated' : `${score}/${COLLECTION_SCORE_MAX}`}`}
          accessibilityLabel={`${a11yPrefix}score`}
          disabled={isSaving}
          actions={[
            { id: 'unrated', title: 'Unrated', state: score === null ? 'on' : 'off' },
            ...Array.from({ length: COLLECTION_SCORE_MAX }, (_, index) => ({ id: String(index + 1), title: `${index + 1}/${COLLECTION_SCORE_MAX}`, state: score === index + 1 ? 'on' as const : 'off' as const })),
          ]}
          onSelect={(id) => {
            const next = Number(id);
            if (id === 'unrated') setScore(null);
            else if (Number.isInteger(next) && next >= 1 && next <= COLLECTION_SCORE_MAX) setScore(next);
          }}
        />
      </View>

      <ExpoField
        accessibilityLabel={`${a11yPrefix}note`}
        editable={!isSaving}
        label="Note (optional)"
        multiline
        maxLength={COLLECTION_ITEM_NOTE_MAX}
        onChangeText={setNote}
        placeholder="Optional"
        value={note}
      />
      <ExpoField
        accessibilityLabel={`${a11yPrefix}link`}
        autoCapitalize="none"
        editable={!isSaving}
        label="Link or place (optional)"
        maxLength={COLLECTION_LINK_MAX}
        onChangeText={setLink}
        placeholder="https://… or a place"
        value={link}
      />

      {error ? (
        <ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>
          {error}
        </ThemedText>
      ) : null}

      <View style={styles.formActions}>
        <ExpoButton
          disabled={!canSubmit}
          label={isSaving ? 'Saving…' : submitLabel}
          variant="primary"
          onPress={() => void handleSubmit()}
        />
        {onCancel ? (
          <ExpoButton disabled={isSaving} label="Cancel" onPress={onCancel} variant="secondary" />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: Spacing[24],
  },
  choices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[8],
  },
  formActions: {
    paddingTop: Spacing[8],
    flexWrap: 'wrap',
    flexDirection: 'row',
    gap: Spacing[8],
  },
});
