import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type PropsWithChildren,
} from "react";

import {
	addDays,
	addMonths,
	eventDayKeys,
	monthBounds,
	startOfDay,
	startOfMonth,
	toDayKey,
} from "@/features/calendar/calendar-date-utils";
import { isStubMode } from "@/features/api-client";
import { usePreviewVariant } from "@/features/dev/preview";
import { applyCalendarSeed, getCalendarSeedMarker, setCalendarSeedMarker } from "@/features/calendar/calendar-seed";
import { useEventReminders } from "@/features/calendar/use-event-reminders";
import type {
	CalendarContextValue,
	CalendarEvent,
	CalendarMonthReadState,
	CalendarMonthSummary,
	CreateCalendarEventInput,
	UpdateCalendarEventInput,
} from "@/features/calendar/types";

// Choose calendar implementation based on stub mode
import * as _calendarImpl from "@/features/calendar/calendar-repository";
import * as _remoteCalendarImpl from "@/features/calendar/remote-calendar-repository";

const _useRemote = !isStubMode();

const initCalendarDb = _useRemote ? _remoteCalendarImpl.initCalendarDb : _calendarImpl.initCalendarDb;
const listEventsInMonth = _useRemote ? _remoteCalendarImpl.listEventsInMonth : _calendarImpl.listEventsInMonth;
const listEventsInRange = _useRemote ? _remoteCalendarImpl.listEventsInRange : _calendarImpl.listEventsInRange;
const insertEvent = _useRemote ? _remoteCalendarImpl.insertEvent : _calendarImpl.insertEvent;
const updateEvent = _useRemote ? _remoteCalendarImpl.updateEvent : _calendarImpl.updateEvent;
const deleteEvent = _useRemote ? _remoteCalendarImpl.deleteEvent : _calendarImpl.deleteEvent;
const getEventById = _useRemote ? _remoteCalendarImpl.getEventById : _calendarImpl.getEventById;

/** Horizon for the countdown lane + agenda view. */
const UPCOMING_WINDOW_DAYS = 30;

/** The month as a comparable number, so windows and pages compare cheaply. */
function monthIndex(date: Date): number {
	return date.getFullYear() * 12 + date.getMonth();
}

function monthKey(date: Date): string {
	return `${date.getFullYear()}-${date.getMonth()}`;
}

/**
 * The delivered window: the visible month plus one neighbour each side, so
 * the pager's adjacent pages are already answered. The identity travels with
 * the answer, which is what lets a caller tell a loaded month from an
 * unqueried one.
 */
function monthWindowBounds(monthDate: Date) {
	const { monthStart, nextMonthStart } = monthBounds(monthDate);
	const rangeStart = addMonths(monthStart, -1);
	const rangeEnd = addMonths(nextMonthStart, 1);
	return {
		startIso: rangeStart.toISOString(),
		endIso: rangeEnd.toISOString(),
		firstMonthIndex: monthIndex(rangeStart),
		lastMonthIndex: monthIndex(rangeEnd) - 1,
	};
}

/**
 * The settled answer for one window. `monthKey` names the visible month it
 * was read for: while the visible month differs, its replacement is in
 * flight and no page inside it may be called empty.
 */
type MonthRead = {
	monthKey: string;
	firstMonthIndex: number;
	lastMonthIndex: number;
	status: 'ready' | 'error';
};

// Keep aliases used throughout this file
const deleteCalendarEvent: typeof deleteEvent = deleteEvent;
const updateCalendarEvent: typeof updateEvent = updateEvent;
const getCalendarEventById: typeof getEventById = getEventById;

const CalendarContext = createContext<CalendarContextValue | undefined>(
	undefined,
);

// One flight per process: a dev double-mount must await the same plant
// instead of planting twice. Reset on failure so a later mount retries.
let seedTask: Promise<void> | null = null;

function ensureCalendarSeedOnce(): Promise<void> {
	if (!seedTask) {
		seedTask = applyCalendarSeed({
			loadMarker: getCalendarSeedMarker,
			saveMarker: setCalendarSeedMarker,
			removeById: (id) => deleteEvent(id),
			plant: (input) => insertEvent(input),
		}).catch((err: unknown) => {
			seedTask = null;
			throw err;
		});
	}
	return seedTask;
}

export function CalendarProvider({ children }: PropsWithChildren) {
  const preview = usePreviewVariant();
  const previewSeed = preview.active && preview.variant !== 'empty' && preview.variant !== 'setup';
	const [events, setEvents] = useState<CalendarEvent[]>([]);
	const [upcomingEvents, setUpcomingEvents] = useState<CalendarEvent[]>([]);
	const [selectedDate, setSelectedDateState] = useState(() => new Date());
	const [visibleMonth, setVisibleMonthState] = useState(() =>
		startOfMonth(new Date()),
	);
	const [monthRead, setMonthRead] = useState<MonthRead | null>(null);
	const [monthReadInFlight, setMonthReadInFlight] = useState<string | null>(
		null,
	);
	const [isInitialized, setIsInitialized] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// Monotonic identity for month-window reads. Every read — a visible month
	// change, a refresh, a post-mutation reload — takes the next number, and
	// only the latest may write. An older answer that lands later is not news.
	const monthRequestSeq = useRef(0);
	// What the tree has actually committed as the visible month. A delayed
	// reload — a save that lands, a retained refresh callback — must ask for
	// the month on screen, not the one its closure was born with.
	const visibleMonthRef = useRef(visibleMonth);
	// A completion that arrives after the tree is gone has nothing to publish.
	const isMountedRef = useRef(true);
	const { rescheduleEventReminders, cancelEventReminders } =
		useEventReminders();

	// Layout-synced, so the ref is current before any passive effect or async
	// continuation for that commit can run.
	useLayoutEffect(() => {
		visibleMonthRef.current = visibleMonth;
	}, [visibleMonth]);

	useLayoutEffect(() => {
		isMountedRef.current = true;
		return () => {
			isMountedRef.current = false;
		};
	}, []);

	const readMonthWindow = useCallback(async (monthDate: Date) => {
		const requestId = ++monthRequestSeq.current;
		const requestedMonth = monthKey(monthDate);
		const { startIso, endIso, firstMonthIndex, lastMonthIndex } =
			monthWindowBounds(monthDate);
		// Pending is published before the wait, so even a refresh of the month
		// already on screen cannot pass its old answer off as current.
		setMonthReadInFlight(requestedMonth);
		try {
			const monthEvents = await listEventsInMonth(startIso, endIso);
			if (requestId !== monthRequestSeq.current || !isMountedRef.current) {
				return;
			}
			setEvents(monthEvents);
			setMonthRead({
				monthKey: requestedMonth,
				firstMonthIndex,
				lastMonthIndex,
				status: 'ready',
			});
			setMonthReadInFlight(null);
			// A read that succeeded is proof the failure is gone.
			setError(null);
		} catch (err) {
			// A superseded read's failure is not the current window's failure.
			if (requestId !== monthRequestSeq.current) {
				return;
			}
			// Nothing is left to publish on an unmounted tree, but the caller
			// still learns the read failed.
			if (!isMountedRef.current) {
				throw err;
			}
			setMonthRead({
				monthKey: requestedMonth,
				firstMonthIndex,
				lastMonthIndex,
				status: 'error',
			});
			setMonthReadInFlight(null);
			setError(
				err instanceof Error ? err.message : "Failed to load calendar events",
			);
			throw err;
		}
	}, []);

	// Derived, not toggled in an effect: the moment the visible month changes,
	// the data belongs to the previous window, so the screen is loading until
	// the read for the new one lands. There is no render where old events can
	// pass for the new month.
	const visibleMonthKey = monthKey(visibleMonth);
	const isLoading =
		!isInitialized ||
		monthRead === null ||
		monthRead.monthKey !== visibleMonthKey ||
		monthReadInFlight === visibleMonthKey;

	const loadUpcoming = useCallback(async () => {
		const windowStart = startOfDay(new Date());
		const windowEnd = addDays(windowStart, UPCOMING_WINDOW_DAYS);
		const upcoming = await listEventsInRange(
			windowStart.toISOString(),
			windowEnd.toISOString(),
		);
		setUpcomingEvents(upcoming);
	}, []);

	useEffect(() => {
		let isActive = true;

		async function bootstrapCalendar() {
			try {
				await initCalendarDb();
				// Sample plans belong only to explicitly populated dev previews.
				if (!_useRemote && previewSeed) {
					await ensureCalendarSeedOnce();
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
	}, [previewSeed]);

	useEffect(() => {
		if (!isInitialized) {
			return;
		}

		// The request identity is the guard: a superseded completion is
		// dropped by readMonthWindow, and its failure is left to the read
		// that owns the window now.
		async function hydrateMonth() {
			await readMonthWindow(visibleMonth);
		}

		void hydrateMonth().catch(() => {});
	}, [isInitialized, readMonthWindow, visibleMonth]);

	// Load the upcoming window once for the countdown lane + agenda view.
	useEffect(() => {
		if (!isInitialized) {
			return;
		}

		// Hydrates upcoming events from the external repository after initialization.
		// eslint-disable-next-line react-hooks/set-state-in-effect
		void loadUpcoming().catch(() => {
			// The upcoming lanes are a quiet enhancement — never block on them.
		});
	}, [isInitialized, loadUpcoming]);

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
		// Deliberately the committed month, not this closure's: a save that
		// lands after the reader moved on must answer the month they are on.
		await readMonthWindow(visibleMonthRef.current);
	}, [readMonthWindow]);

	const reloadAfterMutation = useCallback(async () => {
		await Promise.all([reloadCurrentMonth(), loadUpcoming()]);
	}, [loadUpcoming, reloadCurrentMonth]);

	const addEvent = useCallback(
		async (input: CreateCalendarEventInput) => {
			const eventId = await insertEvent(input);
			// Quietly schedule local reminders; failures are swallowed inside.
			void rescheduleEventReminders({ ...input, id: eventId });
			await reloadAfterMutation();
		},
		[reloadAfterMutation, rescheduleEventReminders],
	);

	const updateEvent = useCallback(
		async (input: UpdateCalendarEventInput) => {
			await updateCalendarEvent(input);
			// Reschedule so changed times/offsets stay exact.
			void rescheduleEventReminders(input);
			await reloadAfterMutation();
		},
		[reloadAfterMutation, rescheduleEventReminders],
	);

	const deleteEvent = useCallback(
		async (eventId: string) => {
			await deleteCalendarEvent(eventId);
			void cancelEventReminders(eventId);
			await reloadAfterMutation();
		},
		[cancelEventReminders, reloadAfterMutation],
	);

	const eventsForDay = useMemo<Record<string, CalendarEvent[]>>(() => {
		const map: Record<string, CalendarEvent[]> = {};
		for (const event of events) {
			for (const dayKey of eventDayKeys(event)) {
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

	const monthReadState = useCallback(
		(month: Date): CalendarMonthReadState => {
			const target = monthIndex(month);
			const visibleIndex = monthIndex(visibleMonth);
			const inWindow = (index: number) =>
				index >= visibleIndex - 1 && index <= visibleIndex + 1;
			// A read in flight for the month on screen owns its window: even if
			// an earlier answer is still in state, it is about to be replaced.
			if (inWindow(target) && monthReadInFlight === visibleMonthKey) {
				return 'loading';
			}
			if (monthRead && monthRead.monthKey === visibleMonthKey) {
				if (
					monthRead.status === 'ready' &&
					target >= monthRead.firstMonthIndex &&
					target <= monthRead.lastMonthIndex
				) {
					return 'loaded';
				}
				return 'unread';
			}
			// The window a read will cover is known before its answer lands:
			// its pages are pending, never empty. Anything outside it has not
			// been asked for at all.
			return inWindow(target) ? 'loading' : 'unread';
		},
		[monthRead, monthReadInFlight, visibleMonth, visibleMonthKey],
	);

	const monthSummary = useMemo<CalendarMonthSummary>(() => {
		return events.reduce<CalendarMonthSummary>((summary, event) => {
			for (const dayKey of eventDayKeys(event)) {
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
			}

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

	// A partner-side change (a push) may leave the
	// local state stale — re-read the current month + upcoming window.
	const refresh = useCallback(async () => {
		await reloadAfterMutation();
	}, [reloadAfterMutation]);

	/**
	 * A range read for views outside the month window, the year view above all.
	 * It deliberately does not setEvents, so asking about a year cannot change
	 * what the calendar is showing.
	 */
	const eventsInRange = useCallback(
		async (from: Date, to: Date) =>
			listEventsInRange(from.toISOString(), to.toISOString()),
		[],
	);

	const value = useMemo<CalendarContextValue>(
		() => ({
			events,
			upcomingEvents,
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
			refresh,
			eventsForDay,
			monthReadState,
			getEventById,
			eventsInRange,
		}),
		[
			addEvent,
			deleteEvent,
			error,
			events,
			eventsForDay,
			eventsInRange,
			getEventById,
			isLoading,
			monthReadState,
			monthSummary,
			refresh,
			selectedDate,
			setSelectedDate,
			setVisibleMonth,
			updateEvent,
			upcomingEvents,
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
