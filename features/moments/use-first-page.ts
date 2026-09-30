import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import { firstPageKey } from '@/features/moments/first-page';

export function useFirstPage(viewerId: string | null, spaceId: string | undefined) {
  const key = viewerId && spaceId ? firstPageKey(viewerId, spaceId) : null;
  const [stored, setStored] = useState<{ key: string; dismissed: boolean } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!key) return;
    let live = true;
    void AsyncStorage.getItem(key).then((value) => {
      if (live) {
        setStored({ key, dismissed: value === 'done' });
        setError((current) => current?.key === key ? null : current);
      }
    }).catch(() => {
      if (live) setError({ key, message: 'Could not open your first page. Please try again.' });
    });
    return () => { live = false; };
  }, [key, attempt]);
  const remember = useCallback(async () => {
    if (!key) return false;
    try {
      await AsyncStorage.setItem(key, 'done');
      setError((current) => current?.key === key ? null : current);
      return true;
    } catch {
      setError({ key, message: 'Could not save that choice. Please try again.' });
      return false;
    }
  }, [key]);
  const dismiss = useCallback(async () => {
    if (key && await remember()) {
      setStored((current) => current?.key === key ? { key, dismissed: true } : current);
    }
  }, [key, remember]);
  const retry = useCallback(() => { setAttempt((value) => value + 1); }, []);
  return { ready: key !== null && stored?.key === key, dismissed: stored?.key === key && stored.dismissed,
    dismiss, remember, retry, error: error?.key === key ? error?.message ?? null : null };
}
