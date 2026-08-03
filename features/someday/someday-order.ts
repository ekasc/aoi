import type { SomedayItem } from '@/features/someday/types';

/**
 * Canonical Someday ordering (mirrors `sortSomedayItems` in @aoi/shared):
 * open items first (newest first), then checked-off items (most recently
 * checked first). ISO-8601 strings compare lexicographically, so no Date
 * parsing is needed.
 */
export function sortSomedayItems(items: SomedayItem[]): SomedayItem[] {
  return [...items].sort((left, right) => {
    const leftChecked = left.checkedAt !== null;
    const rightChecked = right.checkedAt !== null;

    if (leftChecked !== rightChecked) {
      return leftChecked ? 1 : -1;
    }

    const leftKey = left.checkedAt ?? left.createdAt;
    const rightKey = right.checkedAt ?? right.createdAt;

    if (leftKey === rightKey) {
      return 0;
    }

    return leftKey > rightKey ? -1 : 1;
  });
}
