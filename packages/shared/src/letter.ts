import { z } from 'zod';

export const LETTER_BODY_MAX_LENGTH = 5000;
export const LETTER_CAPTION_MAX_LENGTH = 80;

/**
 * How far ahead a letter may be sealed (~50 years, leap days included).
 * Beyond the horizon the server declines with a gentle word-only message.
 */
export const LETTER_SEAL_MAX_HORIZON_DAYS = 18_262;

export const LETTER_AUTHOR_ROLES = ['you', 'partner'] as const;

export const letterAuthorRoleSchema = z.enum(LETTER_AUTHOR_ROLES);

/** Authorship is always expressed relative to the viewer. */
export type LetterAuthorRole = z.infer<typeof letterAuthorRoleSchema>;

export const letterSchema = z.object({
  id: z.string(),
  /** Computed per request from the author's user id vs the viewer. */
  authorRole: letterAuthorRoleSchema,
  authorName: z.string(),
  /** The envelope line; null when the author left it blank. */
  caption: z.string().nullable(),
  /**
   * Present ONLY once the letter has been opened — omitted entirely before
   * that, for the partner and the author alike. The lock is temporal, not
   * cryptographic: bodies are stored plaintext and the gate is enforced by
   * the API (see CONTEXT — encryption tiers are designed, not built).
   */
  body: z.string().optional(),
  sealedUntil: z.string(),
  createdAt: z.string(),
  isOpened: z.boolean(),
  /** Computed per request: now ≥ sealedUntil. */
  readyToOpen: z.boolean(),
  openedAt: z.string().nullable(),
});

export type Letter = z.infer<typeof letterSchema>;

export const letterListResponseSchema = z.object({
  letters: z.array(letterSchema),
});

export type LetterListResponse = z.infer<typeof letterListResponseSchema>;

export const sealLetterRequestSchema = z.object({
  caption: z.string().max(LETTER_CAPTION_MAX_LENGTH).optional(),
  body: z.string().min(1).max(LETTER_BODY_MAX_LENGTH),
  /** ISO-8601 datetime with offset; strictly future, within the horizon. */
  sealedUntil: z.string(),
});

export type SealLetterRequest = z.infer<typeof sealLetterRequestSchema>;

/**
 * Canonical shelf order: newest letters first. ISO-8601 strings compare
 * lexicographically, so no Date parsing is needed.
 */
export function sortLettersNewestFirst<T extends Pick<Letter, 'createdAt'>>(
  letters: readonly T[]
): T[] {
  return [...letters].sort((left, right) => {
    if (left.createdAt === right.createdAt) {
      return 0;
    }
    return left.createdAt > right.createdAt ? -1 : 1;
  });
}
