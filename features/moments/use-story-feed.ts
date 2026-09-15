import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useComposer } from '@/features/composer/composer-context';
import { useMoments } from '@/features/moments/moments-context';
import {
  sortFeedOldestFirst,
  visiblePendingRecords,
} from '@/features/moments/story-feed';
import type { PendingRecord } from '@/features/composer/types';
import type { Moment } from '@/features/moments/types';

/** Acknowledgement retries before a delivered record is left for the next pass. */
const ACK_ATTEMPTS = 3;
const ACK_RETRY_DELAY_MS = 1500;

export type StoryFeedValue = {
  /** The flat, oldest-first feed list: the single ordering the screen reads. */
  moments: Moment[];
  /** Total feed memories across sections (pending excluded). */
  totalCount: number;
  /** Unsent own memories to pin above the stream. */
  pending: PendingRecord[];
  /** Client ids currently sending (for row spinners). */
  sendingIds: string[];
  /** Bumps each time a just-saved memory lands in the feed. */
  keptTick: number;
  isLoading: boolean;
  isPaging: boolean;
  isRefreshing: boolean;
  error: string | null;
  /** Why the last older page failed, if it did; cleared when one lands. */
  pagingError: string | null;
  hasMore: boolean;
  /** Append the next bounded page. No-op while paging or exhausted. */
  loadMore: () => void;
  /** Re-fetch the head of the feed. */
  refresh: () => void;
};

/**
 * The Story feed is one newest-first mixed stream over the shared moments
 * context — the single feed source. No read cursors, no unread dividers,
 * no tombstones, no bucket discovery: months derive from whatever the
 * context has loaded, and endless scroll pages the same cursor the
 * context owns. Delivered composer records clear once their server id
 * lands in the feed.
 */
export function useStoryFeed(): StoryFeedValue {
  const {
    moments,
    isLoading,
    error,
    hasMoreMoments,
    loadMoreMoments,
    pagingError,
    refresh,
  } = useMoments();
  const { pending: composerPending, sendingIds, acknowledgeDelivered } = useComposer();

  const [isPaging, setIsPaging] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [keptTick, setKeptTick] = useState(0);
  const pagingRef = useRef(false);
  const refreshingRef = useRef(false);
  const ackTimersRef = useRef(new Set<ReturnType<typeof setTimeout>>());

  // One ordering, the one the archive is read in: oldest first, goals
  // excluded. The screen groups this list; it never re-sorts it back and
  // forth. (The context list is already oldest-first; this is the feed's own
  // filter boundary, which also drops Plans-owned goals.)
  const feed = useMemo(() => sortFeedOldestFirst(moments), [moments]);

  const feedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const moment of feed) {
      ids.add(moment.id);
    }
    return ids;
  }, [feed]);

  const pending = useMemo(
    () => visiblePendingRecords(composerPending, feedIds),
    [composerPending, feedIds],
  );

  // Delivered saves clear once the feed renders their server id. The feed
  // row itself is the confirmation, so no scroll jump is ever needed: a
  // newest memory is already at the top, and a backdated one sits in its
  // month where the writer expects it. Deferred to a timer so the ack never
  // syncs state during the render commit.
  const delivered = useMemo(
    () => composerPending.filter((record) => record.status === 'delivered' && record.deliveredMoment),
    [composerPending],
  );

  // An acknowledgement is a persisted write: dropping one strands the
  // record in "Kept in your story" forever, so a failure is retried a bounded
  // number of times instead of being swallowed.
  const acknowledge = useCallback(
    (clientId: string) => {
      const attempt = (remaining: number) => {
        void acknowledgeDelivered(clientId).catch(() => {
          if (remaining <= 1) {
            return;
          }
          const timer = setTimeout(() => {
            ackTimersRef.current.delete(timer);
            attempt(remaining - 1);
          }, ACK_RETRY_DELAY_MS);
          ackTimersRef.current.add(timer);
        });
      };
      attempt(ACK_ATTEMPTS);
    },
    [acknowledgeDelivered],
  );

  useEffect(() => {
    const timers = ackTimersRef.current;
    return () => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  useEffect(() => {
    if (delivered.length === 0) {
      return;
    }
    const landed = delivered.filter(
      (record) => record.deliveredMoment && feedIds.has(record.deliveredMoment.id),
    );
    if (landed.length === 0) {
      return;
    }
    const task = setTimeout(() => {
      setKeptTick((count) => count + landed.length);
      for (const record of landed) {
        acknowledge(record.clientId);
      }
    }, 0);
    return () => clearTimeout(task);
  }, [delivered, feedIds, acknowledge]);

  const loadMore = useCallback(() => {
    if (pagingRef.current || !hasMoreMoments) {
      return;
    }
    pagingRef.current = true;
    setIsPaging(true);
    void loadMoreMoments().finally(() => {
      pagingRef.current = false;
      setIsPaging(false);
    });
  }, [hasMoreMoments, loadMoreMoments]);

  const refreshFeed = useCallback(() => {
    if (refreshingRef.current) {
      return;
    }
    refreshingRef.current = true;
    setIsRefreshing(true);
    void refresh().finally(() => {
      refreshingRef.current = false;
      setIsRefreshing(false);
    });
  }, [refresh]);

  return useMemo(
    () => ({
      moments: feed,
      totalCount: feed.length,
      pending,
      sendingIds,
      keptTick,
      isLoading,
      isPaging,
      isRefreshing,
      error,
      pagingError,
      hasMore: hasMoreMoments,
      loadMore,
      refresh: refreshFeed,
    }),
    [
      feed,
      pending,
      sendingIds,
      keptTick,
      isLoading,
      isPaging,
      isRefreshing,
      error,
      pagingError,
      hasMoreMoments,
      loadMore,
      refreshFeed,
    ],
  );
}
