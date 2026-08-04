import { sortProposalsNewestFirst, type EventProposal } from '@aoi/shared';
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
import { createLocalProposalsRepository } from '@/features/proposals/local-proposals-repository';
import { remoteProposalsRepository } from '@/features/proposals/remote-proposals-repository';
import type {
  ProposalsContextValue,
  ProposalsRepository,
  ProposeInput,
} from '@/features/proposals/types';
import { useSession } from '@/features/session/session-context';

const ProposalsContext = createContext<ProposalsContextValue | undefined>(undefined);

/**
 * Proposals — "how about Saturday?" One partner suggests a time; only the
 * other can answer it, gently, and only while it is still pending. Accepting
 * turns the suggestion into a real calendar event. Stub mode keeps proposals
 * device-local (AsyncStorage) with a plainly simulated partner; remote mode
 * talks to the API, where the guards are enforced server-side. New partner
 * suggestions land quietly on the next focus (remote mode).
 */
export function ProposalsProvider({ children }: PropsWithChildren) {
  const { user } = useSession();
  const userId = user?.id;
  const [proposals, setProposals] = useState<EventProposal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const repository = useMemo<ProposalsRepository | null>(() => {
    if (!userId) {
      return null;
    }

    return isStubMode()
      ? createLocalProposalsRepository(userId)
      : remoteProposalsRepository;
  }, [userId]);

  useEffect(() => {
    if (!repository) {
      setProposals([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    void (async () => {
      try {
        const loaded = await repository.list();

        if (!cancelled) {
          setProposals(loaded);
          setError(null);
        }
      } catch {
        if (!cancelled) {
          setError('Your suggestions could not be loaded right now.');
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
      setProposals(loaded);
      setError(null);
    } catch {
      setError('Your suggestions could not be loaded right now.');
    }
  }, [repository]);

  // A newly suggested time from the partner appears when the app returns to
  // focus (remote mode only; the stub list lives on this device already).
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

  const propose = useCallback(
    async (input: ProposeInput) => {
      if (!repository) {
        throw new Error('Your suggestions are not available right now.');
      }

      const created = await repository.propose(input);
      setProposals((current) => sortProposalsNewestFirst([created, ...current]));
      setError(null);
      return created;
    },
    [repository]
  );

  const accept = useCallback(
    async (proposalId: string) => {
      if (!repository) {
        throw new Error('Your suggestions are not available right now.');
      }

      const resolved = await repository.accept(proposalId);
      setProposals((current) =>
        current.map((proposal) =>
          proposal.id === proposalId ? resolved : proposal
        )
      );
      return resolved;
    },
    [repository]
  );

  const decline = useCallback(
    async (proposalId: string) => {
      if (!repository) {
        throw new Error('Your suggestions are not available right now.');
      }

      const resolved = await repository.decline(proposalId);
      setProposals((current) =>
        current.map((proposal) =>
          proposal.id === proposalId ? resolved : proposal
        )
      );
      return resolved;
    },
    [repository]
  );

  const value = useMemo<ProposalsContextValue>(
    () => ({
      proposals,
      isLoading,
      error,
      propose,
      accept,
      decline,
      reload,
    }),
    [accept, decline, error, isLoading, propose, proposals, reload]
  );

  return (
    <ProposalsContext.Provider value={value}>{children}</ProposalsContext.Provider>
  );
}

export function useProposals(): ProposalsContextValue {
  const context = useContext(ProposalsContext);

  if (!context) {
    throw new Error('useProposals must be used within ProposalsProvider');
  }

  return context;
}
