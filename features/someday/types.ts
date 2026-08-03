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

export type CreateSomedayItemInput = {
  title: string;
  note?: string;
  category?: SomedayCategory;
};

export type UpdateSomedayItemInput = {
  title?: string;
  note?: string;
  category?: SomedayCategory;
  /** true = check off, false = soft-undo a check-off. */
  checked?: boolean;
};

export type SomedayRepository = {
  /** Returns items in canonical order (open first, then checked). */
  list: () => Promise<SomedayItem[]>;
  add: (input: CreateSomedayItemInput) => Promise<SomedayItem>;
  /** Returns the updated item, or null when it no longer exists. */
  update: (
    itemId: string,
    input: UpdateSomedayItemInput
  ) => Promise<SomedayItem | null>;
};

export type SomedayContextValue = {
  /** All items in canonical order (open first, then checked). */
  items: SomedayItem[];
  openItems: SomedayItem[];
  doneItems: SomedayItem[];
  isLoading: boolean;
  error: string | null;
  addItem: (input: CreateSomedayItemInput) => Promise<void>;
  setChecked: (itemId: string, checked: boolean) => Promise<void>;
  reload: () => Promise<void>;
};
