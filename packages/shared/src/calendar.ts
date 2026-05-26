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
};

export type CreateCalendarEventRequest = {
  title: string;
  startsAt: string;
  endsAt: string;
  actor: CalendarActor;
  actorName: string;
  label: CalendarLabel;
};

export type UpdateCalendarEventRequest = {
  title?: string;
  startsAt?: string;
  endsAt?: string;
  label?: CalendarLabel;
};
