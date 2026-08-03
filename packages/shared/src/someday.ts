export const SOMEDAY_CATEGORIES = ['place', 'food', 'film', 'other'] as const;

export type SomedayCategory = (typeof SOMEDAY_CATEGORIES)[number];

export const SOMEDAY_TITLE_MAX_LENGTH = 120;
export const SOMEDAY_NOTE_MAX_LENGTH = 280;

/** Authorship is always expressed relative to the viewer. */
export type SomedayAuthorRole = 'you' | 'partner';

export type SomedayItem = {
  id: string;
  title: string;
  note?: string;
  category: SomedayCategory;
  /** Computed per request from the creator's user id vs the viewer. */
  createdByRole: SomedayAuthorRole;
  createdAt: string;
  /** ISO time the item was checked off; null while it is still open. */
  checkedAt: string | null;
  /** Who checked it off (per request); null while the item is open. */
  checkedByRole: SomedayAuthorRole | null;
};

export type SomedayListResponse = {
  items: SomedayItem[];
};

export type CreateSomedayItemRequest = {
  title: string;
  note?: string;
  category: SomedayCategory;
};

export type UpdateSomedayItemRequest = {
  title?: string;
  note?: string;
  category?: SomedayCategory;
  /** true = check off, false = soft-undo a check-off. */
  checked?: boolean;
};

/**
 * Canonical Someday ordering: open items first (newest first), then
 * checked-off items (most recently checked first). ISO-8601 strings compare
 * lexicographically, so no Date parsing is needed.
 */
export function sortSomedayItems<
  T extends Pick<SomedayItem, 'createdAt' | 'checkedAt'>,
>(items: readonly T[]): T[] {
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
