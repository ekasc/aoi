/**
 * One question this week — the couple's optional weekly ritual.
 *
 * A single handcrafted question per ISO week; both partners answer privately
 * and the answers reveal only when both are in. The week -> question mapping
 * is deterministic and identical for both partners (pure functions below).
 * Strictly optional, never nagging: no notifications, no badges, no pressure.
 */

export const WEEKLY_ANSWER_MAX_LENGTH = 500;

/**
 * The seeded question bank. Handcrafted, warm, concrete. The mapping below
 * cycles through these forever — write them as if they can repeat, because
 * they eventually will.
 */
export const WEEKLY_QUESTIONS = [
  "What's a tiny thing they did this week that made you smile?",
  'What moment from this week would you like to live again?',
  'When did you feel closest to them this week?',
  "What's something small you're looking forward to doing together?",
  'What made you laugh together this week?',
  "What's a small thing they did that you haven't thanked them for yet?",
  'What did you notice about them this week that you love?',
  'If this week were a photo, what would it show?',
  'What did they do this week that made things easier for you?',
  "What's a small comfort of theirs that always works?",
  'What place did you think about going to together this week?',
  'What reminded you of them this week — a song, a smell, a taste?',
  'What quiet moment together are you grateful for from this week?',
  "What's something you'd love to ask them about over dinner?",
  "What's a tiny thing they do that you'd miss if it ever stopped?",
  'What did you admire about them this week?',
  'What was the coziest moment you shared this week?',
  "What's one small way you showed up for them this week?",
  'What ordinary thing felt special because they were there?',
  'What do you want them to know you were thinking about?',
] as const;

export type WeeklyQuestion = {
  /** ISO week key, e.g. `2026-W32`. Same for both partners. */
  weekKey: string;
  /** Index into WEEKLY_QUESTIONS; snapshotted onto answer rows. */
  questionId: number;
  question: string;
};

export type IsoWeekParts = {
  isoYear: number;
  isoWeek: number;
};

/**
 * ISO-8601 week parts for a date: weeks start Monday, and week 1 is the week
 * containing the year's first Thursday. Calendar-day based (local time).
 */
export function getIsoWeekParts(date: Date): IsoWeekParts {
  // Work in UTC on the local calendar date so day arithmetic is exact.
  const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // Mon = 1 ... Sun = 7 (JS getUTCDay(): Sun = 0).
  const dayNumber = day.getUTCDay() || 7;
  // Move to the Thursday of this ISO week — its year is the ISO year.
  day.setUTCDate(day.getUTCDate() + 4 - dayNumber);
  const isoYear = day.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const isoWeek = Math.ceil(
    ((day.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );
  return { isoYear, isoWeek };
}

export function getWeekKeyForDate(date: Date): string {
  const { isoYear, isoWeek } = getIsoWeekParts(date);
  return `${isoYear}-W${`${isoWeek}`.padStart(2, '0')}`;
}

/**
 * Deterministic week -> question mapping, identical for both partners:
 * an ever-increasing week ordinal (mod the question count). Consecutive
 * weeks always get consecutive questions, except across a 53-week ISO year
 * boundary, where the same question can gently repeat — harmless.
 */
export function getQuestionIdForWeek(parts: IsoWeekParts): number {
  const ordinal = parts.isoYear * 52 + parts.isoWeek;
  return ordinal % WEEKLY_QUESTIONS.length;
}

export function getWeeklyQuestionForDate(date: Date): WeeklyQuestion {
  const parts = getIsoWeekParts(date);
  const questionId = getQuestionIdForWeek(parts);
  return {
    weekKey: getWeekKeyForDate(date),
    questionId,
    question: WEEKLY_QUESTIONS[questionId],
  };
}

/**
 * GET /v1/spaces/current/question — the current question plus both answers,
 * always relative to the viewer. The partner's answer content is only ever
 * present when `revealed` is true (both partners have answered this week).
 */
export type WeeklyQuestionResponse = {
  weekKey: string;
  questionId: number;
  question: string;
  /** The viewer's saved answer; null until they submit. */
  yourAnswer: string | null;
  yourAnswerUpdatedAt: string | null;
  /** The partner has written something (timing stays private). */
  partnerAnswered: boolean;
  /** Null until both answers are in — the reveal gate. */
  partnerAnswer: string | null;
  partnerName: string | null;
  /** True only when both partners have answered this week. */
  revealed: boolean;
};

export type PutWeeklyAnswerRequest = {
  answer: string;
};
