import { sortLettersNewestFirst, type Letter } from '@aoi/shared';
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
import { createLocalLettersRepository } from '@/features/letters/local-letters-repository';
import { remoteLettersRepository } from '@/features/letters/remote-letters-repository';
import type {
  LettersContextValue,
  LettersRepository,
  SealLetterInput,
} from '@/features/letters/types';
import { useSession } from '@/features/session/session-context';

const LettersContext = createContext<LettersContextValue | undefined>(undefined);

/**
 * Letters / time capsule: write a letter, seal it to a future day. Sealed
 * letters are immutable and unreadable — the body never appears in the list
 * for anyone, author included, until it is opened. Stub mode keeps letters
 * device-local (AsyncStorage, with one plainly-simulated partner letter so
 * the reveal can be tried offline); remote mode talks to the API, where the
 * lock is enforced server-side. Partner letters land quietly on the next
 * focus (remote mode).
 */
export function LettersProvider({ children }: PropsWithChildren) {
  const { user } = useSession();
  const userId = user?.id;
  const [letters, setLetters] = useState<Letter[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSealing, setIsSealing] = useState(false);

  const repository = useMemo<LettersRepository | null>(() => {
    if (!userId) {
      return null;
    }

    return isStubMode()
      ? createLocalLettersRepository(userId)
      : remoteLettersRepository;
  }, [userId]);

  useEffect(() => {
    if (!repository) {
      setLetters([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    void (async () => {
      try {
        const loaded = await repository.list();

        if (!cancelled) {
          setLetters(loaded);
          setError(null);
        }
      } catch {
        if (!cancelled) {
          setError('Your letters could not be loaded right now.');
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

  const reload = useCallback(async () => {
    if (!repository) {
      return;
    }

    try {
      const loaded = await repository.list();
      setLetters(loaded);
      setError(null);
    } catch {
      setError('Your letters could not be loaded right now.');
    }
  }, [repository]);

  // A newly sealed letter from the partner appears when the app returns to
  // focus (remote mode only; the stub shelf lives on this device already).
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

  const sealLetter = useCallback(
    async (input: SealLetterInput) => {
      if (!repository) {
        throw new Error('Your letters are not available right now.');
      }

      setIsSealing(true);

      try {
        const sealed = await repository.seal(input);
        setLetters((current) => sortLettersNewestFirst([sealed, ...current]));
        setError(null);
        return sealed;
      } finally {
        setIsSealing(false);
      }
    },
    [repository]
  );

  const openLetter = useCallback(
    async (letterId: string) => {
      if (!repository) {
        throw new Error('Your letters are not available right now.');
      }

      const opened = await repository.open(letterId);
      setLetters((current) =>
        current.map((letter) => (letter.id === letterId ? opened : letter))
      );
      return opened;
    },
    [repository]
  );

  const value = useMemo<LettersContextValue>(
    () => ({
      letters,
      isLoading,
      error,
      isSealing,
      sealLetter,
      openLetter,
      reload,
    }),
    [error, isLoading, isSealing, letters, openLetter, reload, sealLetter]
  );

  return (
    <LettersContext.Provider value={value}>{children}</LettersContext.Provider>
  );
}

export function useLetters(): LettersContextValue {
  const context = useContext(LettersContext);

  if (!context) {
    throw new Error('useLetters must be used within LettersProvider');
  }

  return context;
}
