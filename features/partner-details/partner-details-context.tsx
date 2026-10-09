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
import { createPartnerDetailRequestSchema } from '@aoi/shared';

import { partnerDetailsRepository } from '@/features/partner-details/partner-details-repository';
import type {
  CreatePartnerDetailInput,
  PartnerDetail,
} from '@/features/partner-details/types';
import { useSession } from '@/features/session/session-context';

export type PartnerDetailsContextValue = {
  details: PartnerDetail[];
  isLoading: boolean;
  error: string | null;
  reload: () => void;
  addDetail: (input: CreatePartnerDetailInput) => Promise<void>;
  removeDetail: (detailId: string) => Promise<void>;
};

const PartnerDetailsContext = createContext<
  PartnerDetailsContextValue | undefined
>(undefined);

/**
 * The little things: small, concrete details about the partner (their
 * coffee order, the song that's theirs, the way they laugh). Stored
 * privately for the signed-in user. Stub mode keeps device-local storage;
 * remote mode uses the authenticated partner-details API.
 */
export function PartnerDetailsProvider({ children }: PropsWithChildren) {
  const { user } = useSession();
  const userId = user?.id;
  const activeUserId = useRef(userId);
  useLayoutEffect(() => { activeUserId.current = userId; }, [userId]);
  const [revision, setRevision] = useState(0);
  const [stored, setStored] = useState<{
    userId: string | undefined;
    details: PartnerDetail[];
    error: string | null;
    revision: number;
  }>({ userId: undefined, details: [], error: null, revision: 0 });
  const sameUser = stored.userId === userId;
  const details = useMemo(() => sameUser ? stored.details : [], [sameUser, stored.details]);
  const isLoading = Boolean(userId) && (!sameUser || stored.revision !== revision);
  const error = sameUser && !isLoading ? stored.error : null;
  const reload = useCallback(() => setRevision((current) => current + 1), []);

  useEffect(() => {
    if (!userId) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const loaded = await partnerDetailsRepository.list(userId);

        if (!cancelled) {
          setStored({ userId, details: loaded, error: null, revision });
        }
      } catch {
        if (!cancelled) {
          setStored((current) => ({ userId, details: current.userId === userId ? current.details : [], error: 'Could not load your details.', revision }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, revision]);

  const addDetail = useCallback(
    async (input: CreatePartnerDetailInput) => {
      const text = input.text.trim();

      if (!text || !userId) {
        return;
      }
      const parsed = createPartnerDetailRequestSchema.parse({ text, category: input.category });

      const detail: PartnerDetail = {
        id: `detail_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
        text: parsed.text,
        category: parsed.category,
        createdAt: new Date().toISOString(),
      };

      const saved = await partnerDetailsRepository.add(userId, detail);
      if (activeUserId.current === userId) {
        setStored((current) => ({ userId, details: [saved, ...(current.userId === userId ? current.details : [])], error: null, revision }));
      }
    },
    [userId, revision]
  );

  const removeDetail = useCallback(
    async (detailId: string) => {
      if (!userId) {
        return;
      }

      await partnerDetailsRepository.remove(userId, detailId);
      if (activeUserId.current !== userId) return;
      setStored((current) => current.userId === userId
        ? { ...current, details: current.details.filter((detail) => detail.id !== detailId) }
        : current);
    },
    [userId]
  );

  const value = useMemo(
    () => ({ details, isLoading, error, reload, addDetail, removeDetail }),
    [addDetail, details, error, isLoading, reload, removeDetail]
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
