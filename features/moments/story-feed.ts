import type { PendingRecord } from '@/features/composer/types';
import type { Moment } from '@/features/moments/types';

// Pure Story-feed helpers (no hooks, no native deps). The feed is a single
// newest-first mixed stream: every memory kind except Plans-owned goals
// renders inline (photos large, notes and voice in place), grouped under
// month sections that link out to their chapter. There is no read state,
// no unread divider, and no second data source — the moments context list
// is the only feed input.

/** Memory kinds that never render in the Story feed (Plans owns goals). */
const EXCLUDED_FEED_TYPES: ReadonlySet<string> = new Set(['goal']);

function occurredMs(value: string): number {
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/** Newest-first feed order; equal timestamps break by id for stability. */
export function compareFeedDesc(left: Moment, right: Moment): number {
  const diff = occurredMs(right.occurredAt) - occurredMs(left.occurredAt);
  if (diff !== 0) {
    return diff;
  }
  if (left.id === right.id) {
    return 0;
  }
  return left.id < right.id ? -1 : 1;
}

/** Feed-eligible copy of a moments list, newest first. */
export function sortFeedNewestFirst(moments: Moment[]): Moment[] {
  return moments.filter((moment) => !EXCLUDED_FEED_TYPES.has(moment.type)).sort(compareFeedDesc);
}

/** Local-calendar month key (YYYY-MM) for a memory's actual occurredAt. */
export function feedMonthKey(occurredAt: string): string | null {
  const date = new Date(occurredAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${date.getFullYear()}-${month}`;
}

/** Month section heading, e.g. "September 2026". Empty for bad dates. */
export function formatFeedMonthHeading(occurredAt: string): string {
  const date = new Date(occurredAt);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export type FeedMonthSection = {
  /** Stable section id: `month:YYYY-MM` (matches the chapter route id). */
  id: string;
  /** Local month key, e.g. `2026-09`. */
  monthKey: string;
  /** Section heading, e.g. `September 2026`. */
  label: string;
  /** `1 memory` / `N memories`. */
  countLabel: string;
  moments: Moment[];
};

/** Feed-eligible copy of a moments list, oldest first (chat order). */
export function sortFeedOldestFirst(moments: Moment[]): Moment[] {
  return moments
    .filter((moment) => !EXCLUDED_FEED_TYPES.has(moment.type))
    .sort((left, right) => compareFeedDesc(right, left));
}

/**
 * Chronological grouping: the newest memory sits at the BOTTOM, so months
 * read oldest-first and each month's memories run oldest-first inside it.
 * Undated memories stay last.
 */
export function groupFeedChronological(moments: Moment[]): FeedMonthSection[] {
  return groupFeedByMonth(sortFeedOldestFirst(moments));
}

/**
 * Group an already newest-first feed list into month sections, newest
 * month first. Memories with unparseable dates collect in a trailing
 * `Undated` section so nothing silently vanishes.
 */
export function groupFeedByMonth(feed: Moment[]): FeedMonthSection[] {
  const sections: FeedMonthSection[] = [];
  let current: FeedMonthSection | null = null;
  const undated: Moment[] = [];
  for (const moment of feed) {
    const key = feedMonthKey(moment.occurredAt);
    if (!key) {
      undated.push(moment);
      continue;
    }
    if (!current || current.monthKey !== key) {
      current = {
        id: `month:${key}`,
        monthKey: key,
        label: formatFeedMonthHeading(moment.occurredAt),
        countLabel: '',
        moments: [],
      };
      sections.push(current);
    }
    current.moments.push(moment);
  }
  for (const section of sections) {
    const count = section.moments.length;
    section.countLabel = count === 1 ? '1 memory' : `${count} memories`;
  }
  if (undated.length > 0) {
    sections.push({
      id: 'month:undated',
      monthKey: 'undated',
      label: 'Undated',
      countLabel: undated.length === 1 ? '1 memory' : `${undated.length} memories`,
      moments: undated,
    });
  }
  return sections;
}

/**
 * Pending composer records that still need a feed row. A `delivered`
 * record drops out once its server moment id is in the feed (no duplicate
 * row); everything else (queued/sending/failed) always shows so an unsent
 * memory is never invisible.
 */
export function visiblePendingRecords(
  pending: PendingRecord[],
  feedIds: Set<string>,
): PendingRecord[] {
  return pending.filter((record) => {
    if (record.status === 'delivered' && record.deliveredMoment) {
      return !feedIds.has(record.deliveredMoment.id);
    }
    return true;
  });
}

/** Archive filter for the Memories tab. */
export type FeedTypeFilter = 'all' | 'photos' | 'notes' | 'voice' | 'letters';

/** The kinds the archive is expected to hold; letters land next. */
export type FeedArchiveType = 'photos' | 'notes' | 'voice' | 'letters' | 'other';

/** Which archive bucket a memory belongs to. */
export function feedTypeOf(moment: Moment): FeedArchiveType {
  // Video is visual media; the archive folds it into Photos until a
  // dedicated video bucket exists. (Dev previews seed videoUri only.)
  if (moment.videoUri) {
    return 'photos';
  }
  if (moment.mediaPreview || moment.type === 'media') {
    return 'photos';
  }
  if (moment.audioUri || moment.type === 'trace') {
    return 'voice';
  }
  if (moment.type === 'note' || moment.type === 'milestone' || moment.type === 'date') {
    return 'notes';
  }
  return 'other';
}

/** Case-insensitive match over the words a person would search by. */
export function matchesFeedQuery(moment: Moment, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return (
    moment.title.toLowerCase().includes(needle) ||
    moment.body.toLowerCase().includes(needle) ||
    moment.authorName.toLowerCase().includes(needle) ||
    (moment.tags ?? []).some((tag) => tag.toLowerCase().includes(needle))
  );
}

/** Apply the type filter and the search query to an already newest-first list. */
export function filterFeedMoments(
  moments: Moment[],
  options: { query: string; type: FeedTypeFilter },
): Moment[] {
  return moments.filter(
    (moment) =>
      (options.type === 'all' || feedTypeOf(moment) === options.type) &&
      matchesFeedQuery(moment, options.query)
  );
}

export type FeedTypeCounts = {
  all: number;
  photos: number;
  notes: number;
  voice: number;
  letters: number;
};

export function countFeedTypes(moments: Moment[]): FeedTypeCounts {
  const counts: FeedTypeCounts = {
    all: moments.length,
    photos: 0,
    notes: 0,
    voice: 0,
    letters: 0,
  };
  for (const moment of moments) {
    const type = feedTypeOf(moment);
    if (type === 'photos') {
      counts.photos += 1;
    } else if (type === 'notes') {
      counts.notes += 1;
    } else if (type === 'voice') {
      counts.voice += 1;
    }
  }
  return counts;
}

/**
 * Row index of each month's first row, for the "jump to month" index. Rows
 * come from the same FeedRow list the list renders, so the index is exact.
 * `shortLabel` keeps the chip compact and distinct from the section header.
 */
export function monthJumpTargets(
  rows: { kind: string; key: string; section?: FeedMonthSection }[],
): { monthKey: string; label: string; shortLabel: string; index: number }[] {
  const targets: { monthKey: string; label: string; shortLabel: string; index: number }[] = [];
  rows.forEach((row, index) => {
    if (row.kind === 'month' && row.section) {
      targets.push({
        monthKey: row.section.monthKey,
        label: row.section.label,
        shortLabel: shortMonthLabel(row.section.monthKey),
        index,
      });
    }
  });
  return targets;
}

function shortMonthLabel(monthKey: string): string {
  if (monthKey === 'undated') {
    return 'Undated';
  }
  const date = new Date(`${monthKey}-01T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return monthKey;
  }
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}
