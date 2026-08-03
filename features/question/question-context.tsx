import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';

import { isStubMode } from '@/features/api-client';
import { createLocalQuestionRepository } from '@/features/question/local-question-repository';
import { remoteQuestionRepository } from '@/features/question/remote-question-repository';
import type {
  QuestionContextValue,
  QuestionRepository,
  WeeklyQuestionState,
} from '@/features/question/types';
import { useSession } from '@/features/session/session-context';

const QuestionContext = createContext<QuestionContextValue | undefined>(
  undefined
);

/**
 * "One question this week" — an optional, never-nagging ritual. One
 * handcrafted question per ISO week; both partners answer privately, and the
 * answers reveal only when both are in. Stub mode keeps your answer
 * device-local (AsyncStorage) and never fakes a partner answer; remote mode
 * talks to the API so the reveal is real. Partner changes appear when the
 * app returns to focus (remote mode).
 */
export function QuestionProvider({ children }: PropsWithChildren) {
  const { user } = useSession();
  const userId = user?.id;
  const [state, setState] = useState<WeeklyQuestionState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const repository = useMemo<QuestionRepository | null>(() => {
    if (!userId) {
      return null;
    }

    return isStubMode()
      ? createLocalQuestionRepository(userId)
      : remoteQuestionRepository;
  }, [userId]);

  const reload = useCallback(async () => {
    if (!repository) {
      return;
    }

    try {
      const loaded = await repository.getCurrent();
      setState(loaded);
      setError(null);
    } catch {
      setError("This week's question could not be loaded right now.");
    }
  }, [repository]);

  useEffect(() => {
    if (!repository) {
      setState(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    void (async () => {
      try {
        const loaded = await repository.getCurrent();

        if (!cancelled) {
          setState(loaded);
          setError(null);
        }
      } catch {
        if (!cancelled) {
          setError("This week's question could not be loaded right now.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [repository]);

  // If the partner answers while the app is away, the reveal lands quietly on
  // the next focus (remote mode only; stub answers live on this device).
  useEffect(() => {
    if (!repository || isStubMode()) {
      return;
    }

    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        void reload();
      }
    });

    return () => subscription.remove();
  }, [reload, repository]);

  const submitAnswer = useCallback(
    async (answer: string) => {
      if (!repository) {
        return;
      }

      setIsSaving(true);

      try {
        const updated = await repository.submitAnswer(answer);
        setState(updated);
        setError(null);
      } finally {
        setIsSaving(false);
      }
    },
    [repository]
  );

  const value = useMemo<QuestionContextValue>(
    () => ({
      state,
      isLoading,
      error,
      isSaving,
      submitAnswer,
      reload,
    }),
    [error, isLoading, isSaving, reload, state, submitAnswer]
  );

  return (
    <QuestionContext.Provider value={value}>{children}</QuestionContext.Provider>
  );
}

export function useQuestion(): QuestionContextValue {
  const context = useContext(QuestionContext);

  if (!context) {
    throw new Error('useQuestion must be used within QuestionProvider');
  }

  return context;
}
