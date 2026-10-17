import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  useAnimatedKeyboard,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NativeDateTimeField } from '@/components/forms/native-date-time-field';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { Typography } from '@/constants/typography';
import { useCalendar } from '@/features/calendar/calendar-context';
import { addDays, initialEventStart, startOfDay } from '@/features/calendar/calendar-date-utils';
import { useThemeColor } from '@/hooks/use-theme-color';
import { usePreventLeave } from '@/hooks/use-prevent-leave';

function datePlusOneHour(date: Date) {
  return new Date(date.getTime() + 60 * 60 * 1000);
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The day a new event is seeded onto. A date-only `YYYY-MM-DD` param names a
 * local calendar day, not UTC midnight — parsing it with `new Date(value)`
 * would land on the previous day anywhere west of UTC. A full ISO timestamp
 * keeps its instant, and the local calendar day is read from it later.
 */
function getSeedDate(rawDate: string | string[] | undefined) {
  const dateValue = Array.isArray(rawDate) ? rawDate[0] : rawDate;

  if (!dateValue) {
    return null;
  }

  const dateOnly = DATE_ONLY_PATTERN.exec(dateValue);
  const parsedDate = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(dateValue);

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return parsedDate;
}

export default function NewCalendarEventScreen() {
  const router = useRouter();
  const { date, hour } = useLocalSearchParams<{
    date?: string | string[];
    hour?: string | string[];
  }>();
  const insets = useSafeAreaInsets();
  const { addEvent } = useCalendar();
  const border = useThemeColor({}, 'border');
  const accent = useThemeColor({}, 'accent');
  const onAccent = useThemeColor({}, 'onAccent');
  const surface2 = useThemeColor({}, 'surface2');
  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const danger = useThemeColor({}, 'danger');
  const background = useThemeColor({}, 'background');

  const seedDate = useMemo(() => getSeedDate(date), [date]);
  // Opened from an hour row, this starts at that hour rather than at nine.
  const initialStart = useMemo(
    () => initialEventStart(seedDate, hour),
    [hour, seedDate]
  );

  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState(initialStart);
  const [endsAt, setEndsAt] = useState(datePlusOneHour(initialStart));
  const [allDay, setAllDay] = useState(false);
  const [error, setError] = useState('');
  const [submission, setSubmission] = useState<'idle' | 'saving' | 'saved'>('idle');
  const isSubmitting = submission === 'saving';
  const submittingRef = useRef(false);
  const blockLeave = useCallback(() => {}, []);
  usePreventLeave(isSubmitting, blockLeave);
  useEffect(() => {
    if (submission === 'saved') router.back();
  }, [submission, router]);

  const effectiveStart = useMemo(
    () => (allDay ? startOfDay(startsAt) : startsAt),
    [allDay, startsAt]
  );
  const effectiveEnd = useMemo(
    () => (allDay ? addDays(startOfDay(endsAt), 1) : endsAt),
    [allDay, endsAt]
  );
  const isRangeInvalid = effectiveEnd.getTime() <= effectiveStart.getTime();
  // Which day this lands on, in words — the seed (tapped cell or 9am today)
  // is invisible otherwise, and decoding the Starts row is the #1 entry
  // error. Tracks edits, so it can never go stale.
  const eventDayLabel = useMemo(
    () =>
      effectiveStart.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }),
    [effectiveStart]
  );
  // Moving the start keeps the existing duration; the Ends field can still
  // stretch it independently.
  const handleStartChange = useCallback(
    (next: Date) => {
      if (submittingRef.current) return;
      setStartsAt(next);
      setEndsAt((current) => {
        const duration = Math.max(
          current.getTime() - startsAt.getTime(),
          60 * 60 * 1000
        );
        return new Date(next.getTime() + duration);
      });
      setError('');
    },
    [startsAt]
  );

  const handleEndChange = useCallback((next: Date) => {
    if (submittingRef.current) return;
    setEndsAt(next);
    setError('');
  }, []);

  const handleToggleAllDay = useCallback(() => {
    if (submittingRef.current) return;
    setAllDay((current) => {
      if (!current) {
        setStartsAt((value) => startOfDay(value));
        setEndsAt((value) => startOfDay(value));
      }
      return !current;
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (submittingRef.current || submission === 'saved') return;
    const trimmedTitle = title.trim();

    if (!trimmedTitle) {
      setError('Give the event a name.');
      return;
    }

    if (isRangeInvalid) {
      setError('The ending needs to come after the start.');
      return;
    }

    submittingRef.current = true;
    setSubmission('saving');
    setError('');
    try {
      await addEvent({
        title: trimmedTitle,
        startsAt: effectiveStart.toISOString(),
        endsAt: effectiveEnd.toISOString(),
        actor: 'you',
        actorName: 'You',
        // Unlabeled by default: `{ preset: 'Other' }` without custom text
        // is the domain's labelless representation. Stamping 'Work' here
        // misnames plans where the partner can see it.
        label: { preset: 'Other' },
        allDay,
        recurrence: 'none',
      });

      setSubmission('saved');
    } catch {
      setError('Could not save this event. Please try again.');
      setSubmission('idle');
    } finally {
      submittingRef.current = false;
    }
  }, [
    addEvent,
    allDay,
    effectiveEnd,
    effectiveStart,
    title,
    isRangeInvalid,
    submission,
  ]);

  const titleInputStyle = useMemo(
    () => [
      styles.titleInput,
      {
        borderColor: border,
        color: text,
      },
    ],
    [border, text]
  );
  const contentContainerStyle = useMemo(
    () => [styles.contentContainer, { paddingBottom: insets.bottom + Spacing[24] }],
    [insets.bottom]
  );
  // Keyboard avoidance tracks the reported keyboard height directly, like
  // the composer: KeyboardAvoidingView derives its offset from layout
  // measurements that go stale during the sheet's detent animation, which
  // collapses the scroll content to nothing (the "empty sheet"). The
  // animated height stays correct; Android resizes its window instead, so
  // the padding applies iOS-only.
  const isIos = process.env.EXPO_OS === 'ios';
  const keyboard = useAnimatedKeyboard();
  const keyboardStyle = useAnimatedStyle(() => ({
    paddingBottom: isIos ? keyboard.height.value : 0,
  }));

  const footerStyle = useMemo(
    () => [styles.footer, { paddingBottom: insets.bottom + Spacing[12] }],
    [insets.bottom]
  );

  return (
    <>
      <Stack.Screen options={{ title: 'New event' }} />
      <Animated.View
        style={[styles.root, { backgroundColor: background }, keyboardStyle]}
      >
        <ScrollView
          contentContainerStyle={contentContainerStyle}
          contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.titleBlock}>
            <ThemedText type="meta">The event</ThemedText>
            <TextInput
              accessibilityLabel="Event title"
              editable={!isSubmitting}
              autoCapitalize="sentences"
              autoFocus
              onChangeText={(value) => {
                setTitle(value);
                if (error) {
                  setError('');
                }
              }}
              placeholder="Dinner at nine"
              placeholderTextColor={muted}
              style={titleInputStyle}
              value={title}
            />
          </View>

          <View style={styles.section}>
            <ThemedText type="meta">When</ThemedText>
            <ThemedText type="supporting" style={{ color: muted }}>
              On {eventDayLabel}
            </ThemedText>
            <View style={styles.choiceRow}>
              <Pressable
                accessibilityLabel="All day"
                accessibilityRole="checkbox"
                accessibilityState={{ checked: allDay, disabled: isSubmitting }}
                aria-checked={allDay}
                disabled={isSubmitting}
                onPress={handleToggleAllDay}
                style={[
                  styles.choiceChip,
                  {
                    borderColor: allDay ? accent : border,
                    backgroundColor: allDay ? accent : surface2,
                  },
                ]}
              >
                <ThemedText
                  type="caption"
                  style={{ color: allDay ? onAccent : text, fontWeight: allDay ? '600' : '400' }}
                >
                  All day
                </ThemedText>
              </Pressable>
            </View>

            <View style={[styles.rowGroup, { borderColor: border }]}>
              <NativeDateTimeField
                accessibilityLabel="Choose start"
                disabled={isSubmitting}
                label="Starts"
                mode={allDay ? 'date' : 'datetime'}
                onChange={handleStartChange}
                textColor={text}
                value={startsAt}
                variant="row"
              />
              <View style={[styles.rowDivider, { backgroundColor: border }]} />
              <NativeDateTimeField
                accessibilityLabel="Choose end"
                disabled={isSubmitting}
                label="Ends"
                minimumDate={startsAt}
                mode={allDay ? 'date' : 'datetime'}
                onChange={handleEndChange}
                textColor={text}
                value={endsAt}
                variant="row"
              />
            </View>
          </View>

          {/* One announcer for the whole form (submit error wins, otherwise
              the range error): two adjacent alert regions double-announce
              near-identical strings to screen readers. */}
          {error || isRangeInvalid ? (
            <ThemedText accessibilityRole="alert" type="supporting" style={{ color: danger }}>
              {error || 'The ending needs to come after the start.'}
            </ThemedText>
          ) : null}
        </ScrollView>

        <View style={[footerStyle, { borderColor: border, backgroundColor: background }]}>
          <Button
            disabled={isSubmitting || isRangeInvalid}
            label={isSubmitting ? 'Saving…' : 'Save event'}
            onPress={handleSave}
          />
          <Button disabled={isSubmitting} label="Cancel" variant="secondary" onPress={() => { if (!submittingRef.current) router.back(); }} />
        </View>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: Spacing[24],
    paddingTop: Spacing[24],
    gap: Spacing[24],
  },
  titleBlock: {
    gap: Spacing[8],
  },
  titleInput: {
    ...Typography.inputDisplay,
    minHeight: 44,
    paddingVertical: Spacing[8],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  section: {
    gap: Spacing[12],
  },
  rowGroup: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowDivider: {
    height: StyleSheet.hairlineWidth,
  },
  choiceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[8],
  },
  choiceChip: {
    minHeight: 44,
    minWidth: 44,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing[24],
    paddingTop: Spacing[12],
    gap: Spacing[8],
  },
});
