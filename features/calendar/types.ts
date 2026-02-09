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
};

export type CreateCalendarEventInput = {
  title: string;
  startsAt: string;
  endsAt: string;
  actor: CalendarActor;
  actorName: string;
  label: CalendarLabel;
};

export type UpdateCalendarEventInput = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  label: CalendarLabel;
};

export type CalendarDaySummary = {
  total: number;
  youCount: number;
  partnerCount: number;
};

export type CalendarMonthSummary = Record<string, CalendarDaySummary>;

export type CalendarContextValue = {
  events: CalendarEvent[];
  selectedDate: Date;
  visibleMonth: Date;
  monthSummary: CalendarMonthSummary;
  isLoading: boolean;
  setSelectedDate: (date: Date) => void;
  setVisibleMonth: (date: Date) => void;
  addEvent: (input: CreateCalendarEventInput) => Promise<void>;
  updateEvent: (input: UpdateCalendarEventInput) => Promise<void>;
  deleteEvent: (eventId: string) => Promise<void>;
  eventsForDate: (date: Date) => CalendarEvent[];
  getEventById: (eventId: string) => Promise<CalendarEvent | null>;
};
