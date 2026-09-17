import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';

export const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

/** Weeks delivered either side of the selected one. */
const WEEK_WINDOW_RADIUS = 104;
const WEEK_WINDOW_SIZE = WEEK_WINDOW_RADIUS * 2 + 1;

export function startOfWeek(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - start.getDay());
  return start;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

type WeekStripProps = {
  selectedDate: Date;
  /** The day the viewer tapped. */
  onSelectDate: (date: Date) => void;
  /** The week that came to rest, so the header can name its month. */
  onWeekChange: (date: Date) => void;
  /** Days carrying plans, keyed YYYY-MM-DD, so a date can show it has one. */
  markedDays?: Record<string, number>;
  accent: string;
  onAccent: string;
};

/**
 * The week strip above a day: letters across the top, one row of dates, the
 * selected day in a filled circle and today's number in the accent. Swiping
 * pages a week at a time.
 */
export function WeekStrip({
  selectedDate,
  onSelectDate,
  onWeekChange,
  markedDays,
  accent,
  onAccent,
}: WeekStripProps) {
  const muted = useThemeColor({}, 'muted');
  const textColor = useThemeColor({}, 'text');
  const border = useThemeColor({}, 'border');
  const [cellWidth, setCellWidth] = useState(0);
  const scroller = useRef<ScrollView | null>(null);
  // The delivered window hangs off the week the strip was last centred on, not
  // off the selection, so tapping a date cannot shift the strip under itself.
  const [anchorWeek, setAnchorWeek] = useState(() => startOfWeek(selectedDate));
  const today = useMemo(() => new Date(), []);

  const weeks = useMemo(
    () =>
      Array.from({ length: WEEK_WINDOW_SIZE }, (_, index) =>
        addDays(anchorWeek, (index - WEEK_WINDOW_RADIUS) * 7),
      ),
    [anchorWeek],
  );

  // Selecting a day outside the window (Today, a jump) moves the window.
  useEffect(() => {
    const selectedWeek = startOfWeek(selectedDate);
    const inWindow = weeks.some((week) => isSameDay(week, selectedWeek));
    if (!inWindow) {
      setAnchorWeek(selectedWeek);
    }
  }, [selectedDate, weeks]);

  // The offset is applied after measuring: a contentOffset prop is read once on
  // mount, and the width is unknown then, so the strip would open on the oldest
  // week and stay there.
  useEffect(() => {
    if (cellWidth <= 0) {
      return;
    }
    scroller.current?.scrollTo({
      animated: false,
      x: WEEK_WINDOW_RADIUS * cellWidth,
    });
  }, [anchorWeek, cellWidth]);

  const handleMomentumEnd = useCallback(
    (event: { nativeEvent: { contentOffset: { x: number } } }) => {
      if (cellWidth <= 0) {
        return;
      }
      const page = Math.round(event.nativeEvent.contentOffset.x / cellWidth);
      const week = weeks[Math.max(0, Math.min(weeks.length - 1, page))];
      if (week) {
        onWeekChange(week);
      }
    },
    [cellWidth, onWeekChange, weeks],
  );

  return (
    <View>
      <View style={styles.letterRow}>
        {WEEKDAY_LETTERS.map((letter, index) => (
          <View key={`${letter}:${index}`} style={styles.cell}>
            <ThemedText type="meta" style={{ color: muted }}>
              {letter}
            </ThemedText>
          </View>
        ))}
      </View>
      <ScrollView
        horizontal
        onLayout={(event) => {
          const width = Math.round(event.nativeEvent.layout.width);
          setCellWidth((current) => (current === width ? current : width));
        }}
        onMomentumScrollEnd={handleMomentumEnd}
        pagingEnabled
        ref={scroller}
        showsHorizontalScrollIndicator={false}
      >
        {cellWidth > 0
          ? weeks.map((week) => (
              <View key={week.toISOString()} style={[styles.week, { width: cellWidth }]}>
                {Array.from({ length: 7 }, (_, index) => {
                  const day = addDays(week, index);
                  const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
                  const selected = isSameDay(day, selectedDate);
                  const isToday = isSameDay(day, today);
                  const marked = (markedDays?.[key] ?? 0) > 0;
                  return (
                    <Pressable
                      accessibilityLabel={day.toLocaleDateString('en-US', {
                        day: 'numeric',
                        month: 'long',
                        weekday: 'long',
                      })}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      key={key}
                      onPress={() => onSelectDate(day)}
                      style={styles.dateCell}
                    >
                      <View
                        style={[
                          styles.dateCircle,
                          selected ? { backgroundColor: accent } : null,
                        ]}
                      >
                        <ThemedText
                          type="bodyEmphasis"
                          style={[
                            styles.dateText,
                            {
                              color: selected
                                ? onAccent
                                : isToday
                                  ? accent
                                  : textColor,
                            },
                          ]}
                        >
                          {day.getDate()}
                        </ThemedText>
                      </View>
                      <View
                        style={[
                          styles.mark,
                          {
                            backgroundColor: selected
                              ? accent
                              : marked
                                ? accent
                                : 'transparent',
                            borderColor: border,
                          },
                        ]}
                      />
                    </Pressable>
                  );
                })}
              </View>
            ))
          : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  cell: {
    alignItems: 'center',
    flex: 1,
  },
  dateCell: {
    alignItems: 'center',
    flex: 1,
    gap: 2,
    justifyContent: 'center',
    minHeight: 48,
  },
  dateCircle: {
    alignItems: 'center',
    borderRadius: 999,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  dateText: {
    fontVariant: ['tabular-nums'],
  },
  letterRow: {
    flexDirection: 'row',
    paddingBottom: Spacing[4],
  },
  mark: {
    borderRadius: 999,
    height: 4,
    width: 4,
  },
  week: {
    flexDirection: 'row',
  },
});
