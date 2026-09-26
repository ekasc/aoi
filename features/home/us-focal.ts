import { isLetterReadyToOpen } from '@/features/letters/letter-time';
import type { Letter } from '@/features/letters/types';

/**
 * Which letter, if any, is worth opening right now.
 *
 * This was the old Us screen's focal selector: it ranked a ready letter, an
 * unanswered reflection and the newest memory into one "most important
 * thing". The screen is now one memory and its exchange, so there is no
 * ranking left to do — a letter simply takes the memory's place on the day
 * its seal breaks, because a letter is looked at together by construction.
 */
export function findReadyLetter(letters: Letter[], now: Date): Letter | null {
  for (const letter of letters) {
    if (!letter.isOpened && isLetterReadyToOpen(letter, now)) return letter;
  }
  return null;
}
