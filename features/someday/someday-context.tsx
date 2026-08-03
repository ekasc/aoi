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

import { sortSomedayItems } from '@aoi/shared';

import { isStubMode } from '@/features/api-client';
import { createLocalSomedayRepository } from '@/features/someday/local-someday-repository';
import { remoteSomedayRepository } from '@/features/someday/remote-someday-repository';
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

  // Per-item mutation sequence: overlapping check/undo responses can resolve
  // out of order, so every mutation bumps the item's token and only the
  // newest one may apply its result or roll back (stale responses are
  // dropped instead of resurrecting state a newer mutation already replaced).
  const mutationSeqRef = useRef(new Map<string, number>());
  // Bumped whenever the whole list is replaced with server truth (initial
  // load, focus reload). A mutation that started before such a refresh must
  // never roll back afterwards — the fresh server state wins.
  const listEpochRef = useRef(0);

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
          listEpochRef.current += 1;
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
      // Fresh server truth replaces the list — invalidate any optimistic
      // rollback still in flight from before the refresh.
      listEpochRef.current += 1;
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

      const sequence = (mutationSeqRef.current.get(itemId) ?? 0) + 1;
      mutationSeqRef.current.set(itemId, sequence);
      const epoch = listEpochRef.current;

      const optimisticAt = new Date().toISOString();
      // Per-item undo material for a failed soft-undo — deliberately NOT a
      // list-wide snapshot, so a failure can never clobber fresher state.
      const previousItem = itemsRef.current.find((item) => item.id === itemId);

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

        // A newer mutation owns this item now — drop the stale response.
        if (mutationSeqRef.current.get(itemId) !== sequence) {
          return;
        }

        if (updated) {
          setItems((current) =>
            sortSomedayItems(
              current.map((item) => (item.id === itemId ? updated : item))
            )
          );
        } else {
          // The repository no longer has the item — let it go quietly.
          setItems((current) => current.filter((item) => item.id !== itemId));
        }
      } catch {
        // A newer mutation owns this item now — its outcome (or rollback)
        // is the only one allowed to touch state.
        if (mutationSeqRef.current.get(itemId) !== sequence) {
          return;
        }
        // A full refresh (initial load / focus reload) delivered server truth
        // after this mutation started — rolling back would clobber it.
        if (listEpochRef.current !== epoch) {
          return;
        }

        // Tender-error policy: undo the optimistic move without drama. Apply
        // the INVERSE transition to the current state — never restore a
        // snapshot, which would clobber fresher state a focus-triggered
        // reload may have brought in while the request was in flight.
        setItems((current) =>
          sortSomedayItems(
            current.map((item) => {
              if (item.id !== itemId) {
                return item;
              }

              if (checked) {
                // Only undo our own optimistic mark; if a reload already
                // delivered fresh server state, that state wins.
                if (item.checkedAt !== optimisticAt) {
                  return item;
                }
                return { ...item, checkedAt: null, checkedByRole: null };
              }

              if (item.checkedAt !== null || !previousItem) {
                return item;
              }
              return {
                ...item,
                checkedAt: previousItem.checkedAt,
                checkedByRole: previousItem.checkedByRole,
              };
            })
          )
        );
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
