import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useComposer } from '@/features/composer/composer-context';
import { useMoments } from '@/features/moments/moments-context';
import {
  groupFeedByMonth,
  sortFeedNewestFirst,
  visiblePendingRecords,
  type FeedMonthSection,
} from '@/features/moments/story-feed';
import type { PendingRecord } from '@/features/composer/types';
import type { Moment } from '@/features/moments/types';

export type StoryFeedValue = {
  /** Month sections, newest month first. */
  sections: FeedMonthSection[];
  /** The flat, newest-first feed list the sections were built from. */
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
  const { moments, isLoading, error, hasMoreMoments, loadMoreMoments, refresh } = useMoments();
  const { pending: composerPending, sendingIds, acknowledgeDelivered } = useComposer();

  const [isPaging, setIsPaging] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [keptTick, setKeptTick] = useState(0);
  const pagingRef = useRef(false);
  const refreshingRef = useRef(false);

  const feed = useMemo(() => sortFeedNewestFirst(moments), [moments]);
  const sections = useMemo(() => groupFeedByMonth(feed), [feed]);

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
        void acknowledgeDelivered(record.clientId).catch(() => {});
      }
    }, 0);
    return () => clearTimeout(task);
  }, [delivered, feedIds, acknowledgeDelivered]);

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
      sections,
      moments: feed,
      totalCount: feed.length,
      pending,
      sendingIds,
      keptTick,
      isLoading,
      isPaging,
      isRefreshing,
      error,
      hasMore: hasMoreMoments,
      loadMore,
      refresh: refreshFeed,
    }),
    [
      sections,
      feed,
      pending,
      sendingIds,
      keptTick,
      isLoading,
      isPaging,
      isRefreshing,
      error,
      hasMoreMoments,
      loadMore,
      refreshFeed,
    ],
  );
}
