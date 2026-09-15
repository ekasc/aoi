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
import { Spacing } from '@/constants/theme';
import { FontFamilies } from '@/constants/typography';
import { useCalendar } from '@/features/calendar/calendar-context';
import { addDays, startOfDay } from '@/features/calendar/calendar-date-utils';
import { CALENDAR_PRESET_LABELS } from '@/features/calendar/types';
import type { CalendarPresetLabel } from '@/features/calendar/types';
import { useThemeColor } from '@/hooks/use-theme-color';

function datePlusOneHour(date: Date) {
  return new Date(date.getTime() + 60 * 60 * 1000);
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
  const border = useThemeColor({}, 'border');
  const accent = useThemeColor({}, 'accent');
  const onAccent = useThemeColor({}, 'onAccent');
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

  const [title, setTitle] = useState('');
  const [presetLabel, setPresetLabel] = useState<CalendarPresetLabel>('Work');
  const [startsAt, setStartsAt] = useState(initialStart);
  const [endsAt, setEndsAt] = useState(datePlusOneHour(initialStart));
  const [allDay, setAllDay] = useState(false);
  const [together, setTogether] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const effectiveStart = useMemo(
    () => (allDay ? startOfDay(startsAt) : startsAt),
    [allDay, startsAt]
  );
  const effectiveEnd = useMemo(
    () => (allDay ? addDays(startOfDay(endsAt), 1) : endsAt),
    [allDay, endsAt]
  );
  const isRangeInvalid = effectiveEnd.getTime() <= effectiveStart.getTime();

  // Moving the start keeps the existing duration; the Ends field can still
  // stretch it independently.
  const handleStartChange = useCallback(
    (next: Date) => {
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
    setEndsAt(next);
    setError('');
  }, []);

  const handleToggleAllDay = useCallback(() => {
    setAllDay((current) => {
      if (!current) {
        setStartsAt((value) => startOfDay(value));
        setEndsAt((value) => startOfDay(value));
      }
      return !current;
    });
  }, []);

  const handleToggleTogether = useCallback(() => {
    setTogether((current) => !current);
  }, []);

  const handleSave = useCallback(async () => {
    const trimmedTitle = title.trim();

    if (!trimmedTitle) {
      setError('Give the event a name.');
      return;
    }

    if (isRangeInvalid) {
      setError('The ending needs to come after the start.');
      return;
    }

    setIsSubmitting(true);
    setError('');
    try {
      await addEvent({
        title: trimmedTitle,
        startsAt: effectiveStart.toISOString(),
        endsAt: effectiveEnd.toISOString(),
        actor: 'you',
        actorName: 'You',
        label: { preset: presetLabel },
        allDay,
        together,
        recurrence: 'none',
      });

      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create event');
    } finally {
      setIsSubmitting(false);
    }
  }, [
    addEvent,
    allDay,
    effectiveEnd,
    effectiveStart,
    presetLabel,
    router,
    title,
    together,
    isRangeInvalid,
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
  const footerStyle = useMemo(
    () => [styles.footer, { paddingBottom: insets.bottom + Spacing[12] }],
    [insets.bottom]
  );

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
          <View style={styles.titleBlock}>
            <ThemedText type="meta">The event</ThemedText>
            <TextInput
              accessibilityLabel="Event title"
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
            </View>

            <View style={[styles.rowGroup, { borderColor: border }]}>
              <NativeDateTimeField
                accessibilityLabel="Choose start"
                label="Starts"
                mode={allDay ? 'date' : 'datetime'}
                onChange={handleStartChange}
                value={startsAt}
                variant="row"
              />
              <View style={[styles.rowDivider, { backgroundColor: border }]} />
              <NativeDateTimeField
                accessibilityLabel="Choose end"
                label="Ends"
                minimumDate={startsAt}
                mode={allDay ? 'date' : 'datetime'}
                onChange={handleEndChange}
                value={endsAt}
                variant="row"
              />
            </View>

            {isRangeInvalid ? (
              <ThemedText accessibilityRole="alert" type="supporting" style={{ color: danger }}>
                The ending needs to come after the start.
              </ThemedText>
            ) : null}
          </View>

          <View style={styles.section}>
            <ThemedText type="meta">Label</ThemedText>
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
          </View>

          {error ? (
            <ThemedText accessibilityRole="alert" type="supporting" style={{ color: danger }}>
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
    paddingHorizontal: Spacing[24],
    paddingTop: Spacing[24],
    gap: Spacing[24],
  },
  titleBlock: {
    gap: Spacing[8],
  },
  titleInput: {
    fontFamily: FontFamilies.display,
    fontSize: 22,
    lineHeight: 30,
    letterSpacing: -0.2,
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
