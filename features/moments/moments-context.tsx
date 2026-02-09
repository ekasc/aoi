import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import { mockMoments } from '@/features/moments/mock-data';
import type {
  CreateMomentInput,
  Moment,
  MomentsContextValue,
} from '@/features/moments/types';
import { useSpace } from '@/features/space/space-context';
import type { ImportedMilestone } from '@/features/space/types';

function sortMomentsOldestFirst(moments: Moment[]) {
  return [...moments].sort(
    (left, right) =>
      new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime()
  );
}

function normalizeText(value?: string) {
  return value?.trim() ?? '';
}

function toMoment(input: CreateMomentInput): Moment {
  const now = new Date();
  const occurredAt = input.occurredAt ?? now.toISOString();
  const title = normalizeText(input.title) || 'Untitled moment';
  const body = normalizeText(input.body);

  return {
    id: `moment_${now.getTime()}_${Math.floor(Math.random() * 100000)}`,
    type: input.type,
    title,
    body,
    occurredAt,
    targetAt: input.targetAt ?? null,
    createdAt: now.toISOString(),
    authorId: input.authorId ?? 'user_you',
    authorRole: input.authorRole ?? 'you',
    authorName: input.authorName ?? 'You',
    mediaPreview: input.mediaPreview,
  };
}

function toImportedMoment(milestone: ImportedMilestone): Moment {
  return {
    id: milestone.id,
    type: milestone.type,
    title: milestone.title,
    body: milestone.body?.trim() || '',
    occurredAt: milestone.occurredAt,
    targetAt: milestone.type === 'goal' ? milestone.targetAt ?? null : null,
    createdAt: milestone.createdAt,
    authorId: 'user_you',
    authorRole: 'you',
    authorName: 'You',
  };
}

const MomentsContext = createContext<MomentsContextValue | undefined>(undefined);

export function MomentsProvider({ children }: PropsWithChildren) {
  const { importedMilestones } = useSpace();
  const [localMoments, setLocalMoments] = useState<Moment[]>([]);
  const [hiddenMomentIds, setHiddenMomentIds] = useState<Set<string>>(new Set());

  const importedMoments = useMemo(
    () => importedMilestones.map(toImportedMoment),
    [importedMilestones]
  );
  const moments = useMemo(() => {
    const byId = new Map<string, Moment>();

    [...mockMoments, ...importedMoments, ...localMoments].forEach((moment) => {
      if (!hiddenMomentIds.has(moment.id)) {
        byId.set(moment.id, moment);
      }
    });

    return sortMomentsOldestFirst(Array.from(byId.values()));
  }, [hiddenMomentIds, importedMoments, localMoments]);

  const addMoment = useCallback((input: CreateMomentInput) => {
    setLocalMoments((currentMoments) => {
      const nextMoment = toMoment(input);
      return sortMomentsOldestFirst([...currentMoments, nextMoment]);
    });
  }, []);

  const removeMoment = useCallback((momentId: string) => {
    setLocalMoments((currentMoments) =>
      currentMoments.filter((moment) => moment.id !== momentId)
    );
    setHiddenMomentIds((currentIds) => {
      const nextIds = new Set(currentIds);
      nextIds.add(momentId);
      return nextIds;
    });
  }, []);

  const value = useMemo(
    () => ({
      moments,
      addMoment,
      removeMoment,
    }),
    [addMoment, moments, removeMoment]
  );

  return (
    <MomentsContext.Provider value={value}>{children}</MomentsContext.Provider>
  );
}

export function useMoments() {
  const context = useContext(MomentsContext);

  if (!context) {
    throw new Error('useMoments must be used within MomentsProvider');
  }

  return context;
}
