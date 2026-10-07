import { Ionicons } from '@expo/vector-icons';
import { useIsFocused, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { AccentWash, Radii, Spacing, withAlpha } from '@/constants/theme';
import { useCalendar } from '@/features/calendar/calendar-context';
import {
  formatEventTimeLabel,
  groupAgendaEvents,
} from '@/features/calendar/calendar-date-utils';
import { getEventOwnership } from '@/features/calendar/event-ownership';
import type { CalendarEvent } from '@/features/calendar/types';
import { getGoalHorizon, isUpcomingGoal } from '@/features/moments/moment-goal-utils';
import { useMoments } from '@/features/moments/moments-context';
import type { Moment } from '@/features/moments/types';
import { useThemeColor } from '@/hooks/use-theme-color';

export type PlansAgendaProps = {
  /**
   * The moment the agenda reads day labels and horizons from. Defaults to
   * now; tests pin it so "Today" is deterministic.
   */
  now?: Date;
};

/**
 * The readable half of Plans: upcoming events grouped by day and future goals.
 * No time grid — the day timeline owns that.
 *
 * The screen does not have to hand it data: it reads the calendar and goal
 * contexts itself, so it drops into Plans as one element.
 */
export function PlansAgenda({ now }: PlansAgendaProps) {
  const router = useRouter();
  const isFocused = useIsFocused();
  const {
    upcomingEvents,
    isLoading: calendarLoading,
    error: calendarError,
    refresh: refreshCalendar,
  } = useCalendar();
  const { loadGoals } = useMoments();

  const [goals, setGoals] = useState<Moment[] | null>(null);
  const [goalsError, setGoalsError] = useState(false);
  const [retryInFlight, setRetryInFlight] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const retryInFlightRef = useRef(false);

  const nowDate = useMemo(() => now ?? new Date(), [now]);

  // Goals are a separate, bounded read; a new goal set on another screen
  // lands on the next focus the way a partner's change does.
  useEffect(() => {
    if (!isFocused) {
      return;
    }
    let cancelled = false;
    void loadGoals().then(
      (loaded) => {
        if (!cancelled) {
          setGoals(loaded);
          setGoalsError(false);
        }
      },
      () => {
        if (!cancelled) {
          setGoalsError(true);
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [isFocused, loadGoals]);

  const handleRetryGoals = useCallback(() => {
    void loadGoals().then(
      (loaded) => {
        setGoals(loaded);
        setGoalsError(false);
      },
      () => setGoalsError(true)
    );
  }, [loadGoals]);

  const agendaDays = useMemo(
    () => groupAgendaEvents(upcomingEvents, nowDate),
    [upcomingEvents, nowDate]
  );
  const upcomingGoals = useMemo(
    () => (goals ?? []).filter((goal) => isUpcomingGoal(goal, nowDate)),
    [goals, nowDate]
  );

  const isLoading = calendarLoading || (goals === null && !goalsError);
  const loadError = Boolean(calendarError || goalsError);

  const handleOpenEvent = useCallback(
    (eventId: string) => {
      router.push(`/(app)/calendar/edit/${eventId}`);
    },
    [router]
  );

  const handleOpenGoal = useCallback(
    (goal: Moment) => {
      router.push({
        pathname: '/(app)/moment/[id]' as const,
        params: { id: goal.id, at: goal.occurredAt },
      });
    },
    [router]
  );

  const handleSetGoal = useCallback(() => {
    router.push('/(app)/goal-new');
  }, [router]);

  const handleRetry = useCallback(() => {
    if (retryInFlightRef.current) {
      return;
    }
    retryInFlightRef.current = true;
    setRetryInFlight(true);
    setRetryError(null);

    // Neither read may reject into the void: allSettled turns a failed retry
    // into the same calm line the failed read already shows.
    void Promise.allSettled([refreshCalendar()])
      .then(([calendar]) => {
        if (calendar.status === 'rejected') {
          setRetryError('Some of your plans could not be refreshed just now.');
        }
      })
      .finally(() => {
        retryInFlightRef.current = false;
        setRetryInFlight(false);
      });

    handleRetryGoals();
  }, [handleRetryGoals, refreshCalendar]);

  const accent = useThemeColor({}, 'accent');
  const partnerAccent = useThemeColor({}, 'partnerAccent');
  const border = useThemeColor({}, 'border');
  const muted = useThemeColor({}, 'muted');
  const danger = useThemeColor({}, 'danger');

  return (
    <View style={styles.root}>
      {isLoading ? (
        <ThemedText
          accessibilityLiveRegion="polite"
          type="supporting"
          style={[styles.status, { color: muted }]}
        >
          Loading plans…
        </ThemedText>
      ) : null}

      {/* A failed read must not read as an empty one. */}
      {loadError ? (
        <View style={[styles.notice, { borderColor: border }]}>
          <ThemedText accessibilityLiveRegion="polite" style={styles.noticeText}>
            Some of your plans could not be loaded.
          </ThemedText>
          <Button
            accessibilityState={{ busy: retryInFlight, disabled: retryInFlight }}
            disabled={retryInFlight}
            label="Try again"
            onPress={handleRetry}
            size="sm"
            variant="secondary"
          />
        </View>
      ) : null}

      {retryError ? (
        <ThemedText
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          type="supporting"
          style={[styles.status, { color: danger }]}
        >
          {retryError}
        </ThemedText>
      ) : null}

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <ThemedText type="subheading">Upcoming</ThemedText>
        </View>
        {agendaDays.length === 0 ? (
          <ThemedText accessibilityLiveRegion="polite" type="supporting" style={{ color: muted }}>
            {calendarError ? 'Your plans could not be loaded.' : calendarLoading ? 'Loading upcoming plans…' : 'No upcoming plans.'}
          </ThemedText>
        ) : (
          agendaDays.map((day) => (
            <View key={day.key} style={styles.dayGroup}>
              <ThemedText type="meta" style={{ color: muted }}>
                {day.label}
              </ThemedText>
              {day.events.map((event) => (
                <EventRow
                  borderColor={border}
                  event={event}
                  key={event.id}
                  mutedColor={muted}
                  onOpen={handleOpenEvent}
                  ownColor={accent}
                  partnerColor={partnerAccent}
                />
              ))}
            </View>
          ))
        )}
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <ThemedText type="subheading">Goals</ThemedText>
          <Button
            label="Set a goal"
            onPress={handleSetGoal}
            size="sm"
            variant="ghost"
          />
        </View>
        {upcomingGoals.length === 0 ? (
          <ThemedText accessibilityLiveRegion="polite" type="supporting" style={{ color: muted }}>
            {goalsError ? 'Your goals could not be loaded.' : goals === null ? 'Loading goals…' : goals.length === 0 ? 'No goals yet.' : 'No upcoming goals.'}
          </ThemedText>
        ) : (
          upcomingGoals.map((goal) => (
            <GoalRow
              borderColor={border}
              goal={goal}
              key={goal.id}
              mutedColor={muted}
              now={nowDate}
              onOpen={handleOpenGoal}
            />
          ))
        )}
      </View>
    </View>
  );
}

type EventRowProps = {
  event: CalendarEvent;
  onOpen: (eventId: string) => void;
  ownColor: string;
  partnerColor: string;
  borderColor: string;
  mutedColor: string;
};

function EventRow({
  event,
  onOpen,
  ownColor,
  partnerColor,
  borderColor,
  mutedColor,
}: EventRowProps) {
  const ownership = getEventOwnership(event, { ownColor, partnerColor });
  const timeLabel = formatEventTimeLabel(event);
  const detail = event.location
    ? `${ownership.label} · ${timeLabel} · ${event.location}`
    : `${ownership.label} · ${timeLabel}`;

  return (
    <Pressable
      accessibilityHint="Opens the event"
      accessibilityLabel={`Open ${event.title}, ${ownership.label}, ${timeLabel}`}
      accessibilityRole="button"
      onPress={() => onOpen(event.id)}
      style={[
        styles.eventRow,
        { backgroundColor: withAlpha(ownership.color, AccentWash) },
      ]}
    >
      <View style={styles.rowBody}>
        <ThemedText numberOfLines={2} type="bodyEmphasis">
          {event.title}
        </ThemedText>
        <ThemedText numberOfLines={1} type="caption" style={{ color: mutedColor }}>
          {detail}
        </ThemedText>
      </View>
      <Ionicons color={mutedColor} name="chevron-forward" size={16} />
    </Pressable>
  );
}

type GoalRowProps = {
  goal: Moment;
  now: Date;
  onOpen: (goal: Moment) => void;
  borderColor: string;
  mutedColor: string;
};

function GoalRow({ goal, now, onOpen, borderColor, mutedColor }: GoalRowProps) {
  const horizon = getGoalHorizon(goal, now);
  const target = goal.targetAt ? new Date(goal.targetAt) : null;
  const targetLabel =
    target && !Number.isNaN(target.getTime())
      ? target.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : null;
  const title = goal.title.trim() || 'A goal';

  return (
    <Pressable
      accessibilityHint="Opens the goal"
      accessibilityLabel={`Open goal ${title}`}
      accessibilityRole="button"
      onPress={() => onOpen(goal)}
      style={[styles.goalRow, { borderColor }]}
    >
      <View style={styles.rowBody}>
        <ThemedText numberOfLines={2} type="bodyEmphasis">
          {title}
        </ThemedText>
        <ThemedText numberOfLines={1} type="caption" style={{ color: mutedColor }}>
          {targetLabel ? `${horizon} · ${targetLabel}` : horizon}
        </ThemedText>
      </View>
      <Ionicons color={mutedColor} name="chevron-forward" size={16} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: Spacing[24],
    paddingHorizontal: Spacing[16],
    paddingVertical: Spacing[16],
  },
  section: {
    gap: Spacing[12],
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  status: {
    paddingHorizontal: Spacing[4],
  },
  notice: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: Spacing[12],
    justifyContent: 'space-between',
    minHeight: 44,
  },
  noticeText: {
    flex: 1,
  },
  dayGroup: {
    gap: Spacing[8],
  },
  eventRow: {
    alignItems: 'center',
    borderRadius: Radii.sm,
    flexDirection: 'row',
    gap: Spacing[8],
    minHeight: 44,
    paddingHorizontal: Spacing[12],
    paddingVertical: Spacing[8],
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  goalRow: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: Spacing[8],
    minHeight: 44,
    paddingVertical: Spacing[8],
  },
});
