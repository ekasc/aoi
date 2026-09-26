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
import {
  formatProposalWhen,
  getAnswerableProposals,
  getPendingProposals,
} from '@/features/proposals/proposal-time';
import { useProposals } from '@/features/proposals/proposals-context';
import type { EventProposal } from '@/features/proposals/types';
import { useThemeColor } from '@/hooks/use-theme-color';

export type PlansAgendaProps = {
  /**
   * The moment the agenda reads day labels and horizons from. Defaults to
   * now; tests pin it so "Today" is deterministic.
   */
  now?: Date;
};

type PendingAction = { proposalId: string; kind: 'accept' | 'decline' };

/**
 * The readable half of Plans: upcoming events grouped by day, partner
 * suggestions that can be answered, the viewer's own suggestions waiting for
 * an answer, and future goals. No time grid — the day timeline owns that.
 *
 * The screen does not have to hand it data: it reads the calendar, proposal,
 * and goal contexts itself, so it drops into Plans as one element.
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
  const {
    proposals,
    isLoading: proposalsLoading,
    error: proposalsError,
    accept,
    decline,
    reload: reloadProposals,
  } = useProposals();
  const { loadGoals } = useMoments();

  const [goals, setGoals] = useState<Moment[] | null>(null);
  const [goalsError, setGoalsError] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // An accept is committed by the time the calendar re-read runs, so a failed
  // re-read must not read as a failed accept: only the read is left to retry.
  const [acceptRefreshFailed, setAcceptRefreshFailed] = useState(false);
  const [retryInFlight, setRetryInFlight] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  // The visible disabled state re-renders a frame late; the ref is what makes
  // a double-tap answer a suggestion exactly once.
  const actionInFlight = useRef(false);
  const retryInFlightRef = useRef(false);

  const nowDate = useMemo(() => now ?? new Date(), [now]);

  // Goals are a separate, bounded read; a new goal set on another screen
  // lands on the next focus the way a new partner suggestion does.
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
  const pendingProposals = useMemo(
    () => getPendingProposals(proposals),
    [proposals]
  );
  const answerableProposals = useMemo(
    () => getAnswerableProposals(proposals),
    [proposals]
  );
  // Your own suggestions wait quietly: they are never yours to answer.
  const suggestionsWaiting = useMemo(
    () => pendingProposals.filter((proposal) => proposal.proposerRole === 'you'),
    [pendingProposals]
  );
  const upcomingGoals = useMemo(
    () => (goals ?? []).filter((goal) => isUpcomingGoal(goal, nowDate)),
    [goals, nowDate]
  );

  const isLoading =
    calendarLoading || proposalsLoading || (goals === null && !goalsError);
  const loadError = Boolean(calendarError || proposalsError || goalsError);

  const runResponse = useCallback(
    async (proposalId: string, kind: 'accept' | 'decline') => {
      if (actionInFlight.current) {
        return;
      }
      actionInFlight.current = true;
      setPendingAction({ kind, proposalId });
      setActionError(null);
      setAcceptRefreshFailed(false);

      try {
        if (kind === 'accept') {
          try {
            await accept(proposalId);
          } catch {
            // The repository's message is not fit for a reader; say something
            // calm and let the suggestion stay answerable.
            setActionError('That suggestion could not be accepted just now.');
            return;
          }
          // Accepting creates a real event, so the calendar has to re-read.
          // The answer is already settled here — a failed read is a stale
          // view, not an unanswered suggestion, and is never retried by
          // accepting again.
          try {
            await refreshCalendar();
          } catch {
            setAcceptRefreshFailed(true);
            setActionError(
              'That suggestion was accepted, but your calendar could not be refreshed.'
            );
          }
          return;
        }

        try {
          await decline(proposalId);
        } catch {
          setActionError('That suggestion could not be answered just now.');
        }
      } finally {
        actionInFlight.current = false;
        setPendingAction(null);
      }
    },
    [accept, decline, refreshCalendar]
  );

  const handleAccept = useCallback(
    (proposalId: string) => {
      void runResponse(proposalId, 'accept');
    },
    [runResponse]
  );

  const handleDecline = useCallback(
    (proposalId: string) => {
      void runResponse(proposalId, 'decline');
    },
    [runResponse]
  );

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

  const handleSuggestTime = useCallback(() => {
    router.push('/(app)/proposal/new');
  }, [router]);

  const handleSetGoal = useCallback(() => {
    router.push('/(app)/goal-new');
  }, [router]);

  // The accept-refresh retry reloads the calendar only. The suggestion is
  // already accepted, so there is nothing to answer a second time.
  const handleRetryCalendarRefresh = useCallback(() => {
    if (retryInFlightRef.current) {
      return;
    }
    retryInFlightRef.current = true;
    setRetryInFlight(true);

    void refreshCalendar()
      .then(() => {
        setAcceptRefreshFailed(false);
        setActionError(null);
      })
      .catch(() => {
        setActionError('Your calendar could not be refreshed just now.');
      })
      .finally(() => {
        retryInFlightRef.current = false;
        setRetryInFlight(false);
      });
  }, [refreshCalendar]);

  const handleRetry = useCallback(() => {
    if (retryInFlightRef.current) {
      return;
    }
    retryInFlightRef.current = true;
    setRetryInFlight(true);
    setRetryError(null);

    // Neither read may reject into the void: allSettled turns a failed retry
    // into the same calm line the failed read already shows.
    void Promise.allSettled([refreshCalendar(), reloadProposals()])
      .then(([calendar, proposals]) => {
        if (
          calendar.status === 'rejected' ||
          proposals.status === 'rejected'
        ) {
          setRetryError('Some of your plans could not be refreshed just now.');
        }
      })
      .finally(() => {
        retryInFlightRef.current = false;
        setRetryInFlight(false);
      });

    handleRetryGoals();
  }, [handleRetryGoals, refreshCalendar, reloadProposals]);

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

      {actionError ? (
        <View style={styles.actionNotice}>
          <ThemedText
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
            type="supporting"
            style={[styles.status, styles.noticeText, { color: danger }]}
          >
            {actionError}
          </ThemedText>
          {acceptRefreshFailed ? (
            <Button
              accessibilityState={{ busy: retryInFlight, disabled: retryInFlight }}
              disabled={retryInFlight}
              label="Reload calendar"
              onPress={handleRetryCalendarRefresh}
              size="sm"
              variant="secondary"
            />
          ) : null}
        </View>
      ) : null}

      {pendingProposals.length > 0 ? (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <ThemedText type="subheading">Suggestions</ThemedText>
          </View>
          {answerableProposals.map((proposal) => (
            <ProposalRow
              borderColor={border}
              canRespond
              key={proposal.id}
              mutedColor={muted}
              now={nowDate}
              onAccept={handleAccept}
              onDecline={handleDecline}
              pendingAction={pendingAction}
              proposal={proposal}
            />
          ))}
          {suggestionsWaiting.map((proposal) => (
            <ProposalRow
              borderColor={border}
              canRespond={false}
              key={proposal.id}
              mutedColor={muted}
              now={nowDate}
              onAccept={handleAccept}
              onDecline={handleDecline}
              pendingAction={pendingAction}
              proposal={proposal}
            />
          ))}
        </View>
      ) : null}

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <ThemedText type="subheading">Upcoming</ThemedText>
          <Button
            label="Suggest a time"
            onPress={handleSuggestTime}
            size="sm"
            variant="ghost"
          />
        </View>
        {agendaDays.length === 0 ? (
          <ThemedText type="supporting" style={{ color: muted }}>
            Nothing on the calendar yet.
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
          <ThemedText type="supporting" style={{ color: muted }}>
            {goalsError ? 'Your goals could not be loaded.' : 'No goals yet.'}
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

type ProposalRowProps = {
  proposal: EventProposal;
  now: Date;
  canRespond: boolean;
  pendingAction: PendingAction | null;
  onAccept: (proposalId: string) => void;
  onDecline: (proposalId: string) => void;
  borderColor: string;
  mutedColor: string;
};

function ProposalRow({
  proposal,
  now,
  canRespond,
  pendingAction,
  onAccept,
  onDecline,
  borderColor,
  mutedColor,
}: ProposalRowProps) {
  const anyPending = pendingAction !== null;
  const busy = pendingAction?.proposalId === proposal.id;

  return (
    <View style={[styles.card, { borderColor }]}>
      <ThemedText numberOfLines={2} type="bodyEmphasis">
        {proposal.title}
      </ThemedText>
      <ThemedText type="caption" style={{ color: mutedColor }}>
        {formatProposalWhen(proposal, now)}
      </ThemedText>
      {canRespond ? (
        <View style={styles.responseRow}>
          <ThemedText type="caption" style={{ color: mutedColor }}>
            {`From ${proposal.proposerName}`}
          </ThemedText>
          <View style={styles.responseActions}>
            <Button
              accessibilityState={{ busy, disabled: anyPending }}
              disabled={anyPending}
              label="Accept"
              onPress={() => onAccept(proposal.id)}
              size="sm"
            />
            <Button
              accessibilityState={{ busy, disabled: anyPending }}
              disabled={anyPending}
              label="Not now"
              onPress={() => onDecline(proposal.id)}
              size="sm"
              variant="secondary"
            />
          </View>
        </View>
      ) : (
        <ThemedText type="caption" style={{ color: mutedColor }}>
          Waiting for them.
        </ThemedText>
      )}
    </View>
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
  actionNotice: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing[12],
    justifyContent: 'space-between',
    minHeight: 44,
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
  card: {
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing[8],
    minHeight: 44,
    paddingVertical: Spacing[12],
  },
  responseRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[12],
    justifyContent: 'space-between',
  },
  responseActions: {
    flexDirection: 'row',
    gap: Spacing[8],
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
