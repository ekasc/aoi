import { useEffect, useMemo, useState } from 'react';

import { useCollections } from '@/features/collections/collections-context';
import { EMPTY_COLLECTION_PREVIEW } from '@/features/collections/collection-preview';
import type { Collection, CollectionPreview } from '@/features/collections/types';

/**
 * A preview of every list, for the Ours screen.
 *
 * Ours has to show what is inside each list without opening it, which the list
 * count alone cannot do. The whole set is asked for in one call: reading the
 * store once per list made this screen cost one full parse of the collections
 * document for every shelf on it.
 *
 * Keyed by the id set so a reorder, which does not change any id, still serves
 * the previews already held.
 */
export function useListPreviews(
  collections: Collection[]
): Record<string, CollectionPreview> {
  const { listPreviews } = useCollections();
  const ids = useMemo(
    () => collections.map((collection) => collection.id),
    [collections]
  );
  const key = ids.join('|');
  const [byId, setById] = useState<Record<string, CollectionPreview>>({});
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  useEffect(() => {
    if (ids.length === 0) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const next = await listPreviews(ids);
        if (!cancelled) {
          setById(next);
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
  }, [ids, key, listPreviews]);

  return useMemo(() => {
    const out: Record<string, CollectionPreview> = {};
    collections.forEach((collection) => {
      out[collection.id] = byId[collection.id] ?? EMPTY_COLLECTION_PREVIEW;
    });
    return out;
  }, [collections, byId]);
}

/** The one-line summary under a list's name, e.g. "12 things · 6 done". */
export function listSummary(preview: CollectionPreview | undefined): string {
  if (!preview || preview.total === 0) {
    return 'Nothing in it yet';
  }
  const things = preview.total === 1 ? '1 thing' : `${preview.total} things`;
  if (preview.counts.done > 0) {
    return `${things} · ${preview.counts.done} done`;
  }
  return things;
}
