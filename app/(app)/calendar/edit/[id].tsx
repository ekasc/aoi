import DateTimePicker from '@react-native-community/datetimepicker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

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

export default function EditCalendarEventScreen() {
  const router = useRouter();
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

  const handleSave = useCallback(async () => {
    if (!eventId || !event || !isOwner) {
      return;
    }

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError('Event title is required.');
      return;
    }

    if (endsAt.getTime() <= startsAt.getTime()) {
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
      <ScrollView
        style={{ backgroundColor: background }}
        contentContainerStyle={styles.contentContainer}
        contentInsetAdjustmentBehavior="automatic"
      >
        <Surface style={styles.section}>
          <ThemedText type="body">Loading event…</ThemedText>
        </Surface>
      </ScrollView>
    );
  }

  if (!isOwner) {
    return (
      <>
        <Stack.Screen options={{ title: 'View event' }} />
        <ScrollView
          style={{ backgroundColor: background }}
          contentContainerStyle={styles.contentContainer}
          contentInsetAdjustmentBehavior="automatic"
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
          <Button label="Done" onPress={() => router.back()} />
        </ScrollView>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Edit event' }} />
      <ScrollView
        style={{ backgroundColor: background }}
        contentContainerStyle={styles.contentContainer}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
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

          <DateTimePicker
            mode="date"
            onChange={(_, value) => {
              if (!value) {
                return;
              }
              setStartsAt((current) => applyDatePart(current, value));
            }}
            value={startsAt}
          />
          <DateTimePicker
            mode="time"
            onChange={(_, value) => {
              if (!value) {
                return;
              }
              setStartsAt((current) => applyTimePart(current, value));
            }}
            value={startsAt}
          />

          <DateTimePicker
            mode="date"
            onChange={(_, value) => {
              if (!value) {
                return;
              }
              setEndsAt((current) => applyDatePart(current, value));
            }}
            value={endsAt}
          />
          <DateTimePicker
            mode="time"
            onChange={(_, value) => {
              if (!value) {
                return;
              }
              setEndsAt((current) => applyTimePart(current, value));
            }}
            value={endsAt}
          />
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

        <View style={styles.actionRow}>
          <Button
            disabled={isWorking}
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
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  contentContainer: {
    paddingHorizontal: Spacing[16],
    paddingTop: Spacing[16],
    paddingBottom: Spacing[40],
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
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[8],
  },
});
