import { COLLECTION_STATUS_ORDER } from '@/constants/collection-status';
import type { CollectionItem } from '@/features/collections/types';

export type CollectionSort = 'added' | 'title' | 'backlog';

export const COLLECTION_SORT_ORDER: CollectionSort[] = ['added', 'title', 'backlog'];

export const COLLECTION_SORT_LABELS: Record<CollectionSort, string> = {
  added: 'Added',
  title: 'Title',
  backlog: 'Backlog',
};

/** Want first, then Doing, then Done; anything unmarked sits below them all. */
function backlogRank(status: CollectionItem['status']): number {
  const index = status ? COLLECTION_STATUS_ORDER.indexOf(status) : -1;
  return index === -1 ? COLLECTION_STATUS_ORDER.length : index;
}

/**
 * A sorted copy of the things, never the source. Ties keep their existing
 * order, so "Added" is the pair's own order and "Backlog" only groups by state.
 */
export function sortCollectionItems(
  items: CollectionItem[],
  sort: CollectionSort
): CollectionItem[] {
  const copy = [...items];
  if (sort === 'title') {
    return copy.sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
    );
  }
  if (sort === 'backlog') {
    return copy.sort(
      (a, b) => backlogRank(a.status) - backlogRank(b.status) || a.position - b.position
    );
  }
  return copy.sort((a, b) => a.position - b.position);
}
