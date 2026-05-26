import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	type PropsWithChildren,
} from "react";

import {
	addMonths,
	isEventOnDate,
	monthBounds,
	startOfMonth,
	toDayKey,
} from "@/features/calendar/calendar-date-utils";
import { isStubMode } from "@/features/api-client";
import { createCalendarSeed } from "@/features/calendar/calendar-seed";
import type {
	CalendarContextValue,
	CalendarEvent,
	CalendarMonthSummary,
	CreateCalendarEventInput,
	UpdateCalendarEventInput,
} from "@/features/calendar/types";

// Choose calendar implementation based on stub mode
import * as _calendarImpl from "@/features/calendar/calendar-repository";
import * as _remoteCalendarImpl from "@/features/calendar/remote-calendar-repository";

const _useRemote = !isStubMode();

const initCalendarDb = _useRemote ? _remoteCalendarImpl.initCalendarDb : _calendarImpl.initCalendarDb;
const countCalendarEvents = _useRemote ? _remoteCalendarImpl.countCalendarEvents : _calendarImpl.countCalendarEvents;
const listEventsInMonth = _useRemote ? _remoteCalendarImpl.listEventsInMonth : _calendarImpl.listEventsInMonth;
const insertEvent = _useRemote ? _remoteCalendarImpl.insertEvent : _calendarImpl.insertEvent;
const updateEvent = _useRemote ? _remoteCalendarImpl.updateEvent : _calendarImpl.updateEvent;
const deleteEvent = _useRemote ? _remoteCalendarImpl.deleteEvent : _calendarImpl.deleteEvent;
const getEventById = _useRemote ? _remoteCalendarImpl.getEventById : _calendarImpl.getEventById;

// Keep aliases used throughout this file
const deleteCalendarEvent: typeof deleteEvent = deleteEvent;
const updateCalendarEvent: typeof updateEvent = updateEvent;
const getCalendarEventById: typeof getEventById = getEventById;

const CalendarContext = createContext<CalendarContextValue | undefined>(
	undefined,
);

export function CalendarProvider({ children }: PropsWithChildren) {
	const [events, setEvents] = useState<CalendarEvent[]>([]);
	const [selectedDate, setSelectedDateState] = useState(() => new Date());
	const [visibleMonth, setVisibleMonthState] = useState(() =>
		startOfMonth(new Date()),
	);
	const [isLoading, setIsLoading] = useState(true);
	const [isInitialized, setIsInitialized] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const loadMonth = useCallback(async (monthDate: Date) => {
		const { monthStart, nextMonthStart } = monthBounds(monthDate);
		const monthEvents = await listEventsInMonth(
			monthStart.toISOString(),
			nextMonthStart.toISOString(),
		);
		setEvents(monthEvents);
	}, []);

	useEffect(() => {
		let isActive = true;

		async function bootstrapCalendar() {
			try {
				await initCalendarDb();
				const existingCount = await countCalendarEvents();

				if (existingCount === 0) {
					const seedEvents = createCalendarSeed();
					await Promise.all(seedEvents.map(insertEvent));
				}

				if (!isActive) {
					return;
				}

				setIsInitialized(true);
			} catch (err) {
				if (isActive) {
					setError(
						err instanceof Error ? err.message : "Failed to initialize calendar",
					);
				}
			}
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
			try {
				await loadMonth(visibleMonth);
				if (isActive) {
					setIsLoading(false);
				}
			} catch (err) {
				if (isActive) {
					setIsLoading(false);
					setError(
						err instanceof Error ? err.message : "Failed to load calendar events",
					);
				}
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
		[reloadCurrentMonth],
	);

	const updateEvent = useCallback(
		async (input: UpdateCalendarEventInput) => {
			await updateCalendarEvent(input);
			await reloadCurrentMonth();
		},
		[reloadCurrentMonth],
	);

	const deleteEvent = useCallback(
		async (eventId: string) => {
			await deleteCalendarEvent(eventId);
			await reloadCurrentMonth();
		},
		[reloadCurrentMonth],
	);

	const eventsForDay = useMemo<Record<string, CalendarEvent[]>>(() => {
		const map: Record<string, CalendarEvent[]> = {};
		for (const event of events) {
			const eventDate = new Date(event.startsAt);
			// Gather all day keys this event falls on using isEventOnDate
			// We iterate over all unique day keys present in events plus the event's own day
			const dayKey = toDayKey(eventDate);
			if (isEventOnDate(event, eventDate)) {
				if (!map[dayKey]) {
					map[dayKey] = [];
				}
				map[dayKey].push(event);
			}
		}
		// Sort each day's events by start time
		for (const key of Object.keys(map)) {
			map[key].sort(
				(left, right) =>
					new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime(),
			);
		}
		return map;
	}, [events]);

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
				youCount: current.youCount + (event.actor === "you" ? 1 : 0),
				partnerCount:
					current.partnerCount + (event.actor === "partner" ? 1 : 0),
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
		[events],
	);

	const value = useMemo<CalendarContextValue>(
		() => ({
			events,
			selectedDate,
			visibleMonth,
			monthSummary,
			isLoading,
			error,
			setSelectedDate,
			setVisibleMonth,
			addEvent,
			updateEvent,
			deleteEvent,
			eventsForDay,
			getEventById,
		}),
		[
			addEvent,
			deleteEvent,
			error,
			events,
			eventsForDay,
			getEventById,
			isLoading,
			monthSummary,
			selectedDate,
			setSelectedDate,
			setVisibleMonth,
			updateEvent,
			visibleMonth,
		],
	);

	return (
		<CalendarContext.Provider value={value}>
			{children}
		</CalendarContext.Provider>
	);
}

export function useCalendar() {
	const context = useContext(CalendarContext);

	if (!context) {
		throw new Error("useCalendar must be used within CalendarProvider");
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
