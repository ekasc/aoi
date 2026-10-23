import type { CollectionItem, CollectionPreview } from '@/features/collections/types';

/** Up to three covers, matching what a shelf shows before it is opened. */
const COVER_COUNT = 3;

export const EMPTY_COLLECTION_PREVIEW: CollectionPreview = {
  covers: [],
  counts: { want: 0, doing: 0, done: 0 },
  titles: [],
  total: 0,
};

/**
 * Covers, counts, and total for one list, from items already in position order.
 *
 * One pass over the list rather than a filter per concern: the Ours screen asks
 * for this for every shelf at once, so the store read is paid once and this
 * stays linear in the items the caller already holds.
 */
export function previewFromItems(items: CollectionItem[]): CollectionPreview {
  const counts = { want: 0, doing: 0, done: 0 };
  for (const item of items) {
    if (item.status) {
      counts[item.status] += 1;
    }
  }
  const head = items.slice(0, COVER_COUNT);
  return {
    covers: head.map((item) => item.coverUrl ?? null),
    counts,
    titles: head.map((item) => item.title),
    total: items.length,
  };
}
