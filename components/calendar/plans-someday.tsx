import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Divider } from '@/components/ui/divider';
import { Surface } from '@/components/ui/surface';
import { Radii, Spacing } from '@/constants/theme';
import { haptics } from '@/features/haptics/haptics';
import { useSomeday } from '@/features/someday/someday-context';
import {
  SOMEDAY_CATEGORIES,
  SOMEDAY_TITLE_MAX_LENGTH,
  type SomedayCategory,
  type SomedayItem,
} from '@/features/someday/types';
import { useSpace } from '@/features/space/space-context';
import { useThemeColor } from '@/hooks/use-theme-color';

/** A chip names the category in the singular: "Place", not "Places". */
const CATEGORY_LABEL: Record<SomedayCategory, string> = {
  place: 'Place',
  food: 'Food',
  film: 'Film',
  other: 'Other',
};

/** A group heading names the section in the plural: "Places". */
const GROUP_LABEL: Record<SomedayCategory, string> = {
  place: 'Places',
  food: 'Food & drink',
  film: 'Films',
  other: 'Odds & ends',
};

/**
 * The order the groups read in: the canonical list, so the chips and the
 * headings never drift apart.
 */
const CATEGORY_ORDER: readonly SomedayCategory[] = SOMEDAY_CATEGORIES;

function addedByLabel(item: SomedayItem, partnerName: string): string {
  return item.createdByRole === 'you' ? 'Added by you' : `Added by ${partnerName}`;
}

function checkedByLabel(item: SomedayItem, partnerName: string): string {
  return item.checkedByRole === 'partner'
    ? `Checked off by ${partnerName}`
    : 'Checked off by you';
}

type OpenRowProps = {
  item: SomedayItem;
  partnerName: string;
  onCheck: (itemId: string) => void;
  borderColor: string;
  mutedColor: string;
};

function OpenRow({ item, partnerName, onCheck, borderColor, mutedColor }: OpenRowProps) {
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityHint="Marks it done"
        accessibilityLabel={`Check off ${item.title}`}
        accessibilityRole="button"
        onPress={() => onCheck(item.id)}
        style={styles.checkTap}
      >
        <View style={[styles.checkCircle, { borderColor }]} />
      </Pressable>
      <View style={styles.rowBody}>
        <ThemedText type="bodyEmphasis">{item.title}</ThemedText>
        {item.note ? (
          <ThemedText type="caption" style={{ color: mutedColor }}>
            {item.note}
          </ThemedText>
        ) : null}
        <ThemedText type="meta" style={{ color: mutedColor }}>
          {addedByLabel(item, partnerName)}
        </ThemedText>
      </View>
    </View>
  );
}

type DoneRowProps = {
  item: SomedayItem;
  partnerName: string;
  onUndo: (itemId: string) => void;
  background: string;
  mutedColor: string;
};

function DoneRow({ item, partnerName, onUndo, background, mutedColor }: DoneRowProps) {
  return (
    <Pressable
      accessibilityHint="Puts it back on the list"
      accessibilityLabel={`Undo check-off: ${item.title}`}
      accessibilityRole="button"
      onPress={() => onUndo(item.id)}
      style={styles.row}
    >
      <View style={[styles.checkCircleDone, { backgroundColor: mutedColor }]}>
        <Ionicons color={background} name="checkmark" size={14} />
      </View>
      <View style={styles.rowBody}>
        <ThemedText
          numberOfLines={2}
          type="bodyEmphasis"
          style={{ color: mutedColor, textDecorationLine: 'line-through' }}
        >
          {item.title}
        </ThemedText>
        <ThemedText type="meta" style={{ color: mutedColor }}>
          {checkedByLabel(item, partnerName)}
        </ThemedText>
      </View>
    </Pressable>
  );
}

/**
 * Someday, as a mode of Plans rather than a screen of its own: the couple's
 * shared list of places to go, films to watch and tables for two. The parent
 * owns the scroll, so this renders the content only — the quick-add, the open
 * wishes grouped by category, and a collapsible Done section.
 */
export function PlansSomeday() {
  const { openItems, doneItems, isLoading, error, addItem, setChecked, reload } =
    useSomeday();
  const { space } = useSpace();
  const accent = useThemeColor({}, 'accent');
  const accentInk = useThemeColor({}, 'accentInk');
  const background = useThemeColor({}, 'background');
  const border = useThemeColor({}, 'border');
  const muted = useThemeColor({}, 'muted');
  const onAccent = useThemeColor({}, 'onAccent');
  const surface = useThemeColor({}, 'surface');
  const text = useThemeColor({}, 'text');

  const [draft, setDraft] = useState('');
  const [category, setCategory] = useState<SomedayCategory>('place');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [doneOpen, setDoneOpen] = useState(false);

  const partnerName = space?.partnerName?.trim() || 'them';
  const trimmedDraft = draft.trim();
  const canAdd = trimmedDraft.length > 0 && !isSaving;
  const isEmpty = openItems.length === 0 && doneItems.length === 0;

  const openGroups = useMemo(
    () =>
      CATEGORY_ORDER.map((value) => ({
        category: value,
        items: openItems.filter((item) => item.category === value),
      })).filter((group) => group.items.length > 0),
    [openItems],
  );

  const handleAdd = useCallback(async () => {
    if (!trimmedDraft || isSaving) {
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      await addItem({ title: trimmedDraft, category });
      setDraft('');
    } catch {
      setSaveError('Couldn’t add that one, try again in a moment.');
    } finally {
      setIsSaving(false);
    }
  }, [addItem, category, isSaving, trimmedDraft]);

  const handleCheck = useCallback(
    (itemId: string) => {
      haptics.select();
      void setChecked(itemId, true);
    },
    [setChecked],
  );

  const handleUndo = useCallback(
    (itemId: string) => {
      haptics.select();
      void setChecked(itemId, false);
    },
    [setChecked],
  );

  return (
    <View style={styles.root}>
      <ThemedText type="supporting" style={{ color: muted }}>
        Things you mean to do together.
      </ThemedText>

      <Surface style={styles.composer}>
        <TextInput
          accessibilityLabel="New someday idea"
          editable={!isSaving}
          maxLength={SOMEDAY_TITLE_MAX_LENGTH}
          onChangeText={setDraft}
          onSubmitEditing={() => void handleAdd()}
          placeholder="Something for someday…"
          placeholderTextColor={muted}
          returnKeyType="done"
          style={[styles.input, { color: text }]}
          value={draft}
        />
        <View style={styles.chipRow}>
          {CATEGORY_ORDER.map((value) => {
            const isActive = category === value;

            return (
              <Pressable
                accessibilityLabel={CATEGORY_LABEL[value]}
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
                <ThemedText type="meta" style={{ color: isActive ? onAccent : muted }}>
                  {CATEGORY_LABEL[value]}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
        {saveError ? (
          <ThemedText
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
            type="caption"
            style={{ color: muted }}
          >
            {saveError}
          </ThemedText>
        ) : null}
        <Button
          accessibilityState={{ busy: isSaving, disabled: !canAdd }}
          disabled={!canAdd}
          label="Add"
          onPress={() => void handleAdd()}
          variant="primary"
        />
      </Surface>

      {isLoading && isEmpty ? (
        <View style={styles.center}>
          <ActivityIndicator color={accentInk} />
        </View>
      ) : error && isEmpty ? (
        <Surface style={styles.errorCard}>
          <ThemedText
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
            type="caption"
            style={{ color: muted }}
          >
            {error}
          </ThemedText>
          <Button label="Try again" onPress={() => void reload()} variant="secondary" />
        </Surface>
      ) : isEmpty ? (
        <ThemedText
          accessibilityLiveRegion="polite"
          type="caption"
          style={{ color: muted }}
        >
          Nothing on your someday list yet.
        </ThemedText>
      ) : (
        <>
          {openGroups.map((group) => (
            <View key={group.category} style={styles.group}>
              <ThemedText type="subheading">{GROUP_LABEL[group.category]}</ThemedText>
              <Surface style={styles.listCard}>
                {group.items.map((item, index) => (
                  <View key={item.id}>
                    {index > 0 ? <Divider /> : null}
                    <OpenRow
                      borderColor={border}
                      item={item}
                      mutedColor={muted}
                      onCheck={handleCheck}
                      partnerName={partnerName}
                    />
                  </View>
                ))}
              </Surface>
            </View>
          ))}

          {doneItems.length > 0 ? (
            <View style={styles.group}>
              <Pressable
                accessibilityHint={
                  doneOpen ? 'Hides the checked-off ideas' : 'Shows the checked-off ideas'
                }
                accessibilityLabel={`Done together, ${doneItems.length} ${
                  doneItems.length === 1 ? 'idea' : 'ideas'
                }`}
                accessibilityRole="button"
                accessibilityState={{ expanded: doneOpen }}
                onPress={() => setDoneOpen((open) => !open)}
                style={styles.doneHeader}
              >
                <ThemedText type="subheading">Done together</ThemedText>
                <Ionicons
                  color={muted}
                  name={doneOpen ? 'chevron-up' : 'chevron-down'}
                  size={18}
                />
              </Pressable>
              {doneOpen ? (
                <Surface style={styles.listCard}>
                  {doneItems.map((item, index) => (
                    <View key={item.id}>
                      {index > 0 ? <Divider /> : null}
                      <DoneRow
                        background={background}
                        item={item}
                        mutedColor={muted}
                        onUndo={handleUndo}
                        partnerName={partnerName}
                      />
                    </View>
                  ))}
                </Surface>
              ) : null}
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: Spacing[16],
    paddingHorizontal: Spacing[16],
    paddingVertical: Spacing[16],
  },
  composer: {
    gap: Spacing[12],
  },
  input: {
    fontSize: 18,
    lineHeight: 24,
    minHeight: 44,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[8],
  },
  categoryChip: {
    borderRadius: Radii.pill,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: Spacing[12],
    paddingVertical: 6,
  },
  group: {
    gap: Spacing[8],
  },
  listCard: {
    paddingHorizontal: Spacing[16],
    paddingVertical: Spacing[4],
  },
  errorCard: {
    alignItems: 'stretch',
    gap: Spacing[12],
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing[40],
  },
  doneHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing[8],
    justifyContent: 'space-between',
    minHeight: 44,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing[12],
    minHeight: 44,
    paddingVertical: Spacing[12],
  },
  checkTap: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  checkCircle: {
    alignItems: 'center',
    borderRadius: Radii.pill,
    borderWidth: 1.5,
    height: 26,
    justifyContent: 'center',
    width: 26,
  },
  checkCircleDone: {
    alignItems: 'center',
    borderRadius: Radii.pill,
    height: 26,
    justifyContent: 'center',
    opacity: 0.7,
    width: 26,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
});
