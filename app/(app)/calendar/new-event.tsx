import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NativeDateTimeField } from '@/components/forms/native-date-time-field';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { Spacing } from '@/constants/theme';
import { useCalendar } from '@/features/calendar/calendar-context';
import { addDays, startOfDay } from '@/features/calendar/calendar-date-utils';
import { CALENDAR_PRESET_LABELS } from '@/features/calendar/types';
import type { CalendarActor, CalendarPresetLabel } from '@/features/calendar/types';
import { useThemeColor } from '@/hooks/use-theme-color';
import { useSpace } from '@/features/space/space-context';

/** Quiet reminder choices: minutes before the event starts. */
const REMINDER_OPTIONS: { label: string; value: number | null }[] = [
  { label: 'No reminder', value: null },
  { label: 'At start', value: 0 },
  { label: '10 min', value: 10 },
  { label: '30 min', value: 30 },
  { label: '1 hour', value: 60 },
  { label: '1 day', value: 1440 },
];

function applyDatePart(base: Date, datePart: Date) {
  const next = new Date(base);
  next.setFullYear(datePart.getFullYear(), datePart.getMonth(), datePart.getDate());
  return next;
}

function applyTimePart(base: Date, timePart: Date) {
  const next = new Date(base);
  next.setHours(timePart.getHours(), timePart.getMinutes(), 0, 0);
  return next;
}

function datePlusOneHour(date: Date) {
  return new Date(date.getTime() + 60 * 60 * 1000);
}

function ensureEndAfterStart(startDate: Date, currentEndDate: Date) {
  if (currentEndDate.getTime() > startDate.getTime()) {
    return currentEndDate;
  }

  return datePlusOneHour(startDate);
}

function getSeedDate(rawDate: string | string[] | undefined) {
  const dateValue = Array.isArray(rawDate) ? rawDate[0] : rawDate;

  if (!dateValue) {
    return null;
  }

  const parsedDate = new Date(dateValue);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return parsedDate;
}

export default function NewCalendarEventScreen() {
  const router = useRouter();
  const { date } = useLocalSearchParams<{ date?: string | string[] }>();
  const insets = useSafeAreaInsets();
  const isIos = process.env.EXPO_OS === 'ios';
  const { addEvent } = useCalendar();
  const { space } = useSpace();
  const border = useThemeColor({}, 'border');
  const accent = useThemeColor({}, 'accent');
  const onAccent = useThemeColor({}, 'onAccent');
  const partnerAccent = useThemeColor({}, 'partnerAccent');
  const surface2 = useThemeColor({}, 'surface2');
  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const danger = useThemeColor({}, 'danger');
  const background = useThemeColor({}, 'background');

  const seedDate = useMemo(() => getSeedDate(date), [date]);
  const initialStart = useMemo(() => {
    const currentDate = new Date();

    if (!seedDate) {
      return currentDate;
    }

    currentDate.setFullYear(seedDate.getFullYear(), seedDate.getMonth(), seedDate.getDate());
    currentDate.setHours(9, 0, 0, 0);
    return currentDate;
  }, [seedDate]);
  const initialEnd = useMemo(() => datePlusOneHour(initialStart), [initialStart]);

  const [title, setTitle] = useState('');
  const [actor, setActor] = useState<CalendarActor>('you');
  const [presetLabel, setPresetLabel] = useState<CalendarPresetLabel>('Work');
  const [customLabel, setCustomLabel] = useState('');
  const [startsAt, setStartsAt] = useState(initialStart);
  const [endsAt, setEndsAt] = useState(initialEnd);
  const [allDay, setAllDay] = useState(false);
  const [together, setTogether] = useState(false);
  const [repeatsWeekly, setRepeatsWeekly] = useState(false);
  const [reminderOffset, setReminderOffset] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // All-day events span 00:00 → next midnight; timed events use the raw picks.
  const effectiveStart = useMemo(
    () => (allDay ? startOfDay(startsAt) : startsAt),
    [allDay, startsAt]
  );
  const effectiveEnd = useMemo(
    () => (allDay ? addDays(startOfDay(endsAt), 1) : endsAt),
    [allDay, endsAt]
  );
  const isRangeInvalid = effectiveEnd.getTime() <= effectiveStart.getTime();

  const handleToggleAllDay = useCallback(() => {
    if (allDay) {
      const nextStart = new Date(startOfDay(startsAt));
      nextStart.setHours(9, 0, 0, 0);
      setStartsAt(nextStart);
      setEndsAt(datePlusOneHour(nextStart));
      setAllDay(false);
    } else {
      const dayStart = startOfDay(startsAt);
      setStartsAt(dayStart);
      setEndsAt(addDays(dayStart, 1));
      setAllDay(true);
    }
  }, [allDay, startsAt]);

  const handleToggleTogether = useCallback(() => {
    setTogether((current) => !current);
  }, []);

  const handleToggleRepeatsWeekly = useCallback(() => {
    setRepeatsWeekly((current) => !current);
  }, []);

  const inputStyle = useMemo(
    () => [
      styles.input,
      {
        borderColor: border,
        backgroundColor: surface2,
        color: text,
      },
    ],
    [border, surface2, text]
  );
  const contentContainerStyle = useMemo(
    () => [styles.contentContainer, { paddingBottom: insets.bottom + Spacing[24] }],
    [insets.bottom]
  );
  const footerStyle = useMemo(
    () => [styles.footer, { paddingBottom: insets.bottom + Spacing[12] }],
    [insets.bottom]
  );

  const handleSave = useCallback(async () => {
    const trimmedTitle = title.trim();

    if (!trimmedTitle) {
      setError('Event title is required.');
      return;
    }

    if (isRangeInvalid) {
      setError('End time must be after start time.');
      return;
    }

    setIsSubmitting(true);
    setError('');
    try {
      await addEvent({
        title: trimmedTitle,
        startsAt: effectiveStart.toISOString(),
        endsAt: effectiveEnd.toISOString(),
        actor,
        actorName: actor === 'you' ? 'You' : space?.partnerName ?? 'Partner',
        label: {
          preset: presetLabel,
          customText: customLabel.trim() || undefined,
        },
        reminderMinutesBefore: reminderOffset === null ? undefined : [reminderOffset],
        allDay,
        together,
        recurrence: repeatsWeekly ? 'weekly' : 'none',
      });

      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create event');
    } finally {
      setIsSubmitting(false);
    }
  }, [
    actor,
    addEvent,
    allDay,
    customLabel,
    effectiveEnd,
    effectiveStart,
    presetLabel,
    reminderOffset,
    repeatsWeekly,
    router,
    space?.partnerName,
    title,
    together,
    isRangeInvalid,
  ]);

  return (
    <>
      <Stack.Screen options={{ title: 'New event' }} />
      <KeyboardAvoidingView
        behavior={isIos ? 'padding' : undefined}
        style={[styles.root, { backgroundColor: background }]}
      >
        <ScrollView
          contentContainerStyle={contentContainerStyle}
          contentInsetAdjustmentBehavior="never"
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Surface variant="raised" style={styles.section}>
            <ThemedText type="meta">Event details</ThemedText>
            <TextInput
              accessibilityLabel="Event title"
              autoCapitalize="sentences"
              onChangeText={(value) => {
                setTitle(value);
                if (error) {
                  setError('');
                }
              }}
              placeholder="Event title"
              placeholderTextColor={muted}
              style={inputStyle}
              value={title}
            />
          </Surface>

          <Surface style={styles.section}>
            <ThemedText type="meta">Creator</ThemedText>
            <View accessibilityRole="radiogroup">
              <View style={styles.choiceRow}>
                {(['you', 'partner'] as const).map((candidate) => {
                  const selected = actor === candidate;

                  return (
                    <Pressable
                      accessibilityLabel={`Set creator to ${candidate}`}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: selected }}
                      key={candidate}
                      onPress={() => setActor(candidate)}
                      style={[
                        styles.choiceChip,
                        {
                          borderColor: selected
                            ? candidate === 'you'
                              ? accent
                              : partnerAccent
                            : border,
                          backgroundColor: selected
                            ? candidate === 'you'
                              ? accent
                              : partnerAccent
                            : surface2,
                        },
                      ]}
                    >
                      <ThemedText
                        type="caption"
                        style={{ color: selected ? onAccent : text }}
                      >
                        {candidate === 'you' ? 'You' : 'Partner'}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </Surface>

          <Surface style={styles.section}>
            <View style={styles.choiceRow}>
              <Pressable
                accessibilityLabel="Toggle all day"
                accessibilityRole="checkbox"
                accessibilityState={{ checked: allDay }}
                onPress={handleToggleAllDay}
                style={[
                  styles.choiceChip,
                  {
                    borderColor: allDay ? accent : border,
                    backgroundColor: allDay ? accent : surface2,
                  },
                ]}
              >
                <ThemedText type="caption" style={{ color: allDay ? onAccent : text }}>
                  All day
                </ThemedText>
              </Pressable>
              <Pressable
                accessibilityLabel="Mark as time together"
                accessibilityRole="checkbox"
                accessibilityState={{ checked: together }}
                onPress={handleToggleTogether}
                style={[
                  styles.choiceChip,
                  {
                    borderColor: together ? accent : border,
                    backgroundColor: together ? accent : surface2,
                  },
                ]}
              >
                <ThemedText type="caption" style={{ color: together ? onAccent : text }}>
                  Together
                </ThemedText>
              </Pressable>
              <Pressable
                accessibilityLabel="Toggle repeats weekly"
                accessibilityRole="checkbox"
                accessibilityState={{ checked: repeatsWeekly }}
                onPress={handleToggleRepeatsWeekly}
                style={[
                  styles.choiceChip,
                  {
                    borderColor: repeatsWeekly ? accent : border,
                    backgroundColor: repeatsWeekly ? accent : surface2,
                  },
                ]}
              >
                <ThemedText type="caption" style={{ color: repeatsWeekly ? onAccent : text }}>
                  Repeats weekly
                </ThemedText>
              </Pressable>
            </View>
            <ThemedText type="caption" selectable style={{ color: muted }}>
              Together marks time you both share — it powers the countdown.
            </ThemedText>
            {repeatsWeekly ? (
              <ThemedText type="caption" selectable style={{ color: muted }}>
                Repeats weekly for a season — each week stays its own event,
                free to move or let go on its own.
              </ThemedText>
            ) : null}

            <NativeDateTimeField
              accessibilityLabel="Choose start date"
              label={allDay ? 'Start day' : 'Start date'}
              mode="date"
              onChange={(value) => {
                setStartsAt((current) => {
                  const nextStartDate = applyDatePart(current, value);
                  setEndsAt((currentEndDate) => {
                    if (!allDay) {
                      return ensureEndAfterStart(nextStartDate, currentEndDate);
                    }
                    const minEnd = addDays(startOfDay(nextStartDate), 1);
                    return currentEndDate.getTime() > minEnd.getTime()
                      ? currentEndDate
                      : minEnd;
                  });
                  return allDay ? startOfDay(nextStartDate) : nextStartDate;
                });
                setError('');
              }}
              value={startsAt}
            />

            {allDay ? (
              <ThemedText type="caption" selectable style={{ color: muted }}>
                All day
              </ThemedText>
            ) : (
              <>
                <NativeDateTimeField
                  accessibilityLabel="Choose start time"
                  label="Start time"
                  mode="time"
                  onChange={(value) => {
                    setStartsAt((current) => {
                      const nextStartDate = applyTimePart(current, value);
                      setEndsAt((currentEndDate) =>
                        ensureEndAfterStart(nextStartDate, currentEndDate)
                      );
                      return nextStartDate;
                    });
                    setError('');
                  }}
                  value={startsAt}
                />
                <ThemedText type="caption" selectable style={{ color: muted }}>
                  {startsAt.toLocaleString('en-US')}
                </ThemedText>
              </>
            )}

            <NativeDateTimeField
              accessibilityLabel="Choose end date"
              label={allDay ? 'End day' : 'End date'}
              mode="date"
              minimumDate={startsAt}
              onChange={(value) => {
                setEndsAt((current) => {
                  const nextEndDate = applyDatePart(current, value);
                  return allDay ? addDays(startOfDay(nextEndDate), 1) : nextEndDate;
                });
                setError('');
              }}
              value={allDay ? addDays(effectiveEnd, -1) : endsAt}
            />

            {!allDay ? (
              <>
                <NativeDateTimeField
                  accessibilityLabel="Choose end time"
                  label="End time"
                  mode="time"
                  onChange={(value) => {
                    setEndsAt((current) => applyTimePart(current, value));
                    setError('');
                  }}
                  value={endsAt}
                />
                <ThemedText type="caption" selectable style={{ color: muted }}>
                  {endsAt.toLocaleString('en-US')}
                </ThemedText>
              </>
            ) : null}

            {isRangeInvalid ? (
              <ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>
                End time must be after start time.
              </ThemedText>
            ) : null}
          </Surface>

          <Surface style={styles.section}>
            <ThemedText type="meta">Availability label</ThemedText>
            <View accessibilityRole="radiogroup">
              <View style={styles.choiceRow}>
                {CALENDAR_PRESET_LABELS.map((label) => {
                  const selected = presetLabel === label;

                  return (
                    <Pressable
                      accessibilityLabel={`Set label ${label}`}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: selected }}
                      key={label}
                      onPress={() => setPresetLabel(label)}
                      style={[
                        styles.choiceChip,
                        {
                          borderColor: selected ? accent : border,
                          backgroundColor: selected ? accent : surface2,
                        },
                      ]}
                    >
                      <ThemedText
                        type="caption"
                        style={{ color: selected ? onAccent : text }}
                      >
                        {label}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <TextInput
              accessibilityLabel="Custom label"
              autoCapitalize="sentences"
              onChangeText={setCustomLabel}
              placeholder="Optional custom label"
              placeholderTextColor={muted}
              style={inputStyle}
              value={customLabel}
            />
          </Surface>

          <Surface style={styles.section}>
            <ThemedText type="meta">Reminder</ThemedText>
            <View accessibilityRole="radiogroup">
              <View style={styles.choiceRow}>
                {REMINDER_OPTIONS.map((option) => {
                  const selected = reminderOffset === option.value;

                  return (
                    <Pressable
                      accessibilityLabel={`Set reminder: ${option.label}`}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      key={option.label}
                      onPress={() => setReminderOffset(option.value)}
                      style={[
                        styles.choiceChip,
                        {
                          borderColor: selected ? accent : border,
                          backgroundColor: selected ? accent : surface2,
                        },
                      ]}
                    >
                      <ThemedText
                        type="caption"
                        style={{ color: selected ? onAccent : text }}
                      >
                        {option.label}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <ThemedText type="caption" selectable style={{ color: muted }}>
              A quiet banner, never a sound.
            </ThemedText>
          </Surface>

          {error ? (
            <ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>
              {error}
            </ThemedText>
          ) : null}
        </ScrollView>

        <View style={[footerStyle, { borderColor: border, backgroundColor: background }]}>
          <Button
            disabled={isSubmitting || isRangeInvalid || title.trim().length === 0}
            label={isSubmitting ? 'Saving…' : 'Save event'}
            onPress={handleSave}
          />
          <Button label="Cancel" variant="secondary" onPress={() => router.back()} />
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: Spacing[16],
    paddingTop: Spacing[16],
    gap: Spacing[12],
  },
  section: {
    gap: Spacing[8],
  },
  input: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: Spacing[12],
    paddingVertical: Spacing[12],
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
    paddingHorizontal: Spacing[16],
    paddingTop: Spacing[12],
    gap: Spacing[8],
  },
});
