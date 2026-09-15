import { isLetterReadyToOpen } from '@/features/letters/letter-time';
import type { Letter } from '@/features/letters/types';
import type { Moment } from '@/features/moments/types';
import type { WeeklyQuestionState } from '@/features/question/types';

export type UsFocal =
  | { kind: 'letter'; letter: Letter }
  | { kind: 'question'; question: WeeklyQuestionState }
  | { kind: 'moment'; moment: Moment }
  | { kind: 'empty' };

export type UsFocalInput = {
  letters: Letter[];
  question: WeeklyQuestionState | null | undefined;
  moments: Moment[];
  now: Date;
};

/** An available reflection is one the viewer has not answered and not revealed. */
export function isQuestionUnanswered(
  question: WeeklyQuestionState | null | undefined
): question is WeeklyQuestionState {
  if (!question) return false;
  if (question.revealed) return false;
  const answer = question.yourAnswer;
  return answer == null || answer.trim().length === 0;
}

/**
 * First ready unopened letter in shelf order (newest first from the
 * repository). List order is the contract — no re-sorting, no fake state.
 */
export function findReadyLetter(letters: Letter[], now: Date): Letter | null {
  for (const letter of letters) {
    if (!letter.isOpened && isLetterReadyToOpen(letter, now)) return letter;
  }
  return null;
}

function momentTime(moment: Moment): number {
  const occurred = new Date(moment.occurredAt).getTime();
  if (!Number.isNaN(occurred)) return occurred;
  const created = new Date(moment.createdAt).getTime();
  return Number.isNaN(created) ? Number.NEGATIVE_INFINITY : created;
}

/**
 * Newest partner memory, falling back to the newest shared memory.
 * Newest means greatest occurredAt (createdAt fallback for bad dates).
 */
export function findLatestMemory(moments: Moment[]): Moment | null {
  if (moments.length === 0) return null;
  const partner = moments.filter((m) => m.authorRole === 'partner');
  const pool = partner.length > 0 ? partner : moments;
  let latest: Moment | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;
  for (const moment of pool) {
    const time = momentTime(moment);
    if (latest === null || time > latestTime) {
      latest = moment;
      latestTime = time;
    }
  }
  return latest;
}

/**
 * One focal item for the Us home, in strict priority:
 * ready letter → unanswered reflection → newest partner (else shared) memory → empty.
 */
export function selectUsFocal(input: UsFocalInput): UsFocal {
  const ready = findReadyLetter(input.letters, input.now);
  if (ready) return { kind: 'letter', letter: ready };
  if (isQuestionUnanswered(input.question)) {
    return { kind: 'question', question: input.question };
  }
  const latest = findLatestMemory(input.moments);
  if (latest) return { kind: 'moment', moment: latest };
  return { kind: 'empty' };
}
