import { vi, describe, it, expect, beforeEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';

import { QuestionProvider, useQuestion } from '@/features/question/question-context';
import type {
  QuestionContextValue,
  WeeklyQuestionState,
} from '@/features/question/types';

const fakeRepository = {
  getCurrent: vi.fn(),
  submitAnswer: vi.fn(),
};

vi.mock('@/features/question/local-question-repository', () => ({
  createLocalQuestionRepository: () => fakeRepository,
}));

vi.mock('@/features/session/session-context', () => ({
  useSession: () => ({
    user: { id: 'user-you', displayName: 'You', email: 'you@aoi.test' },
  }),
}));

let captured: QuestionContextValue | null = null;

function Probe() {
  captured = useQuestion();
  return null;
}

function makeState(overrides: Partial<WeeklyQuestionState> = {}): WeeklyQuestionState {
  return {
    weekKey: '2026-W32',
    questionId: 4,
    question: 'What made you laugh together this week?',
    yourAnswer: null,
    yourAnswerUpdatedAt: null,
    partnerAnswered: false,
    partnerAnswer: null,
    partnerName: 'Mara',
    revealed: false,
    ...overrides,
  };
}

async function renderProvider() {
  const view = render(
    <QuestionProvider>
      <Probe />
    </QuestionProvider>
  );
  await waitFor(() => expect(captured?.isLoading).toBe(false));
  return view;
}

describe('QuestionProvider', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    captured = null;
  });

  it('loads the current week question and answer state', async () => {
    fakeRepository.getCurrent.mockResolvedValue(makeState());

    await renderProvider();

    expect(fakeRepository.getCurrent).toHaveBeenCalledTimes(1);
    expect(captured?.state?.weekKey).toBe('2026-W32');
    expect(captured?.state?.question).toBe(
      'What made you laugh together this week?'
    );
    expect(captured?.error).toBeNull();
    expect(captured?.isSaving).toBe(false);
  });

  it('keeps the partner answer hidden when only you have answered (reveal gating)', async () => {
    fakeRepository.getCurrent.mockResolvedValue(
      makeState({
        yourAnswer: 'The way they made coffee on Tuesday.',
        yourAnswerUpdatedAt: '2026-08-01T10:00:00.000Z',
      })
    );

    await renderProvider();

    expect(captured?.state?.yourAnswer).toBe(
      'The way they made coffee on Tuesday.'
    );
    expect(captured?.state?.partnerAnswered).toBe(false);
    expect(captured?.state?.partnerAnswer).toBeNull();
    expect(captured?.state?.revealed).toBe(false);
  });

  it('keeps the partner answer hidden even while waiting on yours', async () => {
    fakeRepository.getCurrent.mockResolvedValue(
      makeState({ partnerAnswered: true })
    );

    await renderProvider();

    // They have answered, but the reveal needs both.
    expect(captured?.state?.partnerAnswered).toBe(true);
    expect(captured?.state?.partnerAnswer).toBeNull();
    expect(captured?.state?.revealed).toBe(false);
  });

  it('reveals both answers once both partners have answered', async () => {
    fakeRepository.getCurrent.mockResolvedValue(
      makeState({
        yourAnswer: 'The way they made coffee on Tuesday.',
        partnerAnswered: true,
        partnerAnswer: 'Their quiet answer.',
        revealed: true,
      })
    );

    await renderProvider();

    expect(captured?.state?.revealed).toBe(true);
    expect(captured?.state?.yourAnswer).toBe(
      'The way they made coffee on Tuesday.'
    );
    expect(captured?.state?.partnerAnswer).toBe('Their quiet answer.');
  });

  it('submitAnswer saves and adopts the fresh state', async () => {
    fakeRepository.getCurrent.mockResolvedValue(makeState());
    await renderProvider();

    const afterSubmit = makeState({
      yourAnswer: 'Something small and true.',
      yourAnswerUpdatedAt: '2026-08-03T12:00:00.000Z',
    });
    fakeRepository.submitAnswer.mockResolvedValue(afterSubmit);

    await act(async () => {
      await captured?.submitAnswer('Something small and true.');
    });

    expect(fakeRepository.submitAnswer).toHaveBeenCalledWith(
      'Something small and true.'
    );
    expect(captured?.state?.yourAnswer).toBe('Something small and true.');
    expect(captured?.isSaving).toBe(false);
  });

  it('surfaces a gentle error when the question cannot be loaded', async () => {
    fakeRepository.getCurrent.mockRejectedValue(new Error('network down'));

    await renderProvider();

    expect(captured?.error).toBe(
      "This week's question could not be loaded right now."
    );
    expect(captured?.state).toBeNull();
  });

  it('lets a failed submit bubble quietly so the screen can reassure', async () => {
    fakeRepository.getCurrent.mockResolvedValue(makeState());
    await renderProvider();

    fakeRepository.submitAnswer.mockRejectedValue(new Error('network down'));

    await act(async () => {
      await expect(
        captured?.submitAnswer('Something small and true.')
      ).rejects.toThrow();
    });

    expect(captured?.isSaving).toBe(false);
    expect(captured?.state?.yourAnswer).toBeNull();
  });
});
