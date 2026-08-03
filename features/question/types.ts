export const WEEKLY_ANSWER_MAX_LENGTH = 500;

/**
 * The current week's question and both answer states, always relative to the
 * viewer (mirrors `WeeklyQuestionResponse` in @aoi/shared). The partner's
 * answer content is only ever present when `revealed` is true — both partners
 * must have answered this week.
 */
export type WeeklyQuestionState = {
  /** ISO week key, e.g. `2026-W32`. Same for both partners. */
  weekKey: string;
  questionId: number;
  question: string;
  /** The viewer's saved answer; null until they submit. */
  yourAnswer: string | null;
  yourAnswerUpdatedAt: string | null;
  /** The partner has written something (their timing stays private). */
  partnerAnswered: boolean;
  /** Null until both answers are in — the reveal gate. */
  partnerAnswer: string | null;
  partnerName: string | null;
  /** True only when both partners have answered this week. */
  revealed: boolean;
};

export type QuestionRepository = {
  getCurrent: () => Promise<WeeklyQuestionState>;
  submitAnswer: (answer: string) => Promise<WeeklyQuestionState>;
};

export type QuestionContextValue = {
  state: WeeklyQuestionState | null;
  isLoading: boolean;
  error: string | null;
  isSaving: boolean;
  submitAnswer: (answer: string) => Promise<void>;
  reload: () => Promise<void>;
};
