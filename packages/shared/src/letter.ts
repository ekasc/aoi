/**
 * Letters / time capsule — write a letter, seal it to a future day.
 *
 * The contract enforces the ceremony: sealed letters are immutable (the API
 * exposes no edit/delete surface) and an unopened letter's body never leaves
 * the server — for the partner AND for the author who wrote it. `body` is
 * therefore optional on the wire: present only once `isOpened` is true.
 */

export const LETTER_BODY_MAX_LENGTH = 5000;
export const LETTER_CAPTION_MAX_LENGTH = 80;

/**
 * How far ahead a letter may be sealed (~50 years, leap days included).
 * Beyond the horizon the server declines with a gentle word-only message.
 */
export const LETTER_SEAL_MAX_HORIZON_DAYS = 18_262;

/** Authorship is always expressed relative to the viewer. */
export type LetterAuthorRole = 'you' | 'partner';

export type Letter = {
  id: string;
  /** Computed per request from the author's user id vs the viewer. */
  authorRole: LetterAuthorRole;
  authorName: string;
  /** The envelope line; null when the author left it blank. */
  caption: string | null;
  /**
   * Present ONLY once the letter has been opened — omitted entirely before
   * that, for the partner and the author alike. The lock is temporal, not
   * cryptographic: bodies are stored plaintext and the gate is enforced by
   * the API (see CONTEXT — encryption tiers are designed, not built).
   */
  body?: string;
  sealedUntil: string;
  createdAt: string;
  isOpened: boolean;
  /** Computed per request: now ≥ sealedUntil. */
  readyToOpen: boolean;
  openedAt: string | null;
};

export type LetterListResponse = {
  letters: Letter[];
};

export type SealLetterRequest = {
  caption?: string;
  body: string;
  /** ISO-8601 datetime with offset; strictly future, within the horizon. */
  sealedUntil: string;
};

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
