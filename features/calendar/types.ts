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
  eventsForDay: Record<string, CalendarEvent[]>;
  getEventById: (eventId: string) => Promise<CalendarEvent | null>;
};
