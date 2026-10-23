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
import {
  bump,
  incrementTotals,
  recordSpan,
  recorderNow,
} from '@/features/dev/measurement-recorder';
import {
  buildSimulatedPartnerPost,
  CLEAR_SIMULATED_POSTS_KEY,
  loadSimulatedPosts,
  saveSimulatedPosts,
  SIMULATE_PARTNER_POST_KEY,
  type SimulatePartnerPostOverrides,
} from '@/features/dev/simulate-partner';
import { mediaObjectUrl } from '@aoi/shared';
import { getPreviewSeedMoments, usePreviewVariant } from '@/features/dev/preview';
import {
  fetchMoments,
  reconcileMoments,
  createMoment as remoteCreateMoment,
  updateMoment as remoteUpdateMoment,
  deleteMoment as remoteDeleteMoment,
} from '@/features/moments/remote-moments-api';
import { filterChapterRange } from '@/features/moments/chapters';
import type {
  CreateMomentInput,
  Moment,
  MomentsContextValue,
  UpdateMomentInput,
} from '@/features/moments/types';
import { useSpace } from '@/features/space/space-context';

const _useRemote = !isStubMode();

// One bound for every feed fetch: the head load and each older page. The
// server caps a page here too (and defaults far lower), and the feed wants a
// wide opening window because the reader scrolls an archive.
const MOMENTS_PAGE_LIMIT = 100;

function isWriteConflict(error: unknown): boolean {
  return error instanceof Error && 'status' in error && error.status === 409;
}

// ── Helpers (both modes) ─────────────────────────────────────────────────

/**
 * Oldest first — the feed's reading order — with the id as tiebreak so two
 * memories sharing a timestamp never swap places between pages (a swap under
 * `maintainVisibleContentPosition` moves the reader's row).
 */
function sortMomentsOldestFirst(moments: Moment[]) {
  return moments.map((moment) => ({ moment, time: occurredMs(moment) }))
    .sort((left, right) => {
      if (left.time !== right.time) return left.time < right.time ? -1 : 1;
      if (left.moment.id === right.moment.id) return 0;
      return left.moment.id < right.moment.id ? -1 : 1;
    })
    .map(({ moment }) => moment);
}

/** Milliseconds, or -Infinity when the date cannot be read. */
function occurredMs(moment: Moment): number {
  const ms = new Date(moment.occurredAt).getTime();
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

function compareOldestFirst(left: Moment, right: Moment): number {
  const leftMs = occurredMs(left);
  const rightMs = occurredMs(right);
  if (leftMs !== rightMs) {
    return leftMs < rightMs ? -1 : 1;
  }
  if (left.id === right.id) {
    return 0;
  }
  return left.id < right.id ? -1 : 1;
}

function normalizeText(value?: string) {
  return value?.trim() ?? '';
}

/** Append a fetched page without duplicating rows already held. */
export function mergeMomentsById(current: Moment[], incoming: Moment[]): Moment[] {
  if (incoming.length === 0) {
    return [...current];
  }
  const byId = new Map(current.map((moment) => [moment.id, moment]));
  for (const moment of incoming) {
    byId.set(moment.id, moment);
  }
  return sortMomentsOldestFirst([...byId.values()]);
}

/**
 * Prepend a page of strictly older memories, or null when that is not provable.
 *
 * Pagination walks backwards through an archive already held oldest-first, so
 * the ordinary case is a straight prepend and the full rebuild-and-sort that
 * reconciles arbitrary input is not needed. The conditions below are the whole
 * safety argument, and they are checked rather than assumed:
 *
 *   - the page is not empty, and does not repeat an id inside itself
 *   - it is itself in oldest-first order
 *   - its newest record is strictly older than the oldest record already held
 *   - it shares no id with what is already held
 *
 * Age ordering alone does NOT rule out a shared id, which is the trap here: a
 * partner can redate a row this side already holds, and the page would then
 * present an id already in the window with an older date. So the ids are
 * compared directly.
 *
 * That comparison is a set lookup per held row, and it is what makes this worth
 * doing at all: it replaces the general merge's sort, where every comparison
 * parses two dates.
 *
 * Anything that can reorder history keeps the general merge. A head refresh
 * prunes rows the server no longer returns, and a redated row can move across
 * the window in either direction.
 */
export function appendOlderPage(current: Moment[], incoming: Moment[]): Moment[] | null {
  if (incoming.length === 0) {
    return null;
  }

  const incomingIds = new Set<string>();
  for (const moment of incoming) {
    if (incomingIds.has(moment.id)) {
      return null;
    }
    incomingIds.add(moment.id);
  }

  for (let index = 1; index < incoming.length; index += 1) {
    if (compareOldestFirst(incoming[index - 1], incoming[index]) > 0) {
      return null;
    }
  }

  if (
    current.length > 0 &&
    compareOldestFirst(incoming[incoming.length - 1], current[0]) >= 0
  ) {
    return null;
  }

  for (const moment of current) {
    if (incomingIds.has(moment.id)) {
      return null;
    }
  }

  return [...incoming, ...current];
}

/**
 * Stub-mode attachment compat, shared by create and update: the input
 * carries `{ mediaId, kind }` only, while stored moments carry
 * `{ mediaId, kind, url }`. Synthesize stable serve URLs for explicit
 * inputs (mirrors the server compat) and fall back to one legacy-derived
 * entry so old photos stay visible.
 */
function toStoredAttachments(
  input: Pick<CreateMomentInput, 'attachments' | 'localAttachments' | 'mediaId' | 'audioUri' | 'mediaPreview'>,
): NonNullable<Moment['attachments']> {
  if (input.attachments !== undefined) {
    return input.attachments.map((a) => ({
      mediaId: a.mediaId,
      kind: a.kind,
      url: mediaObjectUrl(a.mediaId, a.kind === 'audio' ? 'original' : 'display'),
    }));
  }
  if (input.localAttachments && input.localAttachments.length > 0) {
    // Stub mode: every picked image/voice note, in order, addressed by its
    // local URI. `mediaId` is a local placeholder (never sent).
    return input.localAttachments.map((a, index) => ({
      mediaId: `local_${index}_${a.kind}`,
      kind: a.kind,
      url: a.url,
    }));
  }
  if (input.mediaId) {
    return [
      {
        mediaId: input.mediaId,
        kind: input.audioUri ? 'audio' : 'image',
        url: input.audioUri ?? input.mediaPreview ?? '',
      },
    ];
  }
  return [];
}

function toLocalMoment(input: CreateMomentInput): Moment {
  const now = new Date();
  const occurredAt = input.occurredAt ?? now.toISOString();
  const title = normalizeText(input.title);
  const body = normalizeText(input.body);
  const authorRole = input.authorRole ?? 'you';
  const attachments = toStoredAttachments(input);

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

const MomentsContext = createContext<MomentsContextValue | undefined>(undefined);

// ── Remote implementation ────────────────────────────────────────────────

function useRemoteMoments(): MomentsContextValue {
  const [moments, setMoments] = useState<Moment[]>([]);
  const loadedMomentsRef = useRef(moments);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The feed belongs to one space: nothing fires before the space is ready
  // (credentials are unpublished until session restore, so an eager mount
  // fetch 401s with no tokens and sticks until a manual retry), and the
  // archive below is always the current space's.
  const { space } = useSpace();
  const spaceId = space?.id ?? null;
  const spaceIdRef = useRef(spaceId);
  useLayoutEffect(() => {
    loadedMomentsRef.current = moments;
    spaceIdRef.current = spaceId;
  }, [moments, spaceId]);
  // Which archive the refs/state below belong to. Reset on change so a
  // previous space's rows, cursor, and in-flight responses can neither
  // linger nor merge into the new archive.
  const activeSpaceIdRef = useRef<string | null>(null);
  // Request-sequence guards: overlapping focus refreshes can resolve out of
  // order, and only the newest request may write state (never let a stale
  // response overwrite fresh data).
  const momentsRequestSeq = useRef(0);
  const hasMomentsData = useRef(false);
  // Shared cursor pagination: undefined = unstarted, string = next page,
  // null = exhausted. Any screen may advance it via loadMoreMoments; pages
  // stay bounded and exhausted cursors never refetch.
  const momentsCursorRef = useRef<string | null | undefined>(undefined);
  const loadMoreInFlightRef = useRef(false);
  // Counted, not a flag: overlapping head loads (a focus refresh landing on
  // top of another) must keep paging suppressed until the LAST one settles,
  // and a superseded one may not clear the suppression another still owns.
  const headLoadsInFlightRef = useRef(0);
  // The spinner belongs to the LOADS, not to one request: a load superseded
  // by a mutation must still be able to end the first paint's spinner.
  const loadsInFlightRef = useRef(0);
  const [hasMoreMoments, setHasMoreMoments] = useState(false);
  const [pagingError, setPagingError] = useState<string | null>(null);

  const loadMoments = useCallback(async () => {
    const requestSpaceId = activeSpaceIdRef.current;
    if (!requestSpaceId) return;
    const loaded = loadedMomentsRef.current;
    const requestId = ++momentsRequestSeq.current;
    const assertCurrent = () => {
      if (requestId !== momentsRequestSeq.current || requestSpaceId !== spaceIdRef.current) {
        throw new Error('Memory refresh superseded');
      }
    };
    headLoadsInFlightRef.current += 1;
    loadsInFlightRef.current += 1;
    // Background refreshes stay silent once data exists — no spinner flicker
    // on every app focus.
    if (!hasMomentsData.current) {
      setIsLoading(true);
    }
    setError(null);

    try {
      const requestStartedAt = recorderNow();
      const response = await fetchMoments(undefined, MOMENTS_PAGE_LIMIT);      recordSpan('request.moments.head', requestStartedAt, {
        records: response.moments.length,
        status: 200,
      });

      assertCurrent();
      const reconciled = await reconcileMoments(loaded, assertCurrent);
      assertCurrent();
      const loadedIds = new Set(loaded.map((moment) => moment.id));
      hasMomentsData.current = true;
      // Revalidation happens after the head read. For known ids it wins even
      // when the head still contains a just-deleted or just-redated snapshot.
      setMoments(mergeMomentsById(
        response.moments.filter((moment) => !loadedIds.has(moment.id)),
        reconciled
      ));
      // The cursor is the deepest page boundary the reader has reached. A
      // refresh only owns it before paging has started — otherwise it would
      // rewind the window and leave a hole between the head and the cursor.
      if (momentsCursorRef.current === undefined) {
        momentsCursorRef.current = response.nextCursor ?? null;
      }
      setHasMoreMoments(momentsCursorRef.current !== null);
    } catch (err) {
      if (requestId !== momentsRequestSeq.current || requestSpaceId !== spaceIdRef.current) {
        return;
      }
      // The cursor and hasMore are untouched: a head load that failed must
      // not silently end history paging.
      setError(err instanceof Error ? err.message : 'Failed to load moments');
    } finally {
      headLoadsInFlightRef.current = Math.max(0, headLoadsInFlightRef.current - 1);
      loadsInFlightRef.current = Math.max(0, loadsInFlightRef.current - 1);
      if (loadsInFlightRef.current === 0) {
        setIsLoading(false);
      }
    }
  }, []);

  const refresh = useCallback(async () => {
    if (activeSpaceIdRef.current !== spaceId) {
      activeSpaceIdRef.current = spaceId;
      momentsRequestSeq.current += 1;
      momentsCursorRef.current = undefined;
      hasMomentsData.current = false;
      loadMoreInFlightRef.current = false;
      setMoments([]);
      loadedMomentsRef.current = [];
      setError(null);
      setPagingError(null);
      setHasMoreMoments(false);
    }
    await loadMoments();
  }, [loadMoments, spaceId]);

  const loadMoreMoments = useCallback(async (): Promise<boolean> => {
    // Never page against a head load that is still in flight: it may be
    // about to replace the window the cursor points past.
    if (
      loadMoreInFlightRef.current ||
      headLoadsInFlightRef.current > 0 ||
      momentsCursorRef.current === null
    ) {
      return momentsCursorRef.current !== null;
    }
    loadMoreInFlightRef.current = true;
    // Pages do not bump the request sequence: a page must not invalidate a
    // head refresh or a mutation that started after it. They capture the
    // current one instead, so anything newer that lands drops the page.
    const generation = momentsRequestSeq.current;
    setPagingError(null);
    try {
      const requestStartedAt = recorderNow();
      const response = await fetchMoments(momentsCursorRef.current, MOMENTS_PAGE_LIMIT);
      incrementTotals('pageRequests');
      recordSpan('request.moments.page', requestStartedAt, {
        records: response.moments.length,
        status: 200,
      });
      if (generation !== momentsRequestSeq.current) {
        return true; // Superseded: the newer operation owns the window now.
      }
      momentsCursorRef.current = response.nextCursor ?? null;
      setHasMoreMoments(momentsCursorRef.current !== null);
      hasMomentsData.current = true;
      // Older pages prepend; the general merge is the fallback for a page the
      // fast path cannot prove is strictly older and self-consistent.
      setMoments((prev) => {
        // React may evaluate this updater more than once for one update, so it
        // is counted as attempted merge work. Committed work is attributed by
        // the Profiler instead of being inferred from here.
        const mergeStartedAt = recorderNow();
        const next =
          appendOlderPage(prev, response.moments) ??
          mergeMomentsById(prev, response.moments);
        bump('mergeEvaluations');
        recordSpan('merge.attempted', mergeStartedAt, { held: prev.length });
        return next;
      });
      return momentsCursorRef.current !== null;
    } catch (err) {
      // The cursor doesn't advance on failure, so a retry fetches the same
      // bounded page instead of skipping it — but the failure is reported,
      // because a page that never arrives must not look like "nothing yet".
      if (generation === momentsRequestSeq.current) {
        setPagingError(
          err instanceof Error ? err.message : 'Failed to load earlier memories'
        );
      }
      return momentsCursorRef.current !== null;
    } finally {
      loadMoreInFlightRef.current = false;
    }
  }, []);

  const loadChapterRange = useCallback(async (fromMs: number, toMs: number): Promise<Moment[]> => {
    // Page the range to completion (oldest-first for the reader). Bounded
    // by the range itself — and never touching the Story cursor.
    const collected: Moment[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await fetchMoments(cursor, MOMENTS_PAGE_LIMIT, { fromMs, toMs });
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
      const page = await fetchMoments(cursor, MOMENTS_PAGE_LIMIT, { type: 'goal' });
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
    if (!spaceId) {
      return;
    }
    void refresh();
  }, [refresh, spaceId]);

  // Pick up partner edits/deletes when the app returns to focus.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active' && spaceId) {
        void refresh();
      }
    });

    return () => subscription.remove();
  }, [refresh, spaceId]);

  const addMoment = useCallback(async (input: CreateMomentInput) => {
    const created = await remoteCreateMoment(input);
    // The mutation invalidates any in-flight refresh: bump the sequence so a
    // stale snapshot (fetched before this change) is dropped on arrival.
    momentsRequestSeq.current += 1;
    setMoments((prev) => sortMomentsOldestFirst([...prev, created]));
    return created;
  }, []);

  const reloadConflictedMoment = useCallback(async (momentId: string, requestSpaceId: string | null) => {
    if (!requestSpaceId || spaceIdRef.current !== requestSpaceId) return;
    const generation = ++momentsRequestSeq.current;
    const assertCurrent = () => {
      if (generation !== momentsRequestSeq.current || spaceIdRef.current !== requestSpaceId) {
        throw new Error('Memory refresh superseded');
      }
    };
    try {
      const latest = await reconcileMoments([{ id: momentId }], assertCurrent);
      assertCurrent();
      setMoments((prev) => mergeMomentsById(prev.filter((moment) => moment.id !== momentId), latest));
    } catch {
      // The original conflict remains actionable even if its follow-up read fails.
    }
  }, []);

  const updateMoment = useCallback(
    async (momentId: string, patch: UpdateMomentInput) => {
      const requestSpaceId = spaceIdRef.current;
      let updated: Moment;
      try {
        updated = await remoteUpdateMoment(momentId, patch);
      } catch (error) {
        if (isWriteConflict(error)) await reloadConflictedMoment(momentId, requestSpaceId);
        throw error;
      }
      // The mutation invalidates any in-flight refresh: bump the sequence so a
      // stale snapshot (fetched before this change) is dropped on arrival.
      momentsRequestSeq.current += 1;
      setMoments((prev) =>
        sortMomentsOldestFirst(
          prev.map((moment) => (moment.id === momentId ? updated : moment))
        )
      );
    },
    [reloadConflictedMoment]
  );

  const removeMoment = useCallback(
    async (momentId: string, expectedUpdatedAt: string) => {
      const requestSpaceId = spaceIdRef.current;
      try {
        await remoteDeleteMoment(momentId, expectedUpdatedAt);
      } catch (error) {
        if (isWriteConflict(error)) await reloadConflictedMoment(momentId, requestSpaceId);
        throw error;
      }
      // The mutation invalidates any in-flight refresh of both slices: bump
      // the sequences so stale snapshots (fetched before this change) are
      // dropped on arrival and never resurrect the deleted row.
      momentsRequestSeq.current += 1;
      setMoments((prev) => prev.filter((moment) => moment.id !== momentId));
    },
    [reloadConflictedMoment]
  );

  return useMemo(
    () => ({
      moments,
      isLoading,
      error,
      hasMoreMoments,
      loadMoreMoments,
      pagingError,
      loadChapterRange,
      loadGoals,
      addMoment,
      updateMoment,
      removeMoment,
      refresh,
    }),
    [
      addMoment,
      error,
      hasMoreMoments,
      isLoading,
      loadChapterRange,
      loadGoals,
      loadMoreMoments,
      moments,
      pagingError,
      refresh,
      removeMoment,
      updateMoment,
    ]
  );
}

// ── Stub (local) implementation ──────────────────────────────────────────

function useStubMoments(): MomentsContextValue {
  const { space } = useSpace();
  const preview = usePreviewVariant();
  const [localMoments, setLocalMoments] = useState<Moment[]>([]);
  const [hiddenMomentIds, setHiddenMomentIds] = useState<Set<string>>(new Set());
  // Synchronous writes prevent two callers in one React batch from using the same version.
  const localWrites = useRef(new Map<string, Moment | null>());

  const baseMoments = useMemo(
    // Dev-preview routes render a rich visual spread (photos/voice/months).
    // Everywhere else the feed is only what this space actually holds. Nothing
    // is seeded, so a space with no memories shows the empty archive — the
    // first-run screen — instead of mock content that was never written.
    () => (preview.active ? getPreviewSeedMoments(preview.variant) : []),
    [preview]
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

  const addMoment = useCallback(async (input: CreateMomentInput) => {
    const nextMoment = toLocalMoment(input);
    localWrites.current.set(nextMoment.id, nextMoment);
    // Pure updater: the next list is derived from the current one inside the
    // updater, and the promise resolves once the caller's own await settles.
    // (The old version resolved a promise from inside the updater, which is a
    // side effect in render-phase code and can resolve twice under StrictMode.)
    setLocalMoments((currentMoments) =>
      sortMomentsOldestFirst([...currentMoments, nextMoment])
    );
    return nextMoment;
  }, []);

  // Dev-only two-user simulator (see features/dev/simulate-partner.ts):
  // with one phone there is no other way to receive a partner post.
  // Planted posts persist so the unread flow survives the reload it needs
  // to be tested. Never linked from UI; the globals below are evaluated
  // from the Metro console (`dev:eval`) while the app runs.
  useEffect(() => {
    if (!__DEV__) {
      return;
    }
    let live = true;
    void loadSimulatedPosts().then((stored) => {
      if (!live || stored.length === 0) {
        return;
      }
      setLocalMoments((currentMoments) => {
        const ids = new Set(currentMoments.map((moment) => moment.id));
        const missing = stored.filter((post) => !ids.has(post.id));
        return missing.length === 0
          ? currentMoments
          : sortMomentsOldestFirst([...currentMoments, ...missing]);
      });
    });
    const globals = globalThis as unknown as Record<string, unknown>;
    globals[SIMULATE_PARTNER_POST_KEY] = async (
      overrides: SimulatePartnerPostOverrides = {},
    ) => {
      const created = await addMoment(
        buildSimulatedPartnerPost(space?.partnerName, overrides),
      );
      const stored = await loadSimulatedPosts();
      const merged = new Map(stored.map((post) => [post.id, post]));
      merged.set(created.id, created);
      await saveSimulatedPosts([...merged.values()]);
      return created;
    };
    globals[CLEAR_SIMULATED_POSTS_KEY] = async () => {
      const stored = await loadSimulatedPosts();
      const ids = new Set(stored.map((post) => post.id));
      setLocalMoments((currentMoments) =>
        currentMoments.filter((moment) => !ids.has(moment.id)),
      );
      await saveSimulatedPosts([]);
    };
    return () => {
      live = false;
    };
  }, [addMoment, space?.partnerName]);

  const updateMoment = useCallback(
    async (momentId: string, patch: UpdateMomentInput) => {
      const existing = localWrites.current.has(momentId)
        ? localWrites.current.get(momentId)
        : moments.find((moment) => moment.id === momentId);
      if (!existing || Date.parse(existing.updatedAt ?? existing.createdAt) !== Date.parse(patch.expectedUpdatedAt)) {
        throw new Error('This memory changed on another device. Reopen it before trying again.');
      }
      const now = new Date(Math.max(Date.now(), Date.parse(existing.updatedAt ?? existing.createdAt) + 1)).toISOString();
      const updatedMoment: Moment = { ...existing, updatedAt: now };
      if (patch.type !== undefined) updatedMoment.type = patch.type;
      if (patch.title !== undefined) updatedMoment.title = normalizeText(patch.title);
      if (patch.body !== undefined) updatedMoment.body = normalizeText(patch.body);
      if (patch.occurredAt !== undefined) updatedMoment.occurredAt = patch.occurredAt;
      if (patch.targetAt !== undefined) updatedMoment.targetAt = patch.targetAt;
      if (patch.mediaPreview !== undefined) updatedMoment.mediaPreview = patch.mediaPreview ?? undefined;
      if (patch.audioUri !== undefined) updatedMoment.audioUri = patch.audioUri;
      if (patch.mediaId !== undefined) updatedMoment.mediaId = patch.mediaId;
      if (patch.attachments !== undefined) {
        updatedMoment.attachments = toStoredAttachments({ attachments: patch.attachments });
      }
      localWrites.current.set(momentId, updatedMoment);
      setLocalMoments((currentMoments) => {
        const rest = currentMoments.filter((moment) => moment.id !== momentId);
        return [...rest, updatedMoment];
      });
    },
    [moments]
  );

  const removeMoment = useCallback(async (momentId: string, expectedUpdatedAt: string) => {
    const existing = localWrites.current.has(momentId)
      ? localWrites.current.get(momentId)
      : moments.find((moment) => moment.id === momentId);
    if (!existing || Date.parse(existing.updatedAt ?? existing.createdAt) !== Date.parse(expectedUpdatedAt)) {
      throw new Error('This memory changed on another device. Reopen it before trying again.');
    }
    localWrites.current.set(momentId, null);
    setLocalMoments((currentMoments) =>
      currentMoments.filter((moment) => moment.id !== momentId)
    );
    setHiddenMomentIds((currentIds) => {
      const nextIds = new Set(currentIds);
      nextIds.add(momentId);
      return nextIds;
    });
  }, [moments]);

  const refresh = useCallback(async () => {
    // Local data is always current — nothing to sync in stub mode.
  }, []);

  const loadMoreMoments = useCallback(async () => false, []);

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
      isLoading: false,
      error: null,
      hasMoreMoments: false,
      loadMoreMoments,
      pagingError: null,
      loadChapterRange,
      loadGoals,
      addMoment,
      updateMoment,
      removeMoment,
      refresh,
    }),
    [addMoment, loadChapterRange, loadGoals, loadMoreMoments, moments, refresh, removeMoment, updateMoment]
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
