import type { MenuAction } from '@expo/ui/community/menu';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  COLLECTION_SORT_LABELS,
  COLLECTION_SORT_ORDER,
  type CollectionSort,
} from '@/constants/collection-sort';
import {
  COLLECTION_STATUS_LABELS,
  COLLECTION_STATUS_ORDER,
  type CollectionFilter,
} from '@/constants/collection-status';
import { ExpoMenu } from '@/components/ui/expo-controls';
import { Spacing } from '@/constants/theme';

export type FilterMenuProps = {
  filter: CollectionFilter;
  counts: Record<CollectionFilter, number>;
  onFilterChange: (filter: CollectionFilter) => void;
  sort: CollectionSort;
  onSortChange: (sort: CollectionSort) => void;
};

const STATUSES: { value: CollectionFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  ...COLLECTION_STATUS_ORDER.map((status) => ({
    value: status as CollectionFilter,
    label: COLLECTION_STATUS_LABELS[status],
  })),
];

export function FilterMenu({
  filter,
  onFilterChange,
  sort,
  onSortChange,
}: FilterMenuProps) {
  const accessibleLabel = 'Filter and sort';

  const actions = useMemo<MenuAction[]>(() => [
    {
      id: 'status',
      title: 'Status',
      displayInline: true,
      subactions: STATUSES.map((option) => ({
        id: `filter:${option.value}`,
        title: option.label,
        state: filter === option.value ? 'on' : 'off',
      })),
    },
    {
      id: 'sort',
      title: 'Sort',
      displayInline: true,
      subactions: COLLECTION_SORT_ORDER.map((option) => ({
        id: `sort:${option}`,
        title: COLLECTION_SORT_LABELS[option],
        state: sort === option ? 'on' : 'off',
      })),
    },
  ], [filter, sort]);

  function selectAction(id: string) {
    const status = STATUSES.find((option) => id === `filter:${option.value}`);
    if (status) {
      onFilterChange(status.value);
      return;
    }
    const order = COLLECTION_SORT_ORDER.find((option) => id === `sort:${option}`);
    if (order) onSortChange(order);
  }

  return (
    <View style={styles.row}>
      <ExpoMenu label="Filter" accessibilityLabel={accessibleLabel} actions={actions} onSelect={selectAction} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[8],
  },
});
