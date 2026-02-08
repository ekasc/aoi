import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type PropsWithChildren,
} from 'react';

import { mockMoments } from '@/features/moments/mock-data';
import type {
  CreateMomentInput,
  Moment,
  MomentsContextValue,
} from '@/features/moments/types';

type MomentsAction =
  | { type: 'add'; payload: CreateMomentInput }
  | { type: 'remove'; payload: { id: string } };

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
    createdAt: now.toISOString(),
    authorId: input.authorId ?? 'user_you',
    authorRole: input.authorRole ?? 'you',
    authorName: input.authorName ?? 'You',
    mediaPreview: input.mediaPreview,
  };
}

function momentsReducer(state: Moment[], action: MomentsAction): Moment[] {
  if (action.type === 'add') {
    const nextMoment = toMoment(action.payload);
    return sortMomentsOldestFirst([...state, nextMoment]);
  }

  if (action.type === 'remove') {
    return state.filter((moment) => moment.id !== action.payload.id);
  }

  return state;
}

const MomentsContext = createContext<MomentsContextValue | undefined>(undefined);

export function MomentsProvider({ children }: PropsWithChildren) {
  const [moments, dispatch] = useReducer(
    momentsReducer,
    mockMoments,
    sortMomentsOldestFirst
  );

  const addMoment = useCallback((input: CreateMomentInput) => {
    dispatch({ type: 'add', payload: input });
  }, []);

  const removeMoment = useCallback((momentId: string) => {
    dispatch({ type: 'remove', payload: { id: momentId } });
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
