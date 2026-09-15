import { useCallback, useEffect, useMemo, useState } from 'react';

import { useMoments } from '@/features/moments/moments-context';
import type { Moment } from '@/features/moments/types';

export type UseMomentResult = {
  moment: Moment | null;
  isLoading: boolean;
  error: string | null;
  /** Re-resolves from context, falling back to the bounded day-range load. */
  reload: () => void;
};

/** Local-midnight to next-local-midnight, so DST days stay calendar-correct. */
export function dayBounds(atMs: number): { fromMs: number; toMs: number } {
  const day = new Date(atMs);
  day.setHours(0, 0, 0, 0);
  const fromMs = day.getTime();
  const next = new Date(day);
  next.setDate(day.getDate() + 1);
  return { fromMs, toMs: next.getTime() };
}

const LOAD_FAILED_MESSAGE = 'Could not load this memory. Please try again.';

/**
 * Resolves one moment by id. Context first; when missing and an `at`
 * occurredAt hint is present, one bounded day-range load
 * (loadChapterRange over that local day) covers old chapter/goal entries
 * without sweeping the archive. No new backend, no cursor changes.
 */
export function useMoment(id: string | undefined, at?: string | null): UseMomentResult {
  const { moments, isLoading: contextLoading, loadChapterRange } = useMoments();
  const [attempt, setAttempt] = useState(0);

  const reload = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  const atMs = useMemo(() => {
    if (!at) return null;
    const parsed = new Date(at).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  }, [at]);

  const resident = id ? (moments.find((item) => item.id === id) ?? null) : null;
  const residentId = resident?.id ?? null;

  // One request identity per id + day hint + retry. Ranged state is keyed
  // so a route change never surfaces the previous id's entries or error.
  const requestKey = id && !residentId && atMs !== null ? `${id}|${atMs}|${attempt}` : null;

  const [ranged, setRanged] = useState<{ key: string; entries: Moment[] } | null>(null);
  const [rangedErrorKey, setRangedErrorKey] = useState<string | null>(null);

  useEffect(() => {
    if (!requestKey || !id || residentId || atMs === null) {
      return;
    }
    const key = requestKey;
    let cancelled = false;
    const { fromMs, toMs } = dayBounds(atMs);
    void loadChapterRange(fromMs, toMs).then(
      (loaded) => {
        if (!cancelled) {
          setRanged({ key, entries: loaded });
        }
      },
      () => {
        if (!cancelled) {
          setRangedErrorKey(key);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [requestKey, id, residentId, atMs, loadChapterRange]);

  // Previous ids' answers stay in state but are ignored: every read below
  // matches by request key, so a route change never serves stale entries
  // or a stale error — it reports loading until its own bounded read lands.

  if (!id) {
    return { moment: null, isLoading: false, error: null, reload };
  }
  if (resident) {
    return { moment: resident, isLoading: false, error: null, reload };
  }
  if (atMs !== null && requestKey !== null) {
    const currentEntries = ranged?.key === requestKey ? ranged.entries : null;
    const currentFailed = rangedErrorKey === requestKey;
    const found = currentEntries?.find((item) => item.id === id) ?? null;
    // Before the bounded read resolves there is no answer yet — report
    // loading so the first render never flashes "missing".
    const pending = currentEntries === null && !currentFailed;
    return {
      moment: found,
      isLoading: contextLoading || pending,
      error: currentFailed ? LOAD_FAILED_MESSAGE : null,
      reload,
    };
  }
  return { moment: null, isLoading: contextLoading, error: null, reload };
}
