import { useIsFocused } from 'expo-router';
import { AppState } from 'react-native';
import { useEffect, useState } from 'react';

import { getRelationshipAge, type RelationshipAge } from '@/features/relationship/relationship-age';

/** Keeps relationship-aware copy current when a retained screen regains focus. */
export function useRelationshipAge(startDate: string | null | undefined): RelationshipAge {
  const isFocused = useIsFocused();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!isFocused) return;
    let midnight: ReturnType<typeof setTimeout> | null = null;
    const scheduleMidnight = () => {
      if (midnight) clearTimeout(midnight);
      const current = new Date();
      const nextDay = new Date(current);
      nextDay.setHours(24, 0, 0, 0);
      midnight = setTimeout(() => {
        setNow(new Date());
        scheduleMidnight();
      }, Math.max(1, nextDay.getTime() - current.getTime()));
    };
    const refresh = setTimeout(() => {
      setNow(new Date());
      scheduleMidnight();
    }, 0);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setNow(new Date());
        scheduleMidnight();
      } else if (midnight) {
        clearTimeout(midnight);
        midnight = null;
      }
    });
    return () => {
      clearTimeout(refresh);
      if (midnight) clearTimeout(midnight);
      subscription.remove();
    };
  }, [isFocused]);

  return getRelationshipAge(startDate, now);
}
