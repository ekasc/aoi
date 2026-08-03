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
import { mockMoments } from '@/features/moments/mock-data';
import {
  fetchMoments,
  fetchActivity,
  createMoment as remoteCreateMoment,
  updateMoment as remoteUpdateMoment,
  deleteMoment as remoteDeleteMoment,
} from '@/features/moments/remote-moments-api';
import type {
  CreateMomentInput,
  Moment,
  MomentsContextValue,
  SpaceActivityItem,
  UpdateMomentInput,
} from '@/features/moments/types';
import { useSession } from '@/features/session/session-context';
import { useSpace } from '@/features/space/space-context';
import type { ImportedMilestone } from '@/features/space/types';

const _useRemote = !isStubMode();

// Activity is provenance, not history — mirror the API's 7-day window.
const ACTIVITY_RETENTION_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ── Helpers (both modes) ─────────────────────────────────────────────────

function sortMomentsOldestFirst(moments: Moment[]) {
  return [...moments].sort(
    (left, right) =>
      new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime()
  );
}

function normalizeText(value?: string) {
  return value?.trim() ?? '';
}

function toLocalMoment(input: CreateMomentInput): Moment {
  const now = new Date();
  const occurredAt = input.occurredAt ?? now.toISOString();
  const title = normalizeText(input.title) || 'Untitled moment';
  const body = normalizeText(input.body);
  const authorRole = input.authorRole ?? 'you';

  return {
    id: `moment_${now.getTime()}_${Math.floor(Math.random() * 100000)}`,
    type: input.type,
    title,
    body,
    occurredAt,
    targetAt: input.targetAt ?? null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    authorId: input.authorId ?? 'user_you',
    authorRole,
    authorName: input.authorName ?? 'You',
    // Stub-mode ownership mirrors the authorRole semantics used at creation.
    isOwn: authorRole === 'you',
    mediaPreview: input.mediaPreview,
    audioUri: input.audioUri ?? null,
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
    updatedAt: milestone.createdAt,
    authorId: 'user_you',
    authorRole: 'you',
    authorName: 'You',
    // Milestones are imported by the current user for their own space.
    isOwn: true,
  };
}

function withinActivityRetention(occurredAt: string, now: number) {
  const timestamp = new Date(occurredAt).getTime();
  if (Number.isNaN(timestamp)) {
    return false;
  }
  return timestamp >= now - ACTIVITY_RETENTION_DAYS * MS_PER_DAY;
}

const MomentsContext = createContext<MomentsContextValue | undefined>(undefined);

// ── Remote implementation ────────────────────────────────────────────────

function useRemoteMoments(): MomentsContextValue {
  const [moments, setMoments] = useState<Moment[]>([]);
  const [activity, setActivity] = useState<SpaceActivityItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Request-sequence guards: overlapping focus refreshes can resolve out of
  // order, and only the newest request may write state (never let a stale
  // response overwrite fresh data).
  const momentsRequestSeq = useRef(0);
  const activityRequestSeq = useRef(0);
  const hasMomentsData = useRef(false);

  const loadMoments = useCallback(async () => {
    const requestId = ++momentsRequestSeq.current;
    // Background refreshes stay silent once data exists — no spinner flicker
    // on every app focus.
    if (!hasMomentsData.current) {
      setIsLoading(true);
    }
    setError(null);

    try {
      const allMoments: Moment[] = [];
      let cursor: string | undefined;

      do {
        const response = await fetchMoments(cursor, 100);
        allMoments.push(...response.moments);
        cursor = response.nextCursor;
      } while (cursor);

      if (requestId !== momentsRequestSeq.current) {
        return; // A newer request is in flight — drop this stale response.
      }
      hasMomentsData.current = true;
      setMoments(sortMomentsOldestFirst(allMoments));
    } catch (err) {
      if (requestId !== momentsRequestSeq.current) {
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to load moments');
    } finally {
      if (requestId === momentsRequestSeq.current) {
        setIsLoading(false);
      }
    }
  }, []);

  const loadActivity = useCallback(async () => {
    const requestId = ++activityRequestSeq.current;
    try {
      const response = await fetchActivity();
      if (requestId !== activityRequestSeq.current) {
        return; // Stale response — a newer request owns the state.
      }
      setActivity(response.activity);
    } catch {
      // Activity is provenance only — keep whatever we already have.
    }
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([loadMoments(), loadActivity()]);
  }, [loadActivity, loadMoments]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Pick up partner edits/deletes when the app returns to focus.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        void refresh();
      }
    });

    return () => subscription.remove();
  }, [refresh]);

  const addMoment = useCallback(async (input: CreateMomentInput) => {
    const created = await remoteCreateMoment(input);
    setMoments((prev) => sortMomentsOldestFirst([...prev, created]));
  }, []);

  const updateMoment = useCallback(
    async (momentId: string, patch: UpdateMomentInput) => {
      const updated = await remoteUpdateMoment(momentId, patch);
      setMoments((prev) =>
        sortMomentsOldestFirst(
          prev.map((moment) => (moment.id === momentId ? updated : moment))
        )
      );
    },
    []
  );

  const removeMoment = useCallback(
    async (momentId: string) => {
      await remoteDeleteMoment(momentId);
      setMoments((prev) => prev.filter((moment) => moment.id !== momentId));
      // The server recorded a tombstone; pick it up quietly.
      void loadActivity();
    },
    [loadActivity]
  );

  return useMemo(
    () => ({
      moments,
      activity,
      isLoading,
      error,
      addMoment,
      updateMoment,
      removeMoment,
      refresh,
    }),
    [
      activity,
      addMoment,
      error,
      isLoading,
      moments,
      refresh,
      removeMoment,
      updateMoment,
    ]
  );
}

// ── Stub (local) implementation ──────────────────────────────────────────

function useStubMoments(): MomentsContextValue {
  const { user } = useSession();
  const { importedMilestones } = useSpace();
  const [localMoments, setLocalMoments] = useState<Moment[]>([]);
  const [hiddenMomentIds, setHiddenMomentIds] = useState<Set<string>>(new Set());
  const [localActivity, setLocalActivity] = useState<SpaceActivityItem[]>([]);

  const importedMoments = useMemo(
    () => importedMilestones.map(toImportedMoment),
    [importedMilestones]
  );

  const baseMoments = useMemo(
    () => [...mockMoments, ...importedMoments],
    [importedMoments]
  );

  const moments = useMemo(() => {
    const byId = new Map<string, Moment>();

    baseMoments.forEach((moment) => byId.set(moment.id, moment));
    // Local moments are creates *and* edits — they override base entries.
    localMoments.forEach((moment) => byId.set(moment.id, moment));

    const visibleMoments = Array.from(byId.values()).filter(
      (moment) => !hiddenMomentIds.has(moment.id)
    );

    return sortMomentsOldestFirst(visibleMoments);
  }, [baseMoments, hiddenMomentIds, localMoments]);

  const activity = useMemo(() => {
    const now = Date.now();
    return localActivity.filter((item) =>
      withinActivityRetention(item.occurredAt, now)
    );
  }, [localActivity]);

  const addMoment = useCallback(async (input: CreateMomentInput) => {
    const nextMoment = toLocalMoment(input);
    return new Promise<void>((resolve) => {
      setLocalMoments((currentMoments) => {
        const updated = sortMomentsOldestFirst([...currentMoments, nextMoment]);
        // Use setTimeout to resolve after state update (best-effort for stub)
        setTimeout(resolve, 0);
        return updated;
      });
    });
  }, []);

  const updateMoment = useCallback(
    async (momentId: string, patch: UpdateMomentInput) => {
      const now = new Date().toISOString();
      setLocalMoments((currentMoments) => {
        const existing =
          currentMoments.find((moment) => moment.id === momentId) ??
          baseMoments.find((moment) => moment.id === momentId);

        if (!existing) {
          return currentMoments;
        }

        const updatedMoment: Moment = { ...existing, updatedAt: now };
        if (patch.type !== undefined) updatedMoment.type = patch.type;
        if (patch.title !== undefined) updatedMoment.title = normalizeText(patch.title);
        if (patch.body !== undefined) updatedMoment.body = normalizeText(patch.body);
        if (patch.occurredAt !== undefined) updatedMoment.occurredAt = patch.occurredAt;
        if (patch.targetAt !== undefined) updatedMoment.targetAt = patch.targetAt;
        if (patch.mediaPreview !== undefined) {
          updatedMoment.mediaPreview = patch.mediaPreview ?? undefined;
        }
        if (patch.audioUri !== undefined) updatedMoment.audioUri = patch.audioUri;

        const rest = currentMoments.filter((moment) => moment.id !== momentId);
        return [...rest, updatedMoment];
      });
    },
    [baseMoments]
  );

  const removeMoment = useCallback(async (momentId: string) => {
    setLocalMoments((currentMoments) =>
      currentMoments.filter((moment) => moment.id !== momentId)
    );
    setHiddenMomentIds((currentIds) => {
      const nextIds = new Set(currentIds);
      nextIds.add(momentId);
      return nextIds;
    });
    // Synthesize the tombstone the remote API would record. Remote mode
    // returns the actor's display name, so match that when we know it.
    const actorName = user?.displayName?.trim() || 'You';
    setLocalActivity((currentActivity) => [
      {
        id: `activity_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
        kind: 'moment_deleted',
        actorName,
        occurredAt: new Date().toISOString(),
      },
      ...currentActivity,
    ]);
  }, [user?.displayName]);

  const refresh = useCallback(async () => {
    // Local data is always current — nothing to sync in stub mode.
  }, []);

  return useMemo(
    () => ({
      moments,
      activity,
      isLoading: false,
      error: null,
      addMoment,
      updateMoment,
      removeMoment,
      refresh,
    }),
    [activity, addMoment, moments, refresh, removeMoment, updateMoment]
  );
}

// ── Provider ─────────────────────────────────────────────────────────────

export function MomentsProvider({ children }: PropsWithChildren) {
  const value = _useRemote ? useRemoteMoments() : useStubMoments();

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
