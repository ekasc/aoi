import type { CalendarEventRecurrence } from '@aoi/shared';

export type CalendarActor = 'you' | 'partner';

/**
 * Weekly recurrence is deliberately SIMPLE — the API expands a weekly event
 * into a bounded horizon of concrete, ordinary events (no series
 * operations). Mirrors @aoi/shared's contract type.
 */
export type CalendarRecurrence = CalendarEventRecurrence;

export const CALENDAR_PRESET_LABELS = [
  'Work',
  'Gym',
  'Travel',
  'Date',
  'Family',
  'Other',
] as const;

export type CalendarPresetLabel = (typeof CALENDAR_PRESET_LABELS)[number];

export type CalendarLabel = {
  preset: CalendarPresetLabel;
  customText?: string;
};

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
  reminderMinutesBefore?: number[];
  /** All-day event: no time-of-day; UI shows "All day" instead of times. */
  allDay?: boolean;
  /** The couple is jointly involved — counts toward the countdown lane. */
  together?: boolean;
  /**
   * Weekly recurrence marker. A weekly event is expanded into concrete
   * instances (server-side in remote mode, in the local repository in stub
   * mode); each instance is an ordinary event. Absent means 'none'.
   */
  recurrence?: CalendarRecurrence;
  /**
   * Per-request ownership signal from the API (creator user id vs viewer).
   * Optional for locally constructed events; unknown must mean "not own".
   */
  isOwn?: boolean;
};

export type CreateCalendarEventInput = {
  title: string;
  startsAt: string;
  endsAt: string;
  actor: CalendarActor;
  actorName: string;
  label: CalendarLabel;
  reminderMinutesBefore?: number[];
  allDay?: boolean;
  together?: boolean;
  /** 'weekly' expands into concrete weekly instances. */
  recurrence?: CalendarRecurrence;
};

export type UpdateCalendarEventInput = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  label: CalendarLabel;
  reminderMinutesBefore?: number[];
  allDay?: boolean;
  together?: boolean;
  /** Applies to this single instance only — never regenerates a series. */
  recurrence?: CalendarRecurrence;
};

export type CalendarDaySummary = {
  total: number;
  youCount: number;
  partnerCount: number;
};

export type CalendarMonthSummary = Record<string, CalendarDaySummary>;

export type CalendarContextValue = {
  events: CalendarEvent[];
  /**
   * Events overlapping the upcoming window (today → ~30 days ahead), across
   * month boundaries. Feeds the countdown lane and the agenda view.
   */
  upcomingEvents: CalendarEvent[];
  selectedDate: Date;
  visibleMonth: Date;
  monthSummary: CalendarMonthSummary;
  isLoading: boolean;
  error: string | null;
  setSelectedDate: (date: Date) => void;
  setVisibleMonth: (date: Date) => void;
  addEvent: (input: CreateCalendarEventInput) => Promise<void>;
  updateEvent: (input: UpdateCalendarEventInput) => Promise<void>;
  deleteEvent: (eventId: string) => Promise<void>;
  /**
   * Re-reads the current month + upcoming window from the repository. Used
   * when a partner-side change arrives (push) and the local state may be
   * stale.
   */
  refresh: () => Promise<void>;
  eventsForDay: Record<string, CalendarEvent[]>;
  getEventById: (eventId: string) => Promise<CalendarEvent | null>;
};
