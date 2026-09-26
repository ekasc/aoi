import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { MotiView } from 'moti';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Easing, useReducedMotion } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { AccentWash, Radii, Spacing, withAlpha } from '@/constants/theme';
import {
  DAY_EVENT_GAP,
  DAY_GUTTER_WIDTH,
  DAY_HOUR_HEIGHT,
  DAY_MIN_EVENT_HEIGHT,
  initialScrollHour,
  layoutDayEvents,
} from '@/features/calendar/day-layout';
import { getEventOwnership } from '@/features/calendar/event-ownership';
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
  /**
   * Minute of the day to draw the "now" line at, or undefined to leave it out
   * (any day that is not today). The line creeps rather than jumps, so it
   * reads as a clock instead of as a state change.
   */
  nowMinutes?: number;
};

/** One minute of the day, in points. */
const MINUTE_HEIGHT = DAY_HOUR_HEIGHT / 60;

/**
 * Where the day currently is. A hairline across the track with a bead at the
 * gutter end: enough to answer "what are they doing right now" without
 * competing with the plans themselves.
 *
 * It advances by animating to the next minute's position over the minute that
 * follows, so the line is always in motion rather than ticking once a minute.
 * Under reduced motion it lands on the minute and stays there.
 */
function NowLine({
  minutes,
  reduceMotion,
}: {
  minutes: number;
  reduceMotion: boolean;
}) {
  const ink = useThemeColor({}, 'accentInk');
  const offset = minutes * MINUTE_HEIGHT;
  return (
    <MotiView
      accessible={false}
      pointerEvents="none"
      animate={{ opacity: 1, translateY: offset }}
      from={{ opacity: 0, translateY: offset }}
      transition={{
        opacity: { duration: reduceMotion ? 0 : 240, type: 'timing' },
        translateY: {
          // A minute of travel per minute of clock: constant speed, so the
          // line reads as time passing rather than as an animation.
          easing: Easing.linear,
          duration: reduceMotion ? 0 : 60_000,
          type: 'timing',
        },
      }}
      style={[styles.nowLine, { backgroundColor: ink }]}
    >
      <View style={[styles.nowBead, { backgroundColor: ink }]} />
    </MotiView>
  );
}

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
  nowMinutes,
}: DayTimelineProps) {
  const reduceMotion = useReducedMotion();
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
              const ownership = getEventOwnership(event, { ownColor, partnerColor });
              return (
                <MotiView
                  animate={{ opacity: 1, translateY: 0 }}
                  from={{ opacity: 0, translateY: reduceMotion ? 0 : 8 }}
                  key={event.id}
                  transition={{
                    delay: reduceMotion ? 0 : 60,
                    duration: reduceMotion ? 0 : 220,
                    type: 'timing',
                  }}
                >
                  <Pressable
                    accessibilityLabel={`Open ${event.title}, ${ownership.label}`}
                    accessibilityRole="button"
                    onPress={() => onOpenEvent(event.id)}
                    style={[
                      styles.allDayChip,
                      { backgroundColor: withAlpha(ownership.color, 0.18) },
                    ]}
                  >
                    <ThemedText numberOfLines={1} type="bodyEmphasis">
                      {event.title}
                    </ThemedText>
                  </Pressable>
                </MotiView>
              );
            })}
          </View>
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.content}
        contentOffset={{ x: 0, y: initialHour * DAY_HOUR_HEIGHT }}
        // A vertical timeline inside the horizontal day pager: without this
        // the parent can steal vertical drags on Android.
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        style={styles.scroller}
      >
        <View
          onLayout={(event) => {
            // The content box, not the scroller: the 16pt gutters on each
            // side are not track, and measuring the scroller overshot every
            // block 32pt off the right edge.
            const width = Math.round(event.nativeEvent.layout.width);
            setBodyWidth((current) => (current === width ? current : width));
          }}
          style={{ height: HOURS.length * DAY_HOUR_HEIGHT }}
        >
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

          {/* Under the plans, so a block covering now is not sliced in half by
              the line, and above the hairlines it has to be read against. */}
          {nowMinutes === undefined ? null : (
            <NowLine minutes={nowMinutes} reduceMotion={reduceMotion} />
          )}

          {laidOut.map((item, index) => {
            const ownership = getEventOwnership(item.event, { ownColor, partnerColor });
            const width = columnWidth(item.columnCount);
            const height = Math.max(
              DAY_MIN_EVENT_HEIGHT,
              ((item.endMinutes - item.startMinutes) / 60) * DAY_HOUR_HEIGHT -
                DAY_EVENT_GAP,
            );
            // A block only says what fits inside its own span: title and
            // owner need ~60pt, the location needs ~84. Anything more would
            // paint onto the neighbour hours, which is what made short
            // blocks smear. Overflow hidden is the backstop, not the plan.
            const fitsCaption = height >= 60;
            const fitsLocation = height >= 84;
            return (
              <MotiView
                animate={{ opacity: 1, translateY: 0 }}
                from={{ opacity: 0, translateY: reduceMotion ? 0 : 10 }}
                key={item.event.id}
                style={[
                  styles.event,
                  {
                    backgroundColor: withAlpha(ownership.color, AccentWash),
                    height,
                    left: DAY_GUTTER_WIDTH + item.column * (width + DAY_EVENT_GAP),
                    top: (item.startMinutes / 60) * DAY_HOUR_HEIGHT + DAY_EVENT_GAP / 2,
                    width,
                  },
                ]}
                transition={{
                  delay: reduceMotion ? 0 : Math.min(index, 8) * 34,
                  duration: reduceMotion ? 0 : 220,
                  type: 'timing',
                }}
              >
                <Pressable
                  accessibilityLabel={`Open ${item.event.title}, ${ownership.label}`}
                  accessibilityRole="button"
                  onPress={() => onOpenEvent(item.event.id)}
                  style={styles.eventTap}
                >
                  <ThemedText numberOfLines={2} type="bodyEmphasis">
                    {item.event.title}
                  </ThemedText>
                  {/* Whose plan it is, said in words: the tint carries it too,
                      but colour alone cannot be read by everyone. */}
                  {fitsCaption ? (
                    <ThemedText numberOfLines={1} type="caption" style={{ color: muted }}>
                      {ownership.label} · {timeLabel(item.event.startsAt)} to{' '}
                      {timeLabel(item.event.endsAt)}
                    </ThemedText>
                  ) : null}
                  {fitsLocation && item.event.location ? (
                    <View style={styles.locationRow}>
                      <Ionicons color={muted} name="location-outline" size={12} />
                      <ThemedText
                        numberOfLines={1}
                        type="caption"
                        style={[styles.locationText, { color: muted }]}
                      >
                        {item.event.location}
                      </ThemedText>
                    </View>
                  ) : null}
                </Pressable>
              </MotiView>
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
    // A real tap target: all-day items were the shortest row on the screen.
    justifyContent: 'center',
    minHeight: 44,
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
    // The owner reads off the tint and the caption, never off an edge: a
    // coloured side stripe is decoration wearing a convention's clothes.
    // Square corners, the way a calendar draws a block: rounding is for
    // chips and buttons, not for time. Hidden overflow, so a short block
    // can never paint its words onto the neighbour hours.
    borderRadius: 0,
    overflow: 'hidden',
    justifyContent: 'flex-start',
    // Text hugging the block's edges is what made neighbouring blocks read
    // as one smear: the padding earns the gap back inside the block.
    paddingHorizontal: Spacing[12],
    paddingVertical: Spacing[8],
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
  nowLine: {
    height: 1.5,
    left: DAY_GUTTER_WIDTH,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  nowBead: {
    borderRadius: 999,
    height: 7,
    left: -3.5,
    position: 'absolute',
    top: -2.75,
    width: 7,
  },
  hourLine: {
    borderTopWidth: StyleSheet.hairlineWidth,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  eventTap: {
    flex: 1,
  },
  locationRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 2,
  },
  locationText: {
    flex: 1,
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
