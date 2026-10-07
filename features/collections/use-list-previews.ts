import { useEffect, useMemo, useState } from 'react';

import { useCollections } from '@/features/collections/collections-context';
import type {
  Collection,
  CollectionItem,
  CollectionStatus,
} from '@/features/collections/types';

/** What a list looks like from the outside: its first covers and its make-up. */
export type ListPreview = {
  /** Up to three covers, in list order; null where a thing has no photo. */
  covers: (string | null)[];
  /** The same three things' titles, for the placeholder initials. */
  titles: string[];
  counts: Record<CollectionStatus, number>;
  total: number;
};

const EMPTY_PREVIEW: ListPreview = {
  covers: [],
  titles: [],
  counts: { want: 0, doing: 0, done: 0 },
  total: 0,
};

/**
 * A preview of every list, for the Ours screen.
 *
 * Ours has to show what is inside each list without opening it, which the list
 * count alone cannot do. Reads each list once, keyed by the id set so a reorder
 * does not refetch.
 *
 * Known cost: this is one read per list. Fine for a handful of lists on a local
 * store; if a pair keeps many, the server should return the preview with the
 * list itself rather than N round trips.
 */
export function useListPreviews(collections: Collection[]): Record<string, ListPreview> {
  const { listItems } = useCollections();
  const ids = useMemo(() => collections.map((collection) => collection.id), [collections]);
  const key = ids.join('|');
  const [byId, setById] = useState<Record<string, CollectionItem[]>>({});
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  useEffect(() => {
    if (ids.length === 0) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const entries = await Promise.all(
          ids.map(async (id) => [id, await listItems(id)] as const)
        );
        if (!cancelled) {
          setById(Object.fromEntries(entries));
        }
      } catch {
        if (!cancelled) {
          setById({});
        }
      } finally {
        if (!cancelled) {
          setLoadedKey(key);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ids, key, listItems]);

  return useMemo(() => {
    const out: Record<string, ListPreview> = {};
    collections.forEach((collection) => {
      const items = byId[collection.id];
      if (!items) {
        out[collection.id] = EMPTY_PREVIEW;
        return;
      }
      const counts: Record<CollectionStatus, number> = { want: 0, doing: 0, done: 0 };
      items.forEach((item) => {
        if (item.status) {
          counts[item.status] += 1;
        }
      });
      const head = items.slice(0, 3);
      out[collection.id] = {
        covers: head.map((item) => item.coverUrl ?? null),
        titles: head.map((item) => item.title),
        counts,
        total: items.length,
      };
    });
    return out;
  }, [collections, byId]);
}

/** The one-line summary under a list's name, e.g. "12 things · 6 done". */
export function listSummary(preview: ListPreview | undefined): string {
  if (!preview || preview.total === 0) {
    return 'Nothing in it yet';
  }
  const things = preview.total === 1 ? '1 thing' : `${preview.total} things`;
  if (preview.counts.done > 0) {
    return `${things} · ${preview.counts.done} done`;
  }
  return things;
}
