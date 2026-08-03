import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';

import { isStubMode } from '@/features/api-client';
import { createLocalSomedayRepository } from '@/features/someday/local-someday-repository';
import { remoteSomedayRepository } from '@/features/someday/remote-someday-repository';
import { sortSomedayItems } from '@/features/someday/someday-order';
import type {
  CreateSomedayItemInput,
  SomedayContextValue,
  SomedayItem,
  SomedayRepository,
} from '@/features/someday/types';
import { useSession } from '@/features/session/session-context';

const SomedayContext = createContext<SomedayContextValue | undefined>(undefined);

/**
 * The couple's shared "Someday" list: places to go, films to watch, tables
 * for two. Stub mode keeps the list device-local (AsyncStorage); remote mode
 * talks to the API so both partners see the same list, refreshed whenever
 * the app returns to focus.
 */
export function SomedayProvider({ children }: PropsWithChildren) {
  const { user } = useSession();
  const userId = user?.id;
  const [items, setItems] = useState<SomedayItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const itemsRef = useRef(items);
  itemsRef.current = items;

  const repository = useMemo<SomedayRepository | null>(() => {
    if (!userId) {
      return null;
    }

    return isStubMode()
      ? createLocalSomedayRepository(userId)
      : remoteSomedayRepository;
  }, [userId]);

  useEffect(() => {
    if (!repository) {
      setItems([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    void (async () => {
      try {
        const loaded = await repository.list();

        if (!cancelled) {
          setItems(sortSomedayItems(loaded));
          setError(null);
        }
      } catch {
        if (!cancelled) {
          setError('Your someday list could not be loaded right now.');
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
      setItems(sortSomedayItems(loaded));
      setError(null);
    } catch {
      setError('Your someday list could not be loaded right now.');
    }
  }, [repository]);

  // Partner changes appear when the app returns to focus (remote mode only;
  // the stub list lives on this device already).
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

  const addItem = useCallback(
    async (input: CreateSomedayItemInput) => {
      if (!repository) {
        return;
      }

      const created = await repository.add(input);
      setItems((current) => sortSomedayItems([created, ...current]));
    },
    [repository]
  );

  const setChecked = useCallback(
    async (itemId: string, checked: boolean) => {
      if (!repository) {
        return;
      }

      const previous = itemsRef.current;
      const optimisticAt = new Date().toISOString();

      // Move immediately; the server's answer (or a quiet rollback) follows.
      setItems((current) =>
        sortSomedayItems(
          current.map((item) => {
            if (item.id !== itemId) {
              return item;
            }

            if (checked) {
              if (item.checkedAt !== null) {
                return item;
              }
              return { ...item, checkedAt: optimisticAt, checkedByRole: 'you' as const };
            }

            if (item.checkedAt === null) {
              return item;
            }
            return { ...item, checkedAt: null, checkedByRole: null };
          })
        )
      );

      try {
        const updated = await repository.update(itemId, { checked });

        if (updated) {
          setItems((current) =>
            sortSomedayItems(
              current.map((item) => (item.id === itemId ? updated : item))
            )
          );
        } else {
          setItems(sortSomedayItems(previous));
        }
      } catch {
        // Tender-error policy: undo the optimistic move without drama; the
        // item simply stays where it really is.
        setItems(sortSomedayItems(previous));
      }
    },
    [repository]
  );

  const openItems = useMemo(
    () => items.filter((item) => item.checkedAt === null),
    [items]
  );

  const doneItems = useMemo(
    () => items.filter((item) => item.checkedAt !== null),
    [items]
  );

  const value = useMemo<SomedayContextValue>(
    () => ({
      items,
      openItems,
      doneItems,
      isLoading,
      error,
      addItem,
      setChecked,
      reload,
    }),
    [addItem, doneItems, error, isLoading, items, openItems, reload, setChecked]
  );

  return (
    <SomedayContext.Provider value={value}>{children}</SomedayContext.Provider>
  );
}

export function useSomeday(): SomedayContextValue {
  const context = useContext(SomedayContext);

  if (!context) {
    throw new Error('useSomeday must be used within SomedayProvider');
  }

  return context;
}
