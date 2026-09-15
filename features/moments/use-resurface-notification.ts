import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { SchedulableTriggerInputTypes } from 'expo-notifications';
import { useEffect, useRef } from 'react';

import { findResurfaces, formatResurfaceLabel } from '@/features/moments/resurface';
import type { Moment } from '@/features/moments/types';

const LAST_NOTIFIED_KEY = 'aoi.resurface.last-notified.v1';
const EXCERPT_LIMIT = 120;

function todayKey(now: Date): string {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

/**
 * Calm delivery: 9:30 in the morning, or 14:30 if the morning has passed.
 * Never late at night — memories should arrive in daylight.
 */
function nextDeliveryDate(now: Date): Date {
  const delivery = new Date(now);

  if (now.getHours() < 9) {
    delivery.setHours(9, 30, 0, 0);
  } else {
    delivery.setHours(14, 30, 0, 0);
  }

  if (delivery.getTime() <= now.getTime()) {
    delivery.setDate(delivery.getDate() + 1);
  }

  return delivery;
}

function truncateExcerpt(value: string): string {
  const trimmed = value.trim();

  if (trimmed.length <= EXCERPT_LIMIT) {
    return trimmed;
  }

  return `${trimmed.slice(0, EXCERPT_LIMIT - 1).trimEnd()}…`;
}

/**
 * Schedules at most one local "on this day" notification per calendar day.
 * Notifications are a gentle enhancement — any failure is swallowed.
 */
export function useResurfaceNotification(moments: Moment[]): void {
  const scheduled = useRef(false);

  useEffect(() => {
    if (scheduled.current || moments.length === 0) {
      return;
    }

    const resurfaces = findResurfaces(moments);

    if (resurfaces.length === 0) {
      return;
    }

    scheduled.current = true;

    void (async () => {
      try {
        const now = new Date();
        const alreadyNotified =
          (await AsyncStorage.getItem(LAST_NOTIFIED_KEY)) === todayKey(now);

        if (alreadyNotified) {
          return;
        }

        const permission = await Notifications.requestPermissionsAsync();

        if (!permission.granted) {
          return;
        }

        const top = resurfaces[0];
        const excerpt = truncateExcerpt(
          top.moment.body || top.moment.title || 'a moment you kept'
        );

        await Notifications.scheduleNotificationAsync({
          content: {
            title: formatResurfaceLabel(top.yearsAgo),
            body: `“${excerpt}”, worth a look back together.`,
            sound: false,
          },
          trigger: {
            type: SchedulableTriggerInputTypes.DATE,
            date: nextDeliveryDate(now),
          },
        });

        await AsyncStorage.setItem(LAST_NOTIFIED_KEY, todayKey(now));
      } catch {
        // Deliberately silent: memories must never become noise or errors.
      }
    })();
  }, [moments]);
}
