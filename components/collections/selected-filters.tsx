import { StyleSheet, View } from 'react-native';

import { ExpoButton } from '@/components/ui/expo-controls';
import { COLLECTION_SORT_LABELS, type CollectionSort } from '@/constants/collection-sort';
import {
  COLLECTION_STATUS_LABELS,
  type CollectionFilter,
} from '@/constants/collection-status';
import { Spacing } from '@/constants/theme';

export type SelectedFiltersProps = {
  filter: CollectionFilter;
  counts: Record<CollectionFilter, number>;
  onFilterChange: (filter: CollectionFilter) => void;
  sort: CollectionSort;
  onSortChange: (sort: CollectionSort) => void;
};

/**
 * The active choices, beside whatever control picks them.
 *
 * A menu hides its own state the moment it closes, so the chips are where the
 * state lives — the trigger stays generic and never repeats them. Each chip is
 * the whole statement (what, and how many) and clears only its own choice.
 */
export function SelectedFilters({
  filter,
  counts,
  onFilterChange,
  sort,
  onSortChange,
}: SelectedFiltersProps) {
  const chips: {
    key: string;
    label: string;
    hint: string;
    clearLabel: string;
    onClear: () => void;
  }[] = [];
  if (filter !== 'all') {
    chips.push({
      key: `filter:${filter}`,
      label: `${COLLECTION_STATUS_LABELS[filter]} ${counts[filter]}`,
      hint: 'Removes this filter',
      clearLabel: `Clear filter ${COLLECTION_STATUS_LABELS[filter]}`,
      onClear: () => onFilterChange('all'),
    });
  }
  if (sort !== 'added') {
    chips.push({
      key: `sort:${sort}`,
      label: `Sort: ${COLLECTION_SORT_LABELS[sort]}`,
      hint: 'Resets the sort',
      clearLabel: `Reset sort ${COLLECTION_SORT_LABELS[sort]}`,
      onClear: () => onSortChange('added'),
    });
  }

  if (chips.length === 0) {
    return null;
  }

  return (
    <View style={styles.row}>
      {chips.map((chip) => (
        <View key={chip.key} style={styles.chip}>
          <ExpoButton
            accessibilityHint={chip.hint}
            accessibilityLabel={chip.clearLabel}
            label={`${chip.label} ×`}
            onPress={chip.onClear}
            variant="secondary"
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    flexWrap: 'wrap',
    gap: Spacing[8],
  },
  chip: { flexShrink: 1 },
});
