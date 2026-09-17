import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing, withAlpha } from '@/constants/theme';
import {
  DAY_EVENT_GAP,
  DAY_GUTTER_WIDTH,
  DAY_HOUR_HEIGHT,
  DAY_MIN_EVENT_HEIGHT,
  initialScrollHour,
  layoutDayEvents,
} from '@/features/calendar/day-layout';
import type { CalendarEvent } from '@/features/calendar/types';
import { useThemeColor } from '@/hooks/use-theme-color';

export type DayTimelineProps = {
  events: CalendarEvent[];
  /** A tap on an event opens it. */
  onOpenEvent: (eventId: string) => void;
  /** A tap on an hour creates in that hour, so a day is one tap from a plan. */
  onCreateAtHour: (hour: number) => void;
  /** Events the viewer owns take their accent, the partner's take theirs. */
  ownColor: string;
  partnerColor: string;
};

const HOURS = Array.from({ length: 24 }, (_, index) => index);

export function hourLabel(hour: number): string {
  if (hour === 0) {
    return '12 AM';
  }
  if (hour === 12) {
    return 'Noon';
  }
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

function timeLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/**
 * One day hour by hour: a label column, a hairline per hour, and each event
 * drawn at the height its duration earns, so a three hour block looks like
 * three hours. Plans that run at the same time sit side by side.
 */
export function DayTimeline({
  events,
  onOpenEvent,
  onCreateAtHour,
  ownColor,
  partnerColor,
}: DayTimelineProps) {
  const border = useThemeColor({}, 'border');
  const muted = useThemeColor({}, 'muted');
  const [bodyWidth, setBodyWidth] = useState(0);

  const allDay = events.filter((event) => event.allDay);
  const laidOut = layoutDayEvents(events);
  const initialHour = initialScrollHour(events);

  const trackWidth = Math.max(0, bodyWidth - DAY_GUTTER_WIDTH);
  const columnWidth = (count: number) =>
    count <= 1 ? trackWidth : (trackWidth - DAY_EVENT_GAP * (count - 1)) / count;

  return (
    <View style={styles.root}>
      {allDay.length > 0 ? (
        <View style={[styles.allDayRow, { borderBottomColor: border }]}>
          <ThemedText type="meta" style={[styles.allDayLabel, { color: muted }]}>
            all-day
          </ThemedText>
          <View style={styles.allDayEvents}>
            {allDay.map((event) => {
              const tint = event.isOwn && !event.together ? ownColor : partnerColor;
              return (
                <Pressable
                  accessibilityLabel={`Open ${event.title}`}
                  accessibilityRole="button"
                  key={event.id}
                  onPress={() => onOpenEvent(event.id)}
                  style={[styles.allDayChip, { backgroundColor: withAlpha(tint, 0.18) }]}
                >
                  <ThemedText numberOfLines={1} type="bodyEmphasis">
                    {event.title}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.content}
        contentOffset={{ x: 0, y: initialHour * DAY_HOUR_HEIGHT }}
        onLayout={(event) => {
          const width = Math.round(event.nativeEvent.layout.width);
          setBodyWidth((current) => (current === width ? current : width));
        }}
        showsVerticalScrollIndicator={false}
        style={styles.scroller}
      >
        <View style={{ height: HOURS.length * DAY_HOUR_HEIGHT }}>
          {HOURS.map((hour) => (
            <View
              key={hour}
              style={[
                styles.hourLine,
                { borderTopColor: border, top: hour * DAY_HOUR_HEIGHT },
              ]}
            >
              <Pressable
                accessibilityHint="Creates an event in this hour"
                accessibilityLabel={`Add to ${hourLabel(hour)}`}
                accessibilityRole="button"
                onPress={() => onCreateAtHour(hour)}
                style={styles.gutter}
              >
                <ThemedText type="meta" style={[styles.hourLabel, { color: muted }]}>
                  {hourLabel(hour)}
                </ThemedText>
              </Pressable>
            </View>
          ))}

          {laidOut.map((item) => {
            const tint = item.event.isOwn && !item.event.together ? ownColor : partnerColor;
            const width = columnWidth(item.columnCount);
            return (
              <Pressable
                accessibilityLabel={`Open ${item.event.title}`}
                accessibilityRole="button"
                key={item.event.id}
                onPress={() => onOpenEvent(item.event.id)}
                style={({ pressed }) => [
                  styles.event,
                  {
                    backgroundColor: withAlpha(tint, 0.16),
                    borderLeftColor: tint,
                    height: Math.max(
                      DAY_MIN_EVENT_HEIGHT,
                      ((item.endMinutes - item.startMinutes) / 60) * DAY_HOUR_HEIGHT -
                        DAY_EVENT_GAP,
                    ),
                    left: DAY_GUTTER_WIDTH + item.column * (width + DAY_EVENT_GAP),
                    top: (item.startMinutes / 60) * DAY_HOUR_HEIGHT + DAY_EVENT_GAP / 2,
                    width,
                  },
                  pressed ? styles.pressed : null,
                ]}
              >
                <ThemedText numberOfLines={2} type="bodyEmphasis">
                  {item.event.title}
                </ThemedText>
                <ThemedText type="caption" style={{ color: muted }}>
                  {timeLabel(item.event.startsAt)} to {timeLabel(item.event.endsAt)}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  allDayChip: {
    borderRadius: Radii.sm,
    minHeight: 32,
    paddingHorizontal: Spacing[8],
    paddingVertical: Spacing[4],
  },
  allDayEvents: {
    flex: 1,
    gap: Spacing[4],
  },
  allDayLabel: {
    textAlign: 'right',
    width: DAY_GUTTER_WIDTH - Spacing[8],
  },
  allDayRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: Spacing[8],
    paddingBottom: Spacing[8],
    paddingHorizontal: Spacing[16],
    paddingTop: Spacing[8],
  },
  content: {
    paddingBottom: Spacing[40],
    paddingHorizontal: Spacing[16],
  },
  event: {
    borderLeftWidth: 3,
    borderRadius: Radii.sm,
    justifyContent: 'flex-start',
    paddingHorizontal: Spacing[8],
    paddingVertical: Spacing[4],
    position: 'absolute',
  },
  gutter: {
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    minHeight: 44,
    width: DAY_GUTTER_WIDTH - Spacing[8],
  },
  hourLabel: {
    textAlign: 'right',
  },
  hourLine: {
    borderTopWidth: StyleSheet.hairlineWidth,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  pressed: {
    opacity: 0.88,
  },
  root: {
    flex: 1,
  },
  scroller: {
    flex: 1,
  },
});
