import {
  LETTER_BODY_MAX_LENGTH,
  LETTER_CAPTION_MAX_LENGTH,
  LETTER_SEAL_MAX_HORIZON_DAYS,
  type Letter,
  type LetterAuthorRole,
  type LetterListResponse,
  type SealLetterRequest,
} from '@aoi/shared';

// The contract types live in @aoi/shared (single source of truth, mirrored
// by the API's zod schemas); this module only re-exports them alongside the
// letters-specific repository/context shapes.

export { LETTER_BODY_MAX_LENGTH, LETTER_CAPTION_MAX_LENGTH, LETTER_SEAL_MAX_HORIZON_DAYS };
export type { Letter, LetterAuthorRole, LetterListResponse, SealLetterRequest };

export type SealLetterInput = SealLetterRequest;

export type LettersRepository = {
  /** Returns the shelf newest first; unopened letters arrive without a body. */
  list: () => Promise<Letter[]>;
  /** Seals a new letter. The response already omits the body. */
  seal: (input: SealLetterInput) => Promise<Letter>;
  /**
   * Opens a due letter (or re-reads an opened one). Rejects with a gentle
   * message ("Not yet time") when the seal has not broken yet.
   */
  open: (letterId: string) => Promise<Letter>;
};

export type LettersContextValue = {
  letters: Letter[];
  isLoading: boolean;
  error: string | null;
  isSealing: boolean;
  sealLetter: (input: SealLetterInput) => Promise<Letter>;
  openLetter: (letterId: string) => Promise<Letter>;
  reload: () => Promise<void>;
};
