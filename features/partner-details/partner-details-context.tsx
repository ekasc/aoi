import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import { partnerDetailsRepository } from '@/features/partner-details/partner-details-repository';
import type {
  CreatePartnerDetailInput,
  PartnerDetail,
} from '@/features/partner-details/types';
import { useSession } from '@/features/session/session-context';

export type PartnerDetailsContextValue = {
  details: PartnerDetail[];
  isLoading: boolean;
  addDetail: (input: CreatePartnerDetailInput) => Promise<void>;
  removeDetail: (detailId: string) => Promise<void>;
};

const PartnerDetailsContext = createContext<
  PartnerDetailsContextValue | undefined
>(undefined);

/**
 * The little things: small, concrete details about the partner (their
 * coffee order, the song that's theirs, the way they laugh). Stored
 * device-locally until the API grows a partner-details surface.
 */
export function PartnerDetailsProvider({ children }: PropsWithChildren) {
  const { user } = useSession();
  const userId = user?.id;
  const [details, setDetails] = useState<PartnerDetail[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setDetails([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const loaded = await partnerDetailsRepository.list(userId);

        if (!cancelled) {
          setDetails(loaded);
        }
      } catch {
        if (!cancelled) {
          setDetails([]);
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
  }, [userId]);

  const addDetail = useCallback(
    async (input: CreatePartnerDetailInput) => {
      const text = input.text.trim();

      if (!text || !userId) {
        return;
      }

      const detail: PartnerDetail = {
        id: `detail_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
        text,
        category: input.category ?? 'other',
        createdAt: new Date().toISOString(),
      };

      setDetails((current) => [detail, ...current]);
      await partnerDetailsRepository.add(userId, detail);
    },
    [userId]
  );

  const removeDetail = useCallback(
    async (detailId: string) => {
      if (!userId) {
        return;
      }

      setDetails((current) =>
        current.filter((detail) => detail.id !== detailId)
      );
      await partnerDetailsRepository.remove(userId, detailId);
    },
    [userId]
  );

  const value = useMemo(
    () => ({ details, isLoading, addDetail, removeDetail }),
    [addDetail, details, isLoading, removeDetail]
  );

  return (
    <PartnerDetailsContext.Provider value={value}>
      {children}
    </PartnerDetailsContext.Provider>
  );
}

export function usePartnerDetails(): PartnerDetailsContextValue {
  const context = useContext(PartnerDetailsContext);

  if (!context) {
    throw new Error('usePartnerDetails must be used within PartnerDetailsProvider');
  }

  return context;
}
