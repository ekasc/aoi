import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';

import { isStubMode } from '@/features/api-client';
import { createLocalMomentResponseRepository } from '@/features/responses/local-moment-response-repository';
import { remoteMomentResponseRepository } from '@/features/responses/remote-moment-response-repository';
import type {
  CreateMomentResponseInput,
  MomentResponse,
  MomentResponseRepository,
} from '@/features/responses/types';
import { useSession } from '@/features/session/session-context';
import { useSpace } from '@/features/space/space-context';

const ResponsesContext = createContext<ResponsesContextValue | undefined>(undefined);

/**
 * Responses to memories, keyed by the memory being looked at.
 *
 * Only the memory currently on screen is loaded. A response is only ever
 * read in the context of the memory it belongs to, so holding the whole
 * collection in memory would buy nothing and cost a fetch per row in the
 * archive.
 *
 * Stub mode keeps responses device-local (AsyncStorage), which is also what
 * makes the feature demonstrable end to end before the API route exists.
 */
export function ResponsesProvider({ children }: PropsWithChildren) {
  const { user } = useSession();
  const userId = user?.id;
  const { space } = useSpace();
  const spaceId = space?.id;
  const scope = useRef({ userId, spaceId });
  useLayoutEffect(() => { scope.current = { userId, spaceId }; }, [userId, spaceId]);
  const [responses, setResponses] = useState<MomentResponse[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards a slow response for memory A from landing after the reader has
  // already moved to memory B.
  const loadedForRef = useRef<string | null>(null);
  const mutationSeqRef = useRef(0);

  const repository = useMemo<MomentResponseRepository | null>(() => {
    if (!userId) {
      return null;
    }
    return isStubMode()
      ? createLocalMomentResponseRepository(userId)
      : remoteMomentResponseRepository;
  }, [userId]);

  const loadFor = useCallback(
    async (momentId: string | null) => {
      if (!repository || !momentId) {
        ++mutationSeqRef.current;
        setResponses([]);
        setError(null);
        setIsLoading(false);
        loadedForRef.current = null;
        return;
      }
      if (loadedForRef.current === momentId) {
        return;
      }
      loadedForRef.current = momentId;
      const seq = ++mutationSeqRef.current;
      setIsLoading(true);
      setError(null);
      setResponses([]);
      try {
        const loaded = await repository.listForMoment(momentId);
        if (mutationSeqRef.current !== seq) {
          return;
        }
        setResponses(loaded);
        setError(null);
      } catch {
        if (mutationSeqRef.current === seq) {
          setError('Could not load responses.');
          setResponses([]);
          loadedForRef.current = null;
        }
      } finally {
        if (mutationSeqRef.current === seq) {
          setIsLoading(false);
        }
      }
    },
    [repository],
  );

  const add = useCallback(
    async (input: CreateMomentResponseInput): Promise<boolean> => {
      if (!repository) {
        return false;
      }
      const seq = ++mutationSeqRef.current;
      try {
        const assertScope = () => {
          if (scope.current.userId !== userId || scope.current.spaceId !== spaceId) {
            throw new Error('The active space changed.');
          }
        };
        const created = await repository.add(input, assertScope);
        if (mutationSeqRef.current === seq) {
          setResponses((current) => [created, ...current]);
        }
        return true;
      } catch {
        return false;
      }
    },
    [repository, userId, spaceId],
  );

  // The partner's response can land while this memory is open; on return to
  // the app, re-read whatever is on screen.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && loadedForRef.current) {
        const momentId = loadedForRef.current;
        loadedForRef.current = null;
        void loadFor(momentId);
      }
    });
    return () => subscription.remove();
  }, [loadFor]);

  const value = useMemo<ResponsesContextValue>(
    () => ({ responses, isLoading, error, loadFor, add }),
    [responses, isLoading, error, loadFor, add]
  );

  return <ResponsesContext.Provider value={value}>{children}</ResponsesContext.Provider>;
}

export type ResponsesContextValue = {
  responses: MomentResponse[];
  isLoading: boolean;
  error: string | null;
  /** Load the exchange for a memory. Safe to call on every render. */
  loadFor: (momentId: string | null) => void;
  add: (input: CreateMomentResponseInput) => Promise<boolean>;
};

export function useResponses(): ResponsesContextValue {
  const value = useContext(ResponsesContext);
  if (!value) {
    throw new Error('useResponses must be used within a ResponsesProvider');
  }
  return value;
}
