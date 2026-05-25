import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
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
import { CALENDAR_PRESET_LABELS } from '@/features/calendar/types';
import type { CalendarEvent, CalendarPresetLabel } from '@/features/calendar/types';
import { formatTimeRange } from '@/features/calendar/calendar-date-utils';
import { useThemeColor } from '@/hooks/use-theme-color';

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

export default function EditCalendarEventScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isIos = process.env.EXPO_OS === 'ios';
  const { id } = useLocalSearchParams<{ id?: string }>();
  const eventId = Array.isArray(id) ? id[0] : id;
  const { getEventById, updateEvent, deleteEvent } = useCalendar();
  const border = useThemeColor({}, 'border');
  const surface2 = useThemeColor({}, 'surface2');
  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const danger = useThemeColor({}, 'danger');
  const background = useThemeColor({}, 'background');

  const [event, setEvent] = useState<CalendarEvent | null>(null);
  const [title, setTitle] = useState('');
  const [presetLabel, setPresetLabel] = useState<CalendarPresetLabel>('Work');
  const [customLabel, setCustomLabel] = useState('');
  const [startsAt, setStartsAt] = useState(new Date());
  const [endsAt, setEndsAt] = useState(new Date());
  const [error, setError] = useState('');
  const [isWorking, setIsWorking] = useState(false);
  const isRangeInvalid = endsAt.getTime() <= startsAt.getTime();

  const isOwner = event?.actor === 'you';

  useEffect(() => {
    if (!eventId) {
      return;
    }

    let isActive = true;

    async function loadEvent() {
      const foundEvent = await getEventById(eventId);

      if (!isActive || !foundEvent) {
        return;
      }

      setEvent(foundEvent);
      setTitle(foundEvent.title);
      setPresetLabel(foundEvent.label.preset);
      setCustomLabel(foundEvent.label.customText ?? '');
      setStartsAt(new Date(foundEvent.startsAt));
      setEndsAt(new Date(foundEvent.endsAt));
    }

    void loadEvent();

    return () => {
      isActive = false;
    };
  }, [eventId, getEventById]);

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
    if (!eventId || !event || !isOwner) {
      return;
    }

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError('Event title is required.');
      return;
    }

    if (isRangeInvalid) {
      setError('End time must be after start time.');
      return;
    }

    setIsWorking(true);
    try {
      await updateEvent({
        id: eventId,
        title: trimmedTitle,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        label: {
          preset: presetLabel,
          customText: customLabel.trim() || undefined,
        },
      });

      router.back();
    } finally {
      setIsWorking(false);
    }
  }, [
    customLabel,
    endsAt,
    event,
    eventId,
    isOwner,
    presetLabel,
    router,
    startsAt,
    title,
    updateEvent,
    isRangeInvalid,
  ]);

  const handleDelete = useCallback(async () => {
    if (!eventId || !event || !isOwner) {
      return;
    }

    setIsWorking(true);
    try {
      await deleteEvent(eventId);
      router.back();
    } finally {
      setIsWorking(false);
    }
  }, [deleteEvent, event, eventId, isOwner, router]);

  if (!event) {
    return (
      <>
        <Stack.Screen options={{ title: 'Edit event' }} />
        <View style={[styles.root, { backgroundColor: background }]}>
          <ScrollView
            contentContainerStyle={contentContainerStyle}
            contentInsetAdjustmentBehavior="never"
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}
          >
            <Surface style={styles.section}>
              <ThemedText type="body">Loading event…</ThemedText>
            </Surface>
          </ScrollView>
          <View style={[footerStyle, { borderColor: border, backgroundColor: background }]}>
            <Button label="Close" variant="secondary" onPress={() => router.back()} />
          </View>
        </View>
      </>
    );
  }

  if (!isOwner) {
    return (
      <>
        <Stack.Screen options={{ title: 'View event' }} />
        <View style={[styles.root, { backgroundColor: background }]}>
          <ScrollView
            contentContainerStyle={contentContainerStyle}
            contentInsetAdjustmentBehavior="never"
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}
          >
            <Surface variant="raised" style={styles.section}>
              <ThemedText type="meta">Owner-only edit</ThemedText>
              <ThemedText type="title">{event.title}</ThemedText>
              <ThemedText type="caption" selectable style={{ color: muted }}>
                {formatTimeRange(event.startsAt, event.endsAt)}
              </ThemedText>
              <ThemedText type="caption" style={{ color: muted }}>
                {event.label.customText?.trim() || event.label.preset}
              </ThemedText>
              <ThemedText type="caption" style={{ color: muted }}>
                This event was created by {event.actorName}. Only the creator can edit
                or delete it.
              </ThemedText>
            </Surface>
          </ScrollView>
          <View style={[footerStyle, { borderColor: border, backgroundColor: background }]}>
            <Button label="Done" onPress={() => router.back()} />
          </View>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Edit event' }} />
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

            <ThemedText type="meta">Start</ThemedText>
            <NativeDateTimeField
              accessibilityLabel="Choose start date"
              label="Start date"
              mode="date"
              onChange={(value) => {
                setStartsAt((current) => {
                  const nextStartDate = applyDatePart(current, value);
                  setEndsAt((currentEndDate) =>
                    ensureEndAfterStart(nextStartDate, currentEndDate)
                  );
                  return nextStartDate;
                });
                setError('');
              }}
              value={startsAt}
            />
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

            <ThemedText type="meta">End</ThemedText>
            <NativeDateTimeField
              accessibilityLabel="Choose end date"
              label="End date"
              mode="date"
              minimumDate={startsAt}
              onChange={(value) => {
                setEndsAt((current) => applyDatePart(current, value));
                setError('');
              }}
              value={endsAt}
            />
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
            {isRangeInvalid ? (
              <ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>
                End time must be after start time.
              </ThemedText>
            ) : null}
          </Surface>

          <Surface style={styles.section}>
            <ThemedText type="meta">Availability label</ThemedText>
            <View style={styles.choiceRow}>
              {CALENDAR_PRESET_LABELS.map((label) => {
                const selected = presetLabel === label;

                return (
                  <Button
                    key={label}
                    label={label}
                    onPress={() => setPresetLabel(label)}
                    size="sm"
                    variant={selected ? 'primary' : 'secondary'}
                  />
                );
              })}
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

          {error ? (
            <ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>
              {error}
            </ThemedText>
          ) : null}
        </ScrollView>
        <View style={[footerStyle, { borderColor: border, backgroundColor: background }]}>
          <View style={styles.actionRow}>
            <Button
              disabled={isWorking || isRangeInvalid || title.trim().length === 0}
              label={isWorking ? 'Saving…' : 'Save changes'}
              onPress={handleSave}
            />
            <Button
              disabled={isWorking}
              label="Delete event"
              variant="destructive"
              onPress={handleDelete}
            />
            <Button label="Cancel" variant="secondary" onPress={() => router.back()} />
          </View>
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
  actionRow: {
    gap: Spacing[8],
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing[16],
    paddingTop: Spacing[12],
    gap: Spacing[8],
  },
});
