import { apiFetch } from '@/features/api-client';
import type {
  QuestionRepository,
  WeeklyQuestionState,
} from '@/features/question/types';

/**
 * Remote weekly-question repository. The server decides the current ISO week
 * and question, and enforces the reveal gate (the partner's answer content is
 * only returned once both partners have answered).
 */
export const remoteQuestionRepository: QuestionRepository = {
  getCurrent() {
    return apiFetch<WeeklyQuestionState>('/v1/spaces/current/question');
  },

  submitAnswer(answer) {
    return apiFetch<WeeklyQuestionState>(
      '/v1/spaces/current/question/answer',
      {
        method: 'PUT',
        body: JSON.stringify({ answer }),
      }
    );
  },
};
