import { z } from 'zod';

export const SOMEDAY_CATEGORIES = ['place', 'food', 'film', 'other'] as const;

export const somedayCategorySchema = z.enum(SOMEDAY_CATEGORIES);

export type SomedayCategory = z.infer<typeof somedayCategorySchema>;

export const SOMEDAY_TITLE_MAX_LENGTH = 120;
export const SOMEDAY_NOTE_MAX_LENGTH = 280;

export const SOMEDAY_AUTHOR_ROLES = ['you', 'partner'] as const;

export const somedayAuthorRoleSchema = z.enum(SOMEDAY_AUTHOR_ROLES);

/** Authorship is always expressed relative to the viewer. */
export type SomedayAuthorRole = z.infer<typeof somedayAuthorRoleSchema>;

export const somedayItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  note: z.string().optional(),
  category: somedayCategorySchema,
  /** Computed per request from the creator's user id vs the viewer. */
  createdByRole: somedayAuthorRoleSchema,
  createdAt: z.string(),
  /** ISO time the item was checked off; null while it is still open. */
  checkedAt: z.string().nullable(),
  /** Who checked it off (per request); null while the item is open. */
  checkedByRole: somedayAuthorRoleSchema.nullable(),
});

export type SomedayItem = z.infer<typeof somedayItemSchema>;

export const somedayListResponseSchema = z.object({
  items: z.array(somedayItemSchema),
});

export type SomedayListResponse = z.infer<typeof somedayListResponseSchema>;

export const createSomedayItemRequestSchema = z.object({
  title: z.string().min(1).max(SOMEDAY_TITLE_MAX_LENGTH),
  note: z.string().max(SOMEDAY_NOTE_MAX_LENGTH).optional(),
  category: somedayCategorySchema,
});

export type CreateSomedayItemRequest = z.infer<
  typeof createSomedayItemRequestSchema
>;

export const updateSomedayItemRequestSchema = z.object({
  title: z.string().min(1).max(SOMEDAY_TITLE_MAX_LENGTH).optional(),
  note: z.string().max(SOMEDAY_NOTE_MAX_LENGTH).optional(),
  category: somedayCategorySchema.optional(),
  /** true = check off, false = soft-undo a check-off. */
  checked: z.boolean().optional(),
});

export type UpdateSomedayItemRequest = z.infer<
  typeof updateSomedayItemRequestSchema
>;

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
