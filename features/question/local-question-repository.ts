import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  getWeeklyQuestionForDate,
  type WeeklyQuestion,
} from '@/features/question/question-of-the-week';
import type {
  QuestionRepository,
  WeeklyQuestionState,
} from '@/features/question/types';

const STORAGE_KEY_PREFIX = 'aoi.question.v1.';

type StoredAnswer = {
  answer: string;
  updatedAt: string;
};

/** Answers keyed by ISO week key (`2026-W32`). */
type StoredAnswers = Record<string, StoredAnswer>;

function storageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}`;
}

async function readAnswers(key: string): Promise<StoredAnswers> {
  const rawValue = await AsyncStorage.getItem(key);

  if (!rawValue) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(rawValue);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    const answers: StoredAnswers = {};

    for (const [weekKey, value] of Object.entries(
      parsed as Record<string, unknown>
    )) {
      if (
        value &&
        typeof value === 'object' &&
        typeof (value as StoredAnswer).answer === 'string' &&
        typeof (value as StoredAnswer).updatedAt === 'string'
      ) {
        answers[weekKey] = value as StoredAnswer;
      }
    }

    return answers;
  } catch {
    return {};
  }
}

function toState(
  week: WeeklyQuestion,
  entry: StoredAnswer | null
): WeeklyQuestionState {
  return {
    weekKey: week.weekKey,
    questionId: week.questionId,
    question: week.question,
    yourAnswer: entry?.answer ?? null,
    yourAnswerUpdatedAt: entry?.updatedAt ?? null,
    // Stub mode is one device, so the partner has never answered here. The
    // reveal stays closed and the screen shows a soft note instead.
    partnerAnswered: false,
    partnerAnswer: null,
    partnerName: null,
    revealed: false,
  };
}

/**
 * Device-local weekly question for stub mode.
 *
 * Deliberately does NOT simulate a partner answer (unlike squeeze's
 * simulated reply): the reveal only means anything when it carries their
 * real words, so the calmer option is to show only your own answer with the
 * soft unlock note. Fabricated partner words would undercut the ritual.
 * Remote mode reveals for real once both partners have answered.
 */
export function createLocalQuestionRepository(userId: string): QuestionRepository {
  const key = storageKey(userId);

  return {
    async getCurrent() {
      const week = getWeeklyQuestionForDate(new Date());
      const answers = await readAnswers(key);
      return toState(week, answers[week.weekKey] ?? null);
    },

    async submitAnswer(answer) {
      const trimmed = answer.trim();

      if (!trimmed) {
        throw new Error('Your answer needs a few words');
      }

      const week = getWeeklyQuestionForDate(new Date());
      const answers = await readAnswers(key);
      const entry: StoredAnswer = {
        answer: trimmed,
        updatedAt: new Date().toISOString(),
      };

      await AsyncStorage.setItem(
        key,
        JSON.stringify({ ...answers, [week.weekKey]: entry })
      );

      return toState(week, entry);
    },
  };
}
