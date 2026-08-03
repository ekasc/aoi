export type CalendarActor = 'you' | 'partner';

export const CALENDAR_PRESET_LABELS = [
  'Work',
  'Gym',
  'Travel',
  'Date',
  'Family',
  'Other',
] as const;

export type CalendarPresetLabel = (typeof CALENDAR_PRESET_LABELS)[number];

export type CalendarLabel =
  | { preset: CalendarPresetLabel; customText?: never }
  | { preset: 'Other'; customText: string };

export type CalendarEvent = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  actor: CalendarActor;
  actorName: string;
  label: CalendarLabel;
  createdAt: string;
  updatedAt: string;
  /** Minutes before start when a quiet local reminder should fire. */
  reminderMinutesBefore?: number[];
  /** All-day event: no time-of-day; UI shows "All day" instead of times. */
  allDay?: boolean;
  /** The couple is jointly involved — counts toward the countdown lane. */
  together?: boolean;
};

export type CalendarEventRow = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  actor: CalendarActor;
  actorName: string;
  labelPreset: CalendarPresetLabel;
  labelCustomText: string | null;
  createdAt: string;
  updatedAt: string;
  reminderMinutesBefore: number[] | null;
  allDay: boolean;
  together: boolean;
};

export type CreateCalendarEventRequest = {
  title: string;
  startsAt: string;
  endsAt: string;
  actor: CalendarActor;
  actorName: string;
  label: CalendarLabel;
  reminderMinutesBefore?: number[];
  allDay?: boolean;
  together?: boolean;
};

export type UpdateCalendarEventRequest = {
  title?: string;
  startsAt?: string;
  endsAt?: string;
  label?: CalendarLabel;
  reminderMinutesBefore?: number[];
  allDay?: boolean;
  together?: boolean;
};
