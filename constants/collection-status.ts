import type { CollectionStatus } from '@/features/collections/types';

/**
 * The three states a thing can be in, in the order they progress.
 *
 * Generic on purpose: the same vocabulary has to read correctly for films,
 * recipes, and places, so it is "Want / Doing / Done" and nothing else. A pair
 * never configures it.
 */
export const COLLECTION_STATUS_ORDER: readonly CollectionStatus[] = ['want', 'doing', 'done'];

/** What a list page is showing: one status, or everything. */
export type CollectionFilter = 'all' | CollectionStatus;

export const COLLECTION_STATUS_LABELS: Record<CollectionStatus, string> = {
  want: 'Want',
  doing: 'Doing',
  done: 'Done',
};

export function collectionStatusLabel(
  status: CollectionStatus | null | undefined
): string | null {
  return status ? COLLECTION_STATUS_LABELS[status] : null;
}
