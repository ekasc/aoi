import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import {
  addMonths,
  isEventOnDate,
  monthBounds,
  startOfMonth,
  toDayKey,
} from '@/features/calendar/calendar-date-utils';
import {
  countCalendarEvents,
  deleteEvent as deleteCalendarEvent,
  getEventById as getCalendarEventById,
  initCalendarDb,
  insertEvent,
  listEventsInMonth,
  updateEvent as updateCalendarEvent,
} from '@/features/calendar/calendar-repository';
import { createCalendarSeed } from '@/features/calendar/calendar-seed';
import type {
  CalendarContextValue,
  CalendarEvent,
  CalendarMonthSummary,
  CreateCalendarEventInput,
  UpdateCalendarEventInput,
} from '@/features/calendar/types';

const CalendarContext = createContext<CalendarContextValue | undefined>(undefined);

export function CalendarProvider({ children }: PropsWithChildren) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [selectedDate, setSelectedDateState] = useState(() => new Date());
  const [visibleMonth, setVisibleMonthState] = useState(() =>
    startOfMonth(new Date())
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);

  const loadMonth = useCallback(async (monthDate: Date) => {
    const { monthStart, nextMonthStart } = monthBounds(monthDate);
    const monthEvents = await listEventsInMonth(
      monthStart.toISOString(),
      nextMonthStart.toISOString()
    );
    setEvents(monthEvents);
  }, []);

  useEffect(() => {
    let isActive = true;

    async function bootstrapCalendar() {
      await initCalendarDb();
      const existingCount = await countCalendarEvents();

      if (existingCount === 0) {
        const seedEvents = createCalendarSeed();
        for (const event of seedEvents) {
          await insertEvent(event);
        }
      }

      if (!isActive) {
        return;
      }

      setIsInitialized(true);
    }

    void bootstrapCalendar();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!isInitialized) {
      return;
    }

    let isActive = true;

    async function hydrateMonth() {
      setIsLoading(true);
      await loadMonth(visibleMonth);
      if (isActive) {
        setIsLoading(false);
      }
    }

    void hydrateMonth();

    return () => {
      isActive = false;
    };
  }, [isInitialized, loadMonth, visibleMonth]);

  const setSelectedDate = useCallback((date: Date) => {
    const normalizedDate = new Date(date);
    setSelectedDateState(normalizedDate);
    setVisibleMonthState((currentMonth) => {
      const nextMonth = startOfMonth(normalizedDate);
      if (
        nextMonth.getFullYear() === currentMonth.getFullYear() &&
        nextMonth.getMonth() === currentMonth.getMonth()
      ) {
        return currentMonth;
      }
      return nextMonth;
    });
  }, []);

  const setVisibleMonth = useCallback((date: Date) => {
    setVisibleMonthState(startOfMonth(date));
  }, []);

  const reloadCurrentMonth = useCallback(async () => {
    await loadMonth(visibleMonth);
  }, [loadMonth, visibleMonth]);

  const addEvent = useCallback(
    async (input: CreateCalendarEventInput) => {
      await insertEvent(input);
      await reloadCurrentMonth();
    },
    [reloadCurrentMonth]
  );

  const updateEvent = useCallback(
    async (input: UpdateCalendarEventInput) => {
      await updateCalendarEvent(input);
      await reloadCurrentMonth();
    },
    [reloadCurrentMonth]
  );

  const deleteEvent = useCallback(
    async (eventId: string) => {
      await deleteCalendarEvent(eventId);
      await reloadCurrentMonth();
    },
    [reloadCurrentMonth]
  );

  const eventsForDate = useCallback(
    (date: Date) =>
      events
        .filter((event) => isEventOnDate(event, date))
        .sort(
          (left, right) =>
            new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime()
        ),
    [events]
  );

  const monthSummary = useMemo<CalendarMonthSummary>(() => {
    return events.reduce<CalendarMonthSummary>((summary, event) => {
      const dayKey = toDayKey(new Date(event.startsAt));
      const current = summary[dayKey] ?? {
        total: 0,
        youCount: 0,
        partnerCount: 0,
      };

      summary[dayKey] = {
        total: current.total + 1,
        youCount: current.youCount + (event.actor === 'you' ? 1 : 0),
        partnerCount: current.partnerCount + (event.actor === 'partner' ? 1 : 0),
      };

      return summary;
    }, {});
  }, [events]);

  const getEventById = useCallback(
    async (eventId: string) => {
      const eventFromState =
        events.find((candidate) => candidate.id === eventId) ?? null;

      if (eventFromState) {
        return eventFromState;
      }

      return getCalendarEventById(eventId);
    },
    [events]
  );

  const value = useMemo<CalendarContextValue>(
    () => ({
      events,
      selectedDate,
      visibleMonth,
      monthSummary,
      isLoading,
      setSelectedDate,
      setVisibleMonth,
      addEvent,
      updateEvent,
      deleteEvent,
      eventsForDate,
      getEventById,
    }),
    [
      addEvent,
      deleteEvent,
      events,
      eventsForDate,
      getEventById,
      isLoading,
      monthSummary,
      selectedDate,
      setSelectedDate,
      setVisibleMonth,
      updateEvent,
      visibleMonth,
    ]
  );

  return (
    <CalendarContext.Provider value={value}>{children}</CalendarContext.Provider>
  );
}

export function useCalendar() {
  const context = useContext(CalendarContext);

  if (!context) {
    throw new Error('useCalendar must be used within CalendarProvider');
  }

  return context;
}

export function useCalendarMonthNavigation() {
  const { visibleMonth, setVisibleMonth } = useCalendar();

  const goToPreviousMonth = useCallback(() => {
    setVisibleMonth(addMonths(visibleMonth, -1));
  }, [setVisibleMonth, visibleMonth]);

  const goToNextMonth = useCallback(() => {
    setVisibleMonth(addMonths(visibleMonth, 1));
  }, [setVisibleMonth, visibleMonth]);

  return {
    goToPreviousMonth,
    goToNextMonth,
  };
}
