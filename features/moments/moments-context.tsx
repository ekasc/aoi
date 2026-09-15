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
import { mediaObjectUrl } from '@aoi/shared';
import { getPreviewSeedMoments, usePreviewVariant } from '@/features/dev/preview';
import { mockMoments } from '@/features/moments/mock-data';
import {
  fetchMoments,
  fetchActivity,
  fetchBucketSummary,
  createMoment as remoteCreateMoment,
  updateMoment as remoteUpdateMoment,
  deleteMoment as remoteDeleteMoment,
} from '@/features/moments/remote-moments-api';
import { filterChapterRange, summarizeBuckets } from '@/features/moments/chapters';
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

/** Append a fetched page without duplicating rows already held. */
function mergeMomentsById(current: Moment[], incoming: Moment[]): Moment[] {
  if (incoming.length === 0) {
    return [...current];
  }
  const byId = new Map(current.map((moment) => [moment.id, moment]));
  for (const moment of incoming) {
    byId.set(moment.id, moment);
  }
  return sortMomentsOldestFirst([...byId.values()]);
}

function toLocalMoment(input: CreateMomentInput): Moment {
  const now = new Date();
  const occurredAt = input.occurredAt ?? now.toISOString();
  const title = normalizeText(input.title);
  const body = normalizeText(input.body);
  const authorRole = input.authorRole ?? 'you';
  // Stub-mode attachment compat: the create input carries `{ mediaId, kind }`
  // only, while stored moments carry `{ mediaId, kind, url }`. Synthesize
  // stable serve URLs for explicit inputs (mirrors the server compat);
  // fall back to one legacy-derived entry so old photos stay visible.
  const attachments: NonNullable<Moment['attachments']> =
    input.attachments !== undefined
      ? input.attachments.map((a) => ({
          mediaId: a.mediaId,
          kind: a.kind,
          url: mediaObjectUrl(a.mediaId, a.kind === 'audio' ? 'original' : 'display'),
        }))
      : input.localAttachments && input.localAttachments.length > 0
        ? // Stub mode: every picked image/voice note, in order, addressed by
          // its local URI. `mediaId` is a local placeholder (never sent).
          input.localAttachments.map((a, index) => ({
            mediaId: `local_${index}_${a.kind}`,
            kind: a.kind,
            url: a.url,
          }))
        : input.mediaId
          ? [
              {
                mediaId: input.mediaId,
                kind: (input.audioUri ? 'audio' : 'image') as 'image' | 'audio',
                url: (input.audioUri ?? input.mediaPreview ?? '') as string,
              },
            ]
          : [];

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
    mediaId: input.mediaId ?? null,
    attachments,
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
    mediaId: null,
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
  // Shared cursor pagination: undefined = unstarted, string = next page,
  // null = exhausted. Any screen may advance it via loadMoreMoments; pages
  // stay bounded and exhausted cursors never refetch.
  const momentsCursorRef = useRef<string | null | undefined>(undefined);
  const loadMoreInFlightRef = useRef(false);
  const [hasMoreMoments, setHasMoreMoments] = useState(false);

  const loadMoments = useCallback(async () => {
    const requestId = ++momentsRequestSeq.current;
    // Background refreshes stay silent once data exists — no spinner flicker
    // on every app focus.
    if (!hasMomentsData.current) {
      setIsLoading(true);
    }
    setError(null);
    // A fresh load restarts pagination from the first bounded page; screens
    // chain loadMoreMoments from there to whatever depth they need.
    momentsCursorRef.current = undefined;
    setHasMoreMoments(false);

    try {
      const response = await fetchMoments(undefined, 100);

      if (requestId !== momentsRequestSeq.current) {
        return; // A newer request is in flight, drop this stale response.
      }
      momentsCursorRef.current = response.nextCursor ?? null;
      setHasMoreMoments(momentsCursorRef.current !== null);
      hasMomentsData.current = true;
      setMoments(sortMomentsOldestFirst(response.moments));
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
        return; // Stale response, a newer request owns the state.
      }
      setActivity(response.activity);
    } catch {
      // Activity is provenance only — keep whatever we already have.
    }
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([loadMoments(), loadActivity()]);
  }, [loadActivity, loadMoments]);

  const loadMoreMoments = useCallback(async (): Promise<boolean> => {
    if (loadMoreInFlightRef.current || momentsCursorRef.current === null) {
      return momentsCursorRef.current !== null;
    }
    loadMoreInFlightRef.current = true;
    const requestId = ++momentsRequestSeq.current;
    try {
      const response = await fetchMoments(momentsCursorRef.current, 100);
      if (requestId !== momentsRequestSeq.current) {
        return true; // Superseded, a newer request owns the cursor now.
      }
      momentsCursorRef.current = response.nextCursor ?? null;
      setHasMoreMoments(momentsCursorRef.current !== null);
      hasMomentsData.current = true;
      setMoments((prev) => mergeMomentsById(prev, response.moments));
      return momentsCursorRef.current !== null;
    } catch {
      // The cursor doesn't advance on failure, so the next call retries the
      // same bounded page instead of skipping it.
      return momentsCursorRef.current !== null;
    } finally {
      loadMoreInFlightRef.current = false;
    }
  }, []);

  const loadBucketSummary = useCallback(async (buckets: { fromMs: number; toMs: number }[]) => {
    return fetchBucketSummary(buckets);
  }, []);

  const loadChapterRange = useCallback(async (fromMs: number, toMs: number): Promise<Moment[]> => {
    // Page the range to completion (oldest-first for the reader). Bounded
    // by the range itself — and never touching the Story cursor.
    const collected: Moment[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await fetchMoments(cursor, 100, { fromMs, toMs });
      collected.push(...page.moments);
      if (!page.nextCursor) {
        break;
      }
      cursor = page.nextCursor;
    }
    return collected.sort((left, right) => {
      const timeDiff =
        new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime();
      if (timeDiff !== 0) {
        return timeDiff;
      }
      return left.id < right.id ? -1 : 1;
    });
  }, []);

  const loadGoals = useCallback(async (): Promise<Moment[]> => {
    // Type-filtered pages to completion (oldest-first for the reader).
    // Bounded by goal count, not archive size — and never touching the
    // Story cursor.
    const collected: Moment[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await fetchMoments(cursor, 100, { type: 'goal' });
      collected.push(...page.moments);
      if (!page.nextCursor) {
        break;
      }
      cursor = page.nextCursor;
    }
    return collected.sort((left, right) => {
      const leftTarget = left.targetAt ?? left.occurredAt;
      const rightTarget = right.targetAt ?? right.occurredAt;
      const timeDiff = new Date(leftTarget).getTime() - new Date(rightTarget).getTime();
      if (timeDiff !== 0) {
        return timeDiff;
      }
      return left.id < right.id ? -1 : 1;
    });
  }, []);

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
    // The mutation invalidates any in-flight refresh: bump the sequence so a
    // stale snapshot (fetched before this change) is dropped on arrival.
    momentsRequestSeq.current += 1;
    setMoments((prev) => sortMomentsOldestFirst([...prev, created]));
    return created;
  }, []);

  const updateMoment = useCallback(
    async (momentId: string, patch: UpdateMomentInput) => {
      const updated = await remoteUpdateMoment(momentId, patch);
      // The mutation invalidates any in-flight refresh: bump the sequence so a
      // stale snapshot (fetched before this change) is dropped on arrival.
      momentsRequestSeq.current += 1;
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
      // The mutation invalidates any in-flight refresh of both slices: bump
      // the sequences so stale snapshots (fetched before this change) are
      // dropped on arrival and never resurrect the deleted row.
      momentsRequestSeq.current += 1;
      activityRequestSeq.current += 1;
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
      hasMoreMoments,
      loadMoreMoments,
      loadBucketSummary,
      loadChapterRange,
      loadGoals,
      addMoment,
      updateMoment,
      removeMoment,
      refresh,
    }),
    [
      activity,
      addMoment,
      error,
      hasMoreMoments,
      isLoading,
      loadChapterRange,
      loadBucketSummary,
      loadGoals,
      loadMoreMoments,
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
  const preview = usePreviewVariant();
  const [localMoments, setLocalMoments] = useState<Moment[]>([]);
  const [hiddenMomentIds, setHiddenMomentIds] = useState<Set<string>>(new Set());
  const [localActivity, setLocalActivity] = useState<SpaceActivityItem[]>([]);

  const importedMoments = useMemo(
    () => importedMilestones.map(toImportedMoment),
    [importedMilestones]
  );

  const baseMoments = useMemo(
    // Dev-preview routes swap the thin unit-test seeds for a rich visual
    // spread (photos/voice/months) — same merging logic below. Inactive
    // everywhere else, including all unit tests and production.
    () =>
      preview.active
        ? getPreviewSeedMoments(preview.variant)
        : [...mockMoments, ...importedMoments],
    [preview, importedMoments]
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
    await new Promise<void>((resolve) => {
      setLocalMoments((currentMoments) => {
        const updated = sortMomentsOldestFirst([...currentMoments, nextMoment]);
        // Use setTimeout to resolve after state update (best-effort for stub)
        setTimeout(resolve, 0);
        return updated;
      });
    });
    return nextMoment;
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
        if (patch.mediaId !== undefined) updatedMoment.mediaId = patch.mediaId;

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

  const loadMoreMoments = useCallback(async () => false, []);

  const loadBucketSummary = useCallback(async (buckets: { fromMs: number; toMs: number }[]) => {
    return summarizeBuckets(moments, buckets);
  }, [moments]);

  const loadChapterRange = useCallback(async (fromMs: number, toMs: number) => {
    return filterChapterRange(moments, fromMs, toMs);
  }, [moments]);

  const loadGoals = useCallback(async () => {
    return moments
      .filter((moment) => moment.type === 'goal')
      .sort((left, right) => {
        const leftTarget = left.targetAt ?? left.occurredAt;
        const rightTarget = right.targetAt ?? right.occurredAt;
        const timeDiff = new Date(leftTarget).getTime() - new Date(rightTarget).getTime();
        if (timeDiff !== 0) {
          return timeDiff;
        }
        return left.id < right.id ? -1 : 1;
      });
  }, [moments]);

  return useMemo(
    () => ({
      moments,
      activity,
      isLoading: false,
      error: null,
      hasMoreMoments: false,
      loadMoreMoments,
      loadBucketSummary,
      loadChapterRange,
      loadGoals,
      addMoment,
      updateMoment,
      removeMoment,
      refresh,
    }),
    [activity, addMoment, loadChapterRange, loadBucketSummary, loadGoals, loadMoreMoments, moments, refresh, removeMoment, updateMoment]
  );
}

// ── Provider ─────────────────────────────────────────────────────────────
// Structural split: the outer provider calls NO hooks itself — it selects
// which implementation component to render. Each implementation owns an
// independent, unconditional hook tree, so hook order is stable per mount.

function RemoteMomentsProvider({ children }: PropsWithChildren) {
  const value = useRemoteMoments();

  return (
    <MomentsContext.Provider value={value}>{children}</MomentsContext.Provider>
  );
}

function StubMomentsProvider({ children }: PropsWithChildren) {
  const value = useStubMoments();

  return (
    <MomentsContext.Provider value={value}>{children}</MomentsContext.Provider>
  );
}

export function MomentsProvider({ children }: PropsWithChildren) {
  if (_useRemote) {
    return <RemoteMomentsProvider>{children}</RemoteMomentsProvider>;
  }

  return <StubMomentsProvider>{children}</StubMomentsProvider>;
}

export function useMoments() {
  const context = useContext(MomentsContext);

  if (!context) {
    throw new Error('useMoments must be used within MomentsProvider');
  }

  return context;
}
