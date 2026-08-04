export type CalendarActor = 'you' | 'partner';

/**
 * Recurrence is deliberately SIMPLE: only weekly, and the API expands a
 * weekly event into concrete, ordinary events (a bounded horizon) — there
 * are no series operations. Editing or deleting one instance never touches
 * the rest.
 */
export const CALENDAR_RECURRENCES = ['none', 'weekly'] as const;

export type CalendarEventRecurrence = (typeof CALENDAR_RECURRENCES)[number];

/**
 * How many concrete weekly instances a `recurrence: 'weekly'` create expands
 * into (the original week included). Bounded on purpose: instances are
 * ordinary events, and there are no series operations.
 */
export const WEEKLY_RECURRENCE_INSTANCE_COUNT = 13;

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
  /**
   * Weekly recurrence marker. A weekly event is expanded into concrete
   * instances server-side; each instance is an ordinary event. Absent means
   * `'none'`.
   */
  recurrence?: CalendarEventRecurrence;
  /**
   * Per-request ownership signal from the API (creator user id vs viewer).
   * Optional for locally constructed events; unknown must mean "not own".
   */
  isOwn?: boolean;
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
  recurrence: CalendarEventRecurrence;
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
  /** 'weekly' expands into concrete weekly instances server-side. */
  recurrence?: CalendarEventRecurrence;
};

export type UpdateCalendarEventRequest = {
  title?: string;
  startsAt?: string;
  endsAt?: string;
  label?: CalendarLabel;
  reminderMinutesBefore?: number[];
  allDay?: boolean;
  together?: boolean;
  /** Applies to this single instance only — never regenerates a series. */
  recurrence?: CalendarEventRecurrence;
};
