import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing } from '@/constants/theme';
import type { CalendarEvent } from '@/features/calendar/types';
import { useThemeColor } from '@/hooks/use-theme-color';

export type DayTimelineProps = {
  date: Date;
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

function hourLabel(hour: number): string {
  if (hour === 0) {
    return '12 AM';
  }
  if (hour === 12) {
    return 'Noon';
  }
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

function hourOf(value: string): number {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getHours();
}

function timeLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/**
 * One day, hour by hour, the way a native calendar shows it: a label column,
 * a hairline per hour, and the day's events sitting in the hour they start.
 * Tapping an event opens it, tapping an hour creates one there.
 */
export function DayTimeline({
  date,
  events,
  onOpenEvent,
  onCreateAtHour,
  ownColor,
  partnerColor,
}: DayTimelineProps) {
  const border = useThemeColor({}, 'border');
  const muted = useThemeColor({}, 'muted');
  const surface = useThemeColor({}, 'surface');

  const allDay = events.filter((event) => event.allDay);
  const timed = events.filter((event) => !event.allDay);

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {allDay.length > 0 ? (
        <View style={[styles.allDayRow, { borderBottomColor: border }]}>
          <ThemedText type="caption" style={[styles.hourLabel, { color: muted }]}>
            all-day
          </ThemedText>
          <View style={styles.allDayEvents}>
            {allDay.map((event) => (
              <Pressable
                accessibilityLabel={`Open ${event.title}`}
                accessibilityRole="button"
                key={event.id}
                onPress={() => onOpenEvent(event.id)}
                style={[
                  styles.allDayChip,
                  {
                    backgroundColor: surface,
                    borderColor: event.isOwn && !event.together ? ownColor : partnerColor,
                  },
                ]}
              >
                <ThemedText numberOfLines={1} type="bodyEmphasis">
                  {event.title}
                </ThemedText>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {HOURS.map((hour) => {
        const inHour = timed.filter((event) => hourOf(event.startsAt) === hour);
        return (
          <View key={hour} style={[styles.hourRow, { borderTopColor: border }]}>
            <Pressable
              accessibilityHint="Creates an event in this hour"
              accessibilityLabel={`Add to ${hourLabel(hour)}`}
              accessibilityRole="button"
              onPress={() => onCreateAtHour(hour)}
              style={styles.hourTap}
            >
              <ThemedText type="caption" style={[styles.hourLabel, { color: muted }]}>
                {hourLabel(hour)}
              </ThemedText>
            </Pressable>
            <View style={styles.hourEvents}>
              {inHour.map((event) => {
                const tint = event.isOwn && !event.together ? ownColor : partnerColor;
                return (
                  <Pressable
                    accessibilityLabel={`Open ${event.title}`}
                    accessibilityRole="button"
                    key={event.id}
                    onPress={() => onOpenEvent(event.id)}
                    style={({ pressed }) => [
                      styles.event,
                      { backgroundColor: surface, borderLeftColor: tint },
                      pressed ? styles.pressed : null,
                    ]}
                  >
                    <ThemedText numberOfLines={2} type="bodyEmphasis">
                      {event.title}
                    </ThemedText>
                    <ThemedText type="caption" style={{ color: muted }}>
                      {timeLabel(event.startsAt)} to {timeLabel(event.endsAt)}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      })}

      <View style={styles.footer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  allDayChip: {
    borderRadius: Radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 32,
    paddingHorizontal: Spacing[8],
    paddingVertical: Spacing[4],
  },
  allDayEvents: {
    flex: 1,
    gap: Spacing[4],
  },
  allDayRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: Spacing[8],
    paddingBottom: Spacing[8],
    paddingTop: Spacing[8],
  },
  content: {
    paddingHorizontal: Spacing[24],
    paddingTop: Spacing[8],
  },
  event: {
    borderLeftWidth: 3,
    borderRadius: Radii.sm,
    gap: 2,
    minHeight: 44,
    paddingLeft: Spacing[8],
    paddingVertical: Spacing[8],
  },
  footer: {
    height: Spacing[40],
  },
  hourEvents: {
    flex: 1,
    gap: Spacing[4],
    paddingBottom: Spacing[4],
  },
  hourLabel: {
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
    width: 56,
  },
  hourRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: Spacing[8],
    minHeight: 64,
    paddingTop: Spacing[4],
  },
  hourTap: {
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    minHeight: 44,
  },
  pressed: {
    opacity: 0.85,
  },
});
