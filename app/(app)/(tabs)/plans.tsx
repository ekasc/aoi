import { FrostedBackdrop } from '@/components/ui/frosted-backdrop';
import { Ionicons } from "@expo/vector-icons";
import { useIsFocused, useRouter } from "expo-router";
import {
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	AppState,
	Modal,
	Pressable,
	ScrollView,
	StyleSheet,
	View,
	useWindowDimensions,
	type NativeScrollEvent,
	type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
	addDays,
	addMonths,
	buildMonthGrid,
	formatDateTitle,
	formatMonthTitle,
	formatWeekdayShort,
	getAnniversaryMarkers,
	isSameDay,
	isSameMonth,
	startOfMonth,
	toDayKey,
} from "@/features/calendar/calendar-date-utils";
import { useCalendar } from "@/features/calendar/calendar-context";
import {
	getEventOwnership,
	ownershipForTone,
	type EventOwnershipTone,
} from "@/features/calendar/event-ownership";
import {
	monthCellWidth,
	monthStripsPerCell,
	monthStripTitlesFit,
} from "@/features/calendar/month-cell-layout";
import { useProposals } from "@/features/proposals/proposals-context";
import {
	MemorySky,
	headerSkyHeightForWindow,
	fabBottomOffset,
} from "@/components/home/memory-sky";
import { useMoments } from "@/features/moments/moments-context";
import type { Moment } from "@/features/moments/types";
import { ThemedText } from "@/components/themed-text";
import { MotiView } from "moti";
import { useReducedMotion } from "react-native-reanimated";
import { DayTimeline } from "@/components/calendar/day-timeline";
import { PlansAgenda } from "@/components/calendar/plans-agenda";
import { GlassSurface } from "@/components/ui/glass-surface";
import { AccentWash, Elevation, Radii, Spacing, Springs, shadow, withAlpha } from "@/constants/theme";
import { getDaysTogether } from "@/features/time-together/time-together";
import { useSpace } from "@/features/space/space-context";
import { useNowMinutes } from "@/hooks/use-now-minutes";
import { useThemeColor } from "@/hooks/use-theme-color";
import { haptics } from "@/features/haptics/haptics";
import { relationshipCopy } from "@/features/relationship/relationship-age";
import { useRelationshipAge } from "@/features/relationship/use-relationship-age";

function buildMonthWeeks(days: Date[]) {
	const weeks: Date[][] = [];

	for (let index = 0; index < days.length; index += 7) {
		weeks.push(days.slice(index, index + 7));
	}

	return weeks;
}

/**
 * A tap that releases a long-press must not act as a second gesture: the
 * platform reports both, so an unguarded cell would push the composer and
 * lift the sheet in the same touch. The suppression is per day and
 * time-boxed, so a real tap a moment later — or any tap on another day —
 * always goes through.
 */
export const LONG_PRESS_SUPPRESS_MS = 1500;

export function noteLongPress(log: Record<string, number>, dayKey: string, now: number): void {
	log[dayKey] = now;
}

export function takeTap(log: Record<string, number>, dayKey: string, now: number): boolean {
	const pressedAt = log[dayKey] ?? 0;
	delete log[dayKey];
	return now - pressedAt > LONG_PRESS_SUPPRESS_MS;
}

/** The add control, the same size the Memories tab uses. */
const FAB_SIZE = 56;

/**
 * Between the month's columns. Narrow enough that seven columns still clear a
 * 44pt tap target on a 320pt screen, and the weekday row takes the same gap so
 * its labels stay over their own columns.
 */
const GRID_COLUMN_GAP = 2;

/**
 * How many pages either side of the anchor stay mounted. The scroll is
 * unbounded in principle (see handlePagerSettled), but only these pages are
 * ever rendered: a wider window buys nothing a reader can see and costs a
 * mounted grid per page, which measured in the thousands of live cells.
 */
const PAGER_WINDOW_RADIUS = 3;

const PAGER_WINDOW_SIZE = PAGER_WINDOW_RADIUS * 2 + 1;

/**
 * Rows in every month page, including the filler rows a short month leaves.
 * Fixed so a page and a screenful stay the same thing, and so a cell's share
 * of the page height is known: see `monthStripsPerCell`.
 */
const MONTH_ROWS = 6;
// Fixed six rows per page; each row fits the tallest cell (day number +
// dot row + today underline + padding/gaps, >= styles.dayCell.minHeight)
// so the pager height is deterministic and never measured from itself.

export type Strip = {
	title: string;
	/** Whose plan it is, so a cell can say it in words as well as in tint. */
	tone: EventOwnershipTone;
};

/** "2 plans: 1 yours, 1 from your partner", the words behind the tints. */
function describeDayOwnership(strips: Strip[]): string {
	const counts = strips.reduce<Record<EventOwnershipTone, number>>(
		(tally, strip) => {
			tally[strip.tone] += 1;
			return tally;
		},
		{ you: 0, partner: 0, together: 0 },
	);

	const parts: string[] = [];
	if (counts.you > 0) {
		parts.push(`${counts.you} yours`);
	}
	if (counts.partner > 0) {
		parts.push(`${counts.partner} from your partner`);
	}
	if (counts.together > 0) {
		parts.push(`${counts.together} together`);
	}
	return parts.join(', ');
}

type DayMark = {
	hasItems: boolean;
	anniversary: boolean;
};

type MonthGridColors = {
	/** Accents as fills: the strip background and the selected day. */
	accent: string;
	partner: string;
	/** Accent as a mark: the today ring, which has to read at a hairline. */
	accentInk: string;
	text: string;
	muted: string;
	onAccent: string;
};

type MonthGridProps = {
	month: Date;
	selectedDate: Date;
	now: Date;
	marks: Record<string, DayMark>;
	/** The day's events, in order, with the person they belong to. */
	stripsByDay?: Record<string, Strip[]>;
	colors: MonthGridColors;
	/**
	 * How many strips a cell may draw. The grid is six fixed rows inside the
	 * space the screen gives it, so at larger text sizes a cell can afford
	 * fewer before it would reach into the week below; the rest is counted.
	 */
	maxStrips: number;
	/** One column's width, so a strip knows whether a title fits in it. */
	cellWidth: number;
	/** The reader's text scale, which the title test also depends on. */
	fontScale: number;
	onSelectDate: (date: Date) => void;
	/** Long press creates on the day under the finger. */
	onCreateOnDate: (date: Date) => void;
};

/**
 * A quiet month view: day number, subtle dots for marked dates, a clear
 * selected day, and a today underline that never competes with selection.
 * No event titles inside cells, the inline agenda below owns the details.
 */
const MonthGrid = memo(function MonthGrid({
	month,
	selectedDate,
	now,
	marks,
	stripsByDay,
	colors,
	maxStrips,
	cellWidth,
	fontScale,
	onSelectDate,
	onCreateOnDate,
}: MonthGridProps) {
	// Titles are the only thing strips print, so one test decides for the
	// whole grid instead of one per dot count.
	const titlesFit = monthStripTitlesFit(cellWidth, fontScale, 0);
	const monthGrid = useMemo(() => buildMonthGrid(month), [month]);
	const monthWeeks = useMemo(() => {
		const weeks = buildMonthWeeks(monthGrid);
		// Constant six rows per page so the pager never changes height
		// between months, the layout stays put while swiping.
		while (weeks.length < MONTH_ROWS) {
			weeks.push([]);
		}
		return weeks;
	}, [monthGrid]);

	return (
		<View style={styles.grid}>
			{monthWeeks.map((week, index) =>
				week.length === 0 ? (
					<View key={`empty-${index}`} style={styles.emptyWeekRow} />
				) : (
					<View key={toDayKey(week[0])} style={styles.weekRow}>
						{week.map((day) => {
							const dayKey = toDayKey(day);
							const mark = marks[dayKey];
							const isSelected = isSameDay(day, selectedDate);
							const isCurrentMonth = isSameMonth(day, month);
							const isToday = isSameDay(day, now);
							// Today and the selection are different states: the
							// selection is filled, today is only ringed, so the
							// grid never claims two days are the chosen one.
							const isTodayOnly = isToday && isCurrentMonth && !isSelected;
							const dayStrips = stripsByDay?.[dayKey] ?? [];
							const ownership = describeDayOwnership(dayStrips);
							const dayTextColor = isSelected
								? colors.onAccent
								: isCurrentMonth
									? colors.text
									: colors.muted;

							return (
								<Pressable
									accessibilityHint="Long press to add a plan"
									accessibilityLabel={[
										formatDateTitle(day),
										dayStrips.length > 0
											? `${dayStrips.length} ${dayStrips.length === 1 ? 'plan' : 'plans'}: ${ownership}`
											: mark?.hasItems
												? 'has plans'
												: null,
										mark?.anniversary ? 'anniversary' : null,
									]
										.filter(Boolean)
										.join(', ')}
									accessibilityRole="button"
									accessibilityState={{ selected: isSelected }}
									key={dayKey}
									onLongPress={() => onCreateOnDate(day)}
									onPress={() => onSelectDate(day)}
									style={({ pressed }) => [
										styles.dayCell,
										{ opacity: isCurrentMonth ? 1 : 0.35 },
										pressed ? styles.pressed : undefined,
									]}
								>
									<View
										style={[
											styles.dayNumber,
											isSelected ? { backgroundColor: colors.accent } : undefined,
											isTodayOnly
												? {
														borderColor: colors.accentInk,
														borderWidth: 1.5,
													}
												: undefined,
										]}
									>
										<ThemedText
											style={{
												color: isSelected
													? colors.onAccent
													: isTodayOnly
														? colors.accentInk
														: dayTextColor,
												fontSize: 19,
												fontWeight: isSelected ? "600" : "400",
											}}
										>
											{day.getDate()}
										</ThemedText>
									</View>
									{/* Apple's month view puts the event titles in the
									    cell, not a dot: two lines of tiny text say what
									    the day holds, a dot only says something is there. */}
									<View style={styles.stripRow}>
										{dayStrips.slice(0, maxStrips).map((strip, index) => {
											const fill = ownershipForTone(strip.tone, {
												ownColor: colors.accent,
												partnerColor: colors.partner,
											});
											// Whose plan it is reads off the fill alone: one signal
											// per strip, not a tint plus dots.
											return (
												<View
													key={`${dayKey}:${index}`}
													style={[
														styles.strip,
														{ backgroundColor: withAlpha(fill.color, AccentWash) },
													]}
												>
													{titlesFit ? (
														<ThemedText
															numberOfLines={1}
															type="caption"
															style={[styles.stripText, { color: colors.text }]}
														>
															{strip.title}
														</ThemedText>
													) : null}
												</View>
											);
										})}
										{dayStrips.length > maxStrips ? (
											<ThemedText
												type="caption"
												style={[styles.stripMore, { color: colors.muted }]}
											>
												{`+${dayStrips.length - maxStrips} more`}
											</ThemedText>
										) : null}
										{/* A day marked only by suggestions or goals has no strip to
										    draw, so it gets the same dot an anniversary does: the
										    label already says "has plans", and now the grid shows
										    it too. */}
										{mark?.hasItems &&
										dayStrips.length === 0 &&
										!mark.anniversary ? (
											<View
												style={[
													styles.dot,
													{ backgroundColor: colors.accentInk },
												]}
											/>
										) : null}
										{mark?.anniversary ? (
											<View
												accessibilityLabel="Anniversary"
												style={[
													styles.dot,
													{ backgroundColor: colors.accent },
												]}
											/>
										) : null}
									</View>
								</Pressable>
							);
						})}
					</View>
				),
			)}
		</View>
	);
});

/** "Wednesday \u2013 Sep 16, 2026", the way a day header reads. */
function formatDayHeading(date: Date): string {
	const weekday = date.toLocaleDateString('en-US', { weekday: 'long' });
	const rest = date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
	return `${weekday} \u2013 ${rest}`;
}


export default function PlansScreen() {
	const router = useRouter();
	const isFocused = useIsFocused();
	const insets = useSafeAreaInsets();
	const reduceMotion = useReducedMotion();
	const fabBottom = useMemo(
		() => fabBottomOffset(insets.bottom, process.env.EXPO_OS === "ios"),
		[insets.bottom],
	);
	const {
		width: windowWidth,
		height: windowHeight,
		fontScale,
	} = useWindowDimensions();

	const {
		selectedDate,
		visibleMonth,
		eventsForDay,
		setVisibleMonth,
		refresh: refreshCalendar,
		isLoading: calendarLoading,
		error: calendarError,
	} = useCalendar();
	const [listHeight, setListHeight] = useState(0);
	// The month grid is the landing: the first question this screen answers is
	// "when are we free", and a day is a step into one of its cells.
	const [viewMode, setViewMode] = useState<'month' | 'agenda'>('month');
	// The context's visible month is the month on screen: one source of truth
	// for the header, the loaded window and the pager's anchor. A month set from
	// outside this screen (the year view) is therefore the month it shows.
	const currentMonth = visibleMonth;
	const hasPlansThisMonth = useMemo(() => {
		const monthKey = toDayKey(currentMonth).slice(0, 7);
		return Object.entries(eventsForDay).some(([day, events]) =>
			day.startsWith(monthKey) && events.length > 0,
		);
	}, [currentMonth, eventsForDay]);
	// The window's anchor only moves when the visible month escapes it: a
	// year jump, or a swipe reaching its edge. Rebuilding around every
	// settled month paints the wrong month for a frame — the native offset
	// still sits where the finger stopped while the new window lays out
	// underneath it — then snaps back when the correction scroll lands.
	// Holding the window still for ordinary swipes removes that flash the
	// same way the day pager removes its own.
	const [monthAnchor, setMonthAnchor] = useState(() => visibleMonth);
	const pagerMonths = useMemo(
		() =>
			Array.from({ length: PAGER_WINDOW_SIZE }, (_, index) =>
				addMonths(monthAnchor, index - PAGER_WINDOW_RADIUS),
			),
		[monthAnchor],
	);
	const { proposals } = useProposals();
	const { moments, loadGoals } = useMoments();
	const { space } = useSpace();
	const [goals, setGoals] = useState<Moment[] | null>(null);
	const textColor = useThemeColor({}, "text");
	const muted = useThemeColor({}, "muted");
	const border = useThemeColor({}, "border");
	const accent = useThemeColor({}, "accent");
	const accentInk = useThemeColor({}, "accentInk");
	const onAccent = useThemeColor({}, "onAccent");
	const background = useThemeColor({}, "background");
	const shadowColor = useThemeColor({}, "shadow");
	const partnerAccent = useThemeColor({}, "partnerAccent");
	const gridColors = useMemo(
		() => ({
			text: textColor,
			muted,
			accent,
			partner: partnerAccent,
			accentInk,
			onAccent,
		}),
		[textColor, muted, accent, partnerAccent, accentInk, onAccent],
	);
	const ownershipPalette = useMemo(
		() => ({ ownColor: accent, partnerColor: partnerAccent }),
		[accent, partnerAccent],
	);

	const monthTitle = useMemo(
		() => formatMonthTitle(currentMonth),
		[currentMonth],
	);

	// The sheet owns the day, not a mode: tapping a grid cell lifts the day
	// over the month, and dismissing it leaves the month exactly where it
	// was. The context's selected day is only the fallback the composer and
	// the grid highlight use when no sheet is open.
	const [sheetDate, setSheetDate] = useState<Date | null>(null);
	// The pager window's anchor: it moves only when a swipe nears the edge
	// (or the sheet opens), never on every settle, which is what keeps
	// swipes from flashing the wrong day.
	const [dayAnchor, setDayAnchor] = useState<Date | null>(null);
	const composerDate = sheetDate ?? selectedDate;
	const weekdayLabels = useMemo(
		() =>
			buildMonthGrid(currentMonth)
				.slice(0, 7)
				.map((day) => formatWeekdayShort(day).toUpperCase().slice(0, 1)),
		[currentMonth],
	);
	const [now, setNow] = useState(() => new Date());
	const relationshipAge = useRelationshipAge(space?.relationshipStartDate);
	const adaptiveCopy = useMemo(
		() => relationshipCopy(relationshipAge.tone),
		[relationshipAge.tone],
	);
	// The sheet pager spans the anchor's window, so the ticker runs whenever
	// today is one of its pages and idles otherwise, including whenever no
	// sheet is open.
	const todayInDayWindow = useMemo(
		() =>
			dayAnchor !== null &&
			[-3, -2, -1, 0, 1, 2, 3].some((offset) =>
				isSameDay(addDays(dayAnchor, offset), now),
			),
		[dayAnchor, now],
	);
	// The day view draws where "now" is; the ticker only runs on today.
	const nowMinutes = useNowMinutes(todayInDayWindow);
	// Which layer is live. The sheet is not a layer: it floats over whichever
	// one is showing and never unmounts it.
	const agendaOpen = viewMode === 'agenda';

	const daysTogether = useMemo(
		() => getDaysTogether(space?.relationshipStartDate, now),
		[space?.relationshipStartDate, now],
	);

	// Recompute "now" whenever the app returns to focus so countdown and
	// agenda labels never stay frozen across midnight.
	useEffect(() => {
		const subscription = AppState.addEventListener(
			"change",
			(nextAppState) => {
				if (nextAppState === "active") {
					setNow(new Date());
				}
			},
		);
		return () => subscription.remove();
	}, []);

	const anniversaryMarkersByDay = useMemo(() => {
		const map: Record<string, boolean> = {};
		for (const marker of getAnniversaryMarkers(
			space?.relationshipStartDate,
			currentMonth,
		)) {
			map[toDayKey(marker.date)] = true;
		}
		return map;
	}, [space?.relationshipStartDate, currentMonth]);
	// Future goals live here, not in Story: one bounded type-filtered read
	// on mount (plus refresh on focus), independent of Story pagination.
	useEffect(() => {
		let cancelled = false;
		void loadGoals().then(
			(loaded) => {
				if (!cancelled) {
					setGoals(loaded);
				}
			},
			() => {
				if (!cancelled) {
					setGoals([]);
				}
			},
		);
		return () => {
			cancelled = true;
		};
	}, [loadGoals]);
	useEffect(() => {
		if (!goals) {
			return;
		}
		const subscription = AppState.addEventListener("change", (nextAppState) => {
			if (nextAppState === "active") {
				void loadGoals().then(
					(loaded) => setGoals(loaded),
					() => {},
				);
			}
		});
		return () => subscription.remove();
	}, [goals, loadGoals]);

	const pendingProposals = useMemo(
		() => proposals.filter((proposal) => proposal.status === "pending"),
		[proposals],
	);
	// A day whose only plans are still suggestions or goals has no events to
	// draw, but it is not free: the grid marks it, so the day view has to offer
	// the list where they can be answered instead of calling the day empty.
	// Each pager page asks for its own day: the centre page is the selection,
	// its neighbours are already mounted for the swipe.
	const dayHasSuggestions = useCallback(
		(date: Date) => {
			const dayKey = toDayKey(date);
			const hasProposal = pendingProposals.some(
				(proposal) => toDayKey(new Date(proposal.proposedStart)) === dayKey,
			);
			const hasGoal = (goals ?? []).some(
				(goal) => goal.targetAt && toDayKey(new Date(goal.targetAt)) === dayKey,
			);
			return hasProposal || hasGoal;
		},
		[pendingProposals, goals],
	);
	// Suggestions are only ever answerable when they are the partner's and
	// still pending, yours wait for them, quietly.
	// Dots for every date carrying plans: events, pending proposals, and
	// dated future goals, plus the anniversary mark.
	// What each day holds, for the strips inside the month grid.
	const stripsByDay = useMemo(() => {
		const strips: Record<string, Strip[]> = {};
		for (const key of Object.keys(eventsForDay)) {
			const day = eventsForDay[key]
				.slice()
				.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
				.map((event) => ({
					title: event.title,
					tone: getEventOwnership(event, ownershipPalette).tone,
				}));
			if (day.length > 0) {
				strips[key] = day;
			}
		}
		return strips;
	}, [eventsForDay, ownershipPalette]);

	const marksByDay = useMemo(() => {
		const marks: Record<string, DayMark> = {};
		const touch = (key: string) => {
			marks[key] ??= { hasItems: false, anniversary: false };
			marks[key].hasItems = true;
		};
		for (const key of Object.keys(eventsForDay)) {
			if (eventsForDay[key].length > 0) {
				touch(key);
			}
		}
		for (const proposal of pendingProposals) {
			touch(toDayKey(new Date(proposal.proposedStart)));
		}
		for (const goal of goals ?? []) {
			if (goal.targetAt) {
				touch(toDayKey(new Date(goal.targetAt)));
			}
		}
		for (const key of Object.keys(anniversaryMarkersByDay)) {
			marks[key] ??= { hasItems: false, anniversary: false };
			marks[key].anniversary = true;
		}
		return marks;
	}, [eventsForDay, pendingProposals, goals, anniversaryMarkersByDay]);

	// A grid cell lifts its day over the month: the month underneath never
	// moves, so dismissing the sheet returns to exactly where it was.
	const handleSelectDate = useCallback(
		(date: Date) => {
			// The release after a long-press also reports a tap: swallow it,
			// or the same gesture pushes the composer and lifts the sheet at
			// once, which wedges the UI.
			if (!takeTap(longPressLog.current, toDayKey(date), Date.now())) {
				return;
			}
			if (!sheetDate || !isSameDay(date, sheetDate)) {
				haptics.select();
			}
			setSheetDate(date);
			// Opening centres the window on the day, so the swipe has room
			// either way from the first gesture.
			setDayAnchor(date);
		},
		[sheetDate],
	);
	const handleCloseSheet = useCallback(() => {
		setSheetDate(null);
	}, []);
	// The agenda reads the same upcoming plans the grid marks, listed rather
	// than placed in time. Opening it from the sheet closes the sheet first,
	// so the two never stack.
	const handleToggleAgenda = useCallback(() => {
		setSheetDate(null);
		setViewMode(viewMode === 'agenda' ? 'month' : 'agenda');
	}, [viewMode]);
	/** Back to today, from whatever day the sheet is showing. */
	const handleGoToday = useCallback(() => {
		handleSelectDate(new Date());
	}, [handleSelectDate]);
	const handleRetry = useCallback(() => {
		void refreshCalendar();
	}, [refreshCalendar]);


	const handleAddEvent = useCallback(() => {
		router.push({
			pathname: "/(app)/calendar/new-event",
			params: { date: composerDate.toISOString() },
		});
	}, [router, composerDate]);

	/** Adds to the page's day at the tapped hour. */
	const handleCreateAtHour = useCallback(
		(date: Date, hour: number) => {
			router.push({
				pathname: "/(app)/calendar/new-event",
				params: { date: toDayKey(date), hour: String(hour) },
			});
		},
		[router],
	);

	const handleCreateOnDate = useCallback(
		(date: Date) => {
			noteLongPress(longPressLog.current, toDayKey(date), Date.now());
			router.push({
				pathname: "/(app)/calendar/new-event",
				params: { date: toDayKey(date) },
			});
		},
		[router],
	);

	const handleOpenEvent = useCallback(
		(eventId: string) => {
			router.push(`/(app)/calendar/edit/${eventId}`);
		},
		[router],
	);
	// ── Month pager ────────────────────────────────────────────────────────
	// A sliding window of rendered month pages around the selected month:
	// navigation moves the logical month indefinitely (plain Date math, no
	// accumulated list), while only PAGER_WINDOW_SIZE pages stay
	// materialized. Swiping settles on a page, the window recenters
	// silently, and swiping again keeps going, there is no five-year wall
	// in either direction.
	// Calendar card fits a 320pt viewport: full window width minus the
	// screen gutters (24 each side) minus the card padding (12 each side).
	// Pager pages exactly this width so swiping stays aligned.
	const PAGE_WIDTH = windowWidth;
	const pagerRef = useRef<ScrollView | null>(null);
	// Where a settle stopped inside the page it landed on, held for the
	// re-centre that follows. The pager is a free scroll, so a page boundary is
	// not where the finger stopped; the offset is the reader's, not ours.
	const recenterFraction = useRef(0);

	// One month of the vertical stack: the month name, then its grid, filling
	// the space the list actually has. The list reports that space, so there
	// is no safe area, no tab bar clearance and no row heights to add up.
	// The page IS the viewport. A page taller or shorter than the step makes the
	// pager land mid month, and the error compounds over the pages between the
	// anchor and today: that is what left the tail of one month sitting above the
	// next month's heading. One number, measured, for both.
	const MONTH_PAGE_HEIGHT = listHeight;
	// A cell is a fixed fraction of that page: text that scales up makes each
	// strip taller without making the row taller, so how many fit is computed
	// from the room the row actually has rather than assumed.
	const stripsPerCell = monthStripsPerCell(
		fontScale,
		MONTH_PAGE_HEIGHT > 0 ? MONTH_PAGE_HEIGHT / MONTH_ROWS : 0,
	);
	// And how wide a column is: a title is only printed where it can be read.
	const monthColumnWidth = monthCellWidth(windowWidth, GRID_COLUMN_GAP);

	// The anchor follows the visible month only once it escapes the window: a
	// year jump pulls it along, while ordinary swipes leave the delivered
	// months exactly where they are. Adjusted during render, not in an
	// effect, so the window is already correct on the commit — never a frame
	// of stale months first.
	const monthDrift =
		(visibleMonth.getFullYear() - monthAnchor.getFullYear()) * 12 +
		(visibleMonth.getMonth() - monthAnchor.getMonth());
	if (Math.abs(monthDrift) > PAGER_WINDOW_RADIUS - 1) {
		setMonthAnchor(startOfMonth(visibleMonth));
	}

	// An anchor change puts the list back on its centre page. This runs on
	// the anchor changing, never on a scroll or an ordinary swipe, so it
	// cannot loop. The fraction the settle carried is kept, so re-centring
	// slides the window under the reader instead of snapping a mid-month
	// offset back to the top of the month.
	useEffect(() => {
		const fraction = recenterFraction.current;
		recenterFraction.current = 0;
		pagerRef.current?.scrollTo({
			animated: false,
			y: MONTH_PAGE_HEIGHT * (PAGER_WINDOW_RADIUS + fraction),
		});
	}, [MONTH_PAGE_HEIGHT, monthAnchor]);

	/**
	 * The month list has no end. The delivered window is bounded, so a settled
	 * page becomes the month on screen: the header and the loaded window move to
	 * it and the pager recentres on it, which leaves fresh months either side
	 * for the next swipe. Changing the month here, where the scroll stops, is
	 * what keeps the header, the data and the page from drifting apart.
	 */
	const handlePagerSettled = useCallback(
		(event: NativeSyntheticEvent<NativeScrollEvent>) => {
			if (MONTH_PAGE_HEIGHT <= 0) {
				return;
			}
			const page = event.nativeEvent.contentOffset.y / MONTH_PAGE_HEIGHT;
			const index = Math.round(page);
			const month = pagerMonths[Math.max(0, Math.min(pagerMonths.length - 1, index))];
			if (month && !isSameMonth(month, currentMonth)) {
				// Only an edge settle rebuilds the window, so only it carries
				// a fraction: when it does, the window shifts by exactly
				// (centre - index) pages, and the same fraction in the
				// corrected offset leaves the stopped page visually still.
				// Any other settle keeps the delivered months in place, so a
				// stale fraction must never leak into a later scroll.
				recenterFraction.current =
					index === 0 || index === PAGER_WINDOW_SIZE - 1 ? page - index : 0;
				setVisibleMonth(month);
			}
		},
		[MONTH_PAGE_HEIGHT, currentMonth, pagerMonths, setVisibleMonth],
	);
	// ── Day pager ──────────────────────────────────────────────────────────
	// Three days either side of an anchor: a swipe settles on a day the way
	// the month pager settles on a month. The anchor only moves when a swipe
	// nears the window's edge. Rebuilding around every settled day would
	// paint the wrong day for a frame — the native offset still sits where
	// the finger stopped while the new window lays out underneath it — and
	// then visibly snap back when the correction scroll lands. That flash is
	// the whole flicker. Most swipes therefore change no window state at
	// all: the scroll itself is the animation, driven natively.
	// Long-presses that opened the composer, keyed by day, so the release tap
	// that follows them can be told apart from a real tap.
	const longPressLog = useRef<Record<string, number>>({});
	const dayPagerRef = useRef<ScrollView | null>(null);
	const dayRecenterFraction = useRef(0);
	const DAY_WINDOW_RADIUS = 3;
	const DAY_WINDOW_SIZE = DAY_WINDOW_RADIUS * 2 + 1;
	const [dayListHeight, setDayListHeight] = useState(0);
	const DAY_PAGE_HEIGHT = dayListHeight;
	const pagerDays = useMemo(
		() =>
			dayAnchor
				? Array.from({ length: DAY_WINDOW_SIZE }, (_, index) =>
						addDays(dayAnchor, index - DAY_WINDOW_RADIUS),
					)
				: [],
		[DAY_WINDOW_RADIUS, DAY_WINDOW_SIZE, dayAnchor],
	);

	// A new anchor puts the pager back on its centre page: opening the sheet,
	// jumping to today, or a swipe reaching the window's edge. This runs on
	// the anchor changing, never on a scroll, so it cannot loop; the settle
	// fraction is kept, the same way the month pager keeps its own. Settles
	// inside the window deliberately skip it: moving the offset there is what
	// flashes the wrong day.
	useEffect(() => {
		if (!dayAnchor) {
			return;
		}
		const fraction = dayRecenterFraction.current;
		dayRecenterFraction.current = 0;
		dayPagerRef.current?.scrollTo({
			animated: false,
			x: PAGE_WIDTH * (DAY_WINDOW_RADIUS + fraction),
		});
	}, [DAY_PAGE_HEIGHT, PAGE_WIDTH, dayAnchor]);

	/**
	 * The day list has no end. The delivered window is bounded, so the
	 * settled page becomes the sheet's day on every swipe, while the window
	 * itself only recentres at its edges: rebuilding anywhere else would
	 * flash the wrong day before the correction scroll lands.
	 */
	const handleDayPagerSettled = useCallback(
		(event: NativeSyntheticEvent<NativeScrollEvent>) => {
			if (DAY_PAGE_HEIGHT <= 0 || !dayAnchor) {
				return;
			}
			const page = event.nativeEvent.contentOffset.x / PAGE_WIDTH;
			const index = Math.max(0, Math.min(DAY_WINDOW_SIZE - 1, Math.round(page)));
			const date = addDays(dayAnchor, index - DAY_WINDOW_RADIUS);
			if (!sheetDate || !isSameDay(date, sheetDate)) {
				haptics.select();
				setSheetDate(date);
			}
			if (index === 0 || index === DAY_WINDOW_SIZE - 1) {
				// The rebuilt window shifts by exactly (radius - index)
				// pages, so carrying the fraction leaves the stopped day
				// visually still.
				dayRecenterFraction.current = page - index;
				setDayAnchor(date);
			}
		},
		[DAY_PAGE_HEIGHT, DAY_WINDOW_RADIUS, DAY_WINDOW_SIZE, PAGE_WIDTH, dayAnchor, sheetDate],
	);

	// The pill carries the month now, so the header no longer reads the
	// background luminance to pick a title tone.


	// The band plus the title row. The block clips what it holds, so a height
	// that only counted the sky pushed the header out of view.
	// The chrome is written for text over the sky, but the sky's lower edge is
	// pale in light mode: pick the tone from the background so the title reads.
	const rootStyle = useMemo(
		() => [
			styles.root,
			{ backgroundColor: background },
		],
		[background],
	);
	// A sky band, not a sliver: the band is as tall as the sky draws, and the
	// calendar chrome sits along its lower edge with the sky visible above it.
	const headerBlockStyle = useMemo(
		() => [
			styles.headerBlock,
			{
				minHeight: headerSkyHeightForWindow(windowHeight) + Spacing[8],
				paddingTop: insets.top + Spacing[8],
			},
		],
		[insets.top, windowHeight],
	);

	const dayBody = (
		<>
			{/* The pager box measures the space the day actually gets, so every
			    page is exactly a screenful: a page taller or shorter than the
			    step is what makes a pager land between days. Each page mounts
			    its own timeline at its own initial hour, so a new day opens
			    scrolled to its own first plan rather than staying where the
			    last one was. */}
			<View
				onLayout={(event) => {
					const height = Math.round(event.nativeEvent.layout.height);
					setDayListHeight((current) => (current === height ? current : height));
				}}
				style={styles.dayPagerBox}
			>
			{DAY_PAGE_HEIGHT > 0 ? (
			<ScrollView
				ref={dayPagerRef}
				testID="day-pager"
				contentOffset={{ x: PAGE_WIDTH * DAY_WINDOW_RADIUS, y: 0 }}
				directionalLockEnabled
				horizontal
				nestedScrollEnabled
				onMomentumScrollEnd={handleDayPagerSettled}
				pagingEnabled
				showsHorizontalScrollIndicator={false}
				style={[styles.dayPager, { height: DAY_PAGE_HEIGHT }]}
			>
				{pagerDays.map((pageDate, pageIndex) => {
					const pageKey = toDayKey(pageDate);
					const pageEvents = eventsForDay[pageKey] ?? [];
					const pageIsToday = isSameDay(pageDate, now);
					const pageHasSuggestions = dayHasSuggestions(pageDate);
					return (
						<View
							accessibilityElementsHidden={pageIndex !== 1}
							accessibilityLabel={`Day page ${formatDayHeading(pageDate)}`}
							aria-hidden={pageIndex !== 1}
							importantForAccessibility={
								pageIndex === 1 ? 'auto' : 'no-hide-descendants'
							}
							key={pageKey}
							style={{
								width: PAGE_WIDTH,
								height: DAY_PAGE_HEIGHT,
							}}
						>
							<View style={[styles.dayHeading, { borderBottomColor: border }]}>
								{/* The date is the one thing that says which day this is, so
								    it gets the row: no week-number stamp taking width off it,
								    and two lines allowed so a longer date wraps instead of
								    truncating at 320pt or at a larger text size. */}
								<ThemedText numberOfLines={2} type="subheading" style={styles.dayHeadingText}>
									{formatDayHeading(pageDate)}
								</ThemedText>
							{/* A swipe-happy thumb gets back to today without paging the
							    strip by hand. The spacer keeps the row height steady when
							    today is already on screen. */}
							{pageIsToday ? (
								<View style={styles.dayHeadingAction} />
							) : (
								<Pressable
									accessibilityHint="Shows today's plans"
									accessibilityLabel="Back to today"
									accessibilityRole="button"
									onPress={handleGoToday}
									style={({ pressed }) => [
										styles.dayHeadingAction,
										styles.todayTap,
										pressed ? styles.pressed : undefined,
									]}
								>
									<ThemedText type="caption" style={{ color: accentInk }}>
										Today
									</ThemedText>
								</Pressable>
							)}
						</View>
						{/* A free day and a day that hasn't loaded must not look the
						    same: say which one this is. Under an error the notice
						    above already spoke, so this stays quiet. */}
						{!calendarError &&
						pageEvents.length === 0 ? (
							<ThemedText
								accessibilityLiveRegion="polite"
								type="caption"
								style={[styles.dayStatus, { color: muted }]}
							>
								{calendarLoading
									? 'Loading plans…'
									: pageHasSuggestions
										? 'No confirmed plans for this day.'
									: pageIsToday
										? `No plans for today. ${adaptiveCopy.planEmpty}`
										: 'No plans for this day.'}
							</ThemedText>
						) : null}
						{pageHasSuggestions ? (
							<Pressable
								accessibilityHint="Shows suggestions and goals as a list"
								accessibilityLabel="View suggestions and goals"
								accessibilityRole="button"
								onPress={handleToggleAgenda}
								style={({ pressed }) => [
									styles.daySuggestions,
									{ borderColor: border },
									pressed ? styles.pressed : undefined,
								]}
							>
								<ThemedText type="caption" style={{ color: accentInk }}>
									View suggestions and goals
								</ThemedText>
							</Pressable>
						) : null}
						<DayTimeline
							events={pageEvents}
							nowMinutes={pageIsToday ? nowMinutes : undefined}
							onCreateAtHour={(hour) => handleCreateAtHour(pageDate, hour)}
							onOpenEvent={handleOpenEvent}
							ownColor={accent}
							partnerColor={partnerAccent}
						/>
						</View>
					);
				})}
			</ScrollView>
			) : null}
			</View>
		</>
	);
	const monthBody = (
		<>
			{!calendarError && (calendarLoading || !hasPlansThisMonth) ? (
				<ThemedText accessibilityLiveRegion="polite" type="caption" style={[styles.monthStatus, { color: muted }]}>
					{calendarLoading ? 'Loading plans…' : 'No confirmed plans this month.'}
				</ThemedText>
			) : null}
			{/* The weekday row belongs to the grid, not to the padded header, so its
			    columns line up with the date columns instead of being inset. */}
			<View style={[styles.weekdayRow, { borderBottomColor: border }]}>
				{weekdayLabels.map((label, index) => (
					<View key={`${label}:${index}`} style={styles.weekdayCell}>
						<ThemedText type="meta" style={{ color: textColor }}>
							{label}
						</ThemedText>
					</View>
				))}
			</View>
			{/* The pager box measures the space the grid actually gets, so the page
			    height accounts for the weekday row without arithmetic. */}
			<View
				onLayout={(event) => setListHeight(Math.round(event.nativeEvent.layout.height))}
				style={styles.pagerBox}
			>
			{MONTH_PAGE_HEIGHT > 0 ? (
			<ScrollView
				ref={pagerRef}
				testID="month-pager"
				contentContainerStyle={{
					paddingBottom: fabBottom + Spacing[8],
				}}
				contentOffset={{ x: 0, y: MONTH_PAGE_HEIGHT * PAGER_WINDOW_RADIUS }}
				onMomentumScrollEnd={handlePagerSettled}
				showsVerticalScrollIndicator={false}
				style={[styles.pager, { height: MONTH_PAGE_HEIGHT }]}
			>
				{pagerMonths.map((month) => (
					<View
						accessibilityLabel={`Month page ${formatMonthTitle(month)}`}
						key={toDayKey(month)}
						style={{
							width: PAGE_WIDTH,
							height: MONTH_PAGE_HEIGHT,
						}}
					>
						{/* The month name belongs to the month, so it scrolls with
						    it, the way Apple's month view reads. */}
						<ThemedText type="subheading" style={styles.monthHeading}>
							{formatMonthTitle(month)}
						</ThemedText>
						<MonthGrid
							cellWidth={monthColumnWidth}
							colors={gridColors}
							fontScale={fontScale}
							marks={marksByDay}
							maxStrips={stripsPerCell}
							stripsByDay={stripsByDay}
							month={month}
							now={now}
							onCreateOnDate={handleCreateOnDate}
							onSelectDate={handleSelectDate}
							selectedDate={sheetDate ?? selectedDate}
						/>
					</View>
				))}
			</ScrollView>
			) : null}
			</View>
		</>
	);
	// The agenda owns its scroll: it is a list, so the FAB floats over its
	// tail and the last row clears the space the FAB sits above.
	const agendaBody = (
		<ScrollView
			contentContainerStyle={{ paddingBottom: fabBottom + Spacing[8] }}
			showsVerticalScrollIndicator={false}
			style={styles.agendaScroll}
			testID="agenda-scroll"
		>
			<PlansAgenda now={now} />
		</ScrollView>
	);
	return (
		<View style={rootStyle}>
      <FrostedBackdrop />
			<View style={headerBlockStyle}>
				<MemorySky compact moments={moments ?? []} daysTogether={daysTogether} startDate={space?.relationshipStartDate ?? null} focused={isFocused} />
				<View style={styles.pillRow}>
					{/* Month first, then the view control against the right edge,
					    where a thumb reaches for it. */}
					<GlassSurface style={styles.pill}>
						<Pressable
							accessibilityHint="Shows every month of the year"
							accessibilityLabel="Open the year view"
							accessibilityRole="button"
							onPress={() => router.push('/(app)/calendar/year')}
							style={styles.pillTap}
						>
							<ThemedText type="bodyEmphasis">{monthTitle}</ThemedText>
							<Ionicons color={textColor} name="chevron-down" size={16} />
						</Pressable>
					</GlassSurface>
					<View style={styles.pillActions}>
					{/* One control, two meanings: it opens the agenda from either
					    calendar mode, and once the agenda is the screen it is the
					    Calendar button that puts the month back. */}
					<GlassSurface style={styles.pill}>
						<Pressable
							accessibilityHint={
								agendaOpen
									? 'Shows the month grid'
									: 'Shows upcoming plans as a list'
							}
							accessibilityLabel={agendaOpen ? 'Calendar' : 'Agenda'}
							accessibilityRole="button"
							accessibilityState={{ selected: agendaOpen }}
							onPress={handleToggleAgenda}
							style={styles.pillTap}
						>
							<ThemedText type="bodyEmphasis">
								{agendaOpen ? 'Calendar' : 'Agenda'}
							</ThemedText>
						</Pressable>
					</GlassSurface>
					</View>
				</View>
			</View>
			{/* An empty grid says "nothing planned"; a failed read must not
			    borrow that meaning, so it says so and offers the retry. */}
			{calendarError ? (
				<View style={[styles.notice, { borderBottomColor: border }]}>
					<ThemedText
						accessibilityLiveRegion="polite"
						style={[styles.noticeText, { color: textColor }]}
					>
						Your plans could not be loaded.
					</ThemedText>
					<Pressable
						accessibilityHint="Loads your plans again"
						accessibilityLabel="Retry loading plans"
						accessibilityRole="button"
						onPress={handleRetry}
						style={({ pressed }) => [
							styles.noticeAction,
							pressed ? styles.pressed : undefined,
						]}
					>
						<ThemedText type="bodyEmphasis" style={{ color: accentInk }}>
							Try again
						</ThemedText>
					</Pressable>
				</View>
			) : null}

			{/* One stage for both modes, each layer absolutely placed, so the
			    closing one can animate out while the opening one animates in
			    without the two fighting over the same space. The day is not a
			    layer: it floats over both in the sheet below. */}
			<View style={styles.modeStage}>
			{/* One layer, settling into place. A mode change or a new day mounts
			    it fresh, so the offset plays on arrival and nothing had to be
			    kept alive to animate a leaving screen: the small drop is the
			    whole move, and it is over before it can be watched. */}
			<MotiView
				animate={{ translateY: 0 }}
				from={{ translateY: reduceMotion ? 0 : 8 }}
				// Keyed by the mode, so the swap mounts a fresh layer and the
				// offset above actually plays. Without it React reuses the same
				// element and the arrival is invisible.
				key={agendaOpen ? "agenda" : "month"}
				style={styles.modeLayer}
				testID={agendaOpen ? "agenda-surface" : "month-surface"}
				transition={
					reduceMotion
						? { duration: 0, type: "timing" }
						: { ...Springs.rest, type: "spring" }
				}
			>
				{agendaOpen ? agendaBody : monthBody}
			</MotiView>
			</View>
			{/* A grid cell lifts its day over the month in the platform sheet:
			    the month underneath never unmounts, so dismissing returns to
			    exactly where it was. The sheet's own slide is the whole move:
			    no mode swap, no entrance choreography to flicker. */}
			{sheetDate !== null ? (
				<Modal
					animationType="slide"
					onDismiss={handleCloseSheet}
					onRequestClose={handleCloseSheet}
					presentationStyle="pageSheet"
					visible
				>
					<View
						accessibilityViewIsModal
						style={[styles.sheet, { backgroundColor: background }]}
						testID="day-sheet"
					>
						<View style={styles.sheetBar}>
							<Pressable
								accessibilityHint="Closes the day view and returns to the month"
								accessibilityLabel="Close"
								accessibilityRole="button"
								onPress={handleCloseSheet}
								style={({ pressed }) => [
									styles.sheetClose,
									pressed ? styles.pressed : undefined,
								]}
							>
								<Ionicons color={textColor} name="close" size={22} />
							</Pressable>
						</View>
						{dayBody}
					</View>
				</Modal>
			) : null}
			{/* Creation sits where a thumb lands, the same FAB the Memories tab
			    uses: tinted glass over a shaped container, since the material
			    itself cannot be shaped from here. */}
			<Pressable
				accessibilityHint="Creates an event on the selected day"
				accessibilityLabel="Add an event"
				accessibilityRole="button"
				onPress={handleAddEvent}
				style={({ pressed }) => [
					styles.fab,
					{
						bottom: fabBottom,
						// The shared floating level, so this control and the
						// Memories add button sit at the same height above the
						// page instead of each picking their own black.
						boxShadow: shadow(Elevation.floating, shadowColor),
						opacity: pressed ? 0.85 : 1,
					},
				]}
			>
				<GlassSurface
					effect="clear"
					style={[
						styles.fabGlass,
						{
							backgroundColor: withAlpha(
								accent,
								process.env.EXPO_OS === "ios" ? 0.25 : 0.6,
							),
						},
					]}
				>
					<Ionicons color={accent} name="add" size={26} />
				</GlassSurface>
			</Pressable>

		</View>
	);
}

const styles = StyleSheet.create({
	fab: {
		alignItems: 'center',
		borderRadius: FAB_SIZE / 2,
		height: FAB_SIZE,
		justifyContent: 'center',
		position: 'absolute',
		right: Spacing[24],
		width: FAB_SIZE,
	},
	fabGlass: {
		alignItems: 'center',
		alignSelf: 'stretch',
		flex: 1,
		justifyContent: 'center',
	},
	pill: {
		borderRadius: Radii.pill,
		flexDirection: 'row',
		overflow: 'hidden',
	},
	pillRow: {
		alignItems: 'center',
		flexDirection: 'row',
		justifyContent: 'space-between',
		// The header block already carries the page gutter; adding another
		// inset here put this row's chrome 16pt inside the other tabs'.
		paddingVertical: Spacing[8],
	},
	pillActions: {
		alignItems: 'center',
		flexDirection: 'row',
		// The same action gap every header uses, so the buttons sit the same
		// distance apart whichever tab is open.
		gap: Spacing[12],
	},
	pillTap: {
		alignItems: 'center',
		flexDirection: 'row',
		gap: Spacing[4],
		minHeight: 44,
		paddingHorizontal: Spacing[12],
	},

	modeStage: {
		flex: 1,
		// Both layers are absolute inside it, so a closing mode cannot squeeze
		// the opening one while they overlap.
		overflow: 'hidden',
		position: 'relative',
	},
	modeLayer: {
		bottom: 0,
		left: 0,
		position: 'absolute',
		right: 0,
		top: 0,
	},
	dayPagerBox: {
		flex: 1,
	},
	dayPager: {},
	agendaScroll: {
		flex: 1,
	},
	dayHeading: {
		alignItems: 'center',
		borderBottomWidth: StyleSheet.hairlineWidth,
		flexDirection: 'row',
		gap: Spacing[8],
		minHeight: 40,
		paddingHorizontal: Spacing[16],
	},
	dayHeadingText: {
		flex: 1,
	},
	dayHeadingAction: {
		alignItems: 'flex-end',
		justifyContent: 'center',
		minHeight: 44,
		minWidth: 44,
		paddingLeft: Spacing[8],
	},
	todayTap: {
		justifyContent: 'center',
	},
	dayStatus: {
		paddingHorizontal: Spacing[16],
		paddingTop: Spacing[8],
	},
	daySuggestions: {
		alignItems: 'center',
		alignSelf: 'flex-start',
		borderRadius: Radii.pill,
		borderWidth: StyleSheet.hairlineWidth,
		justifyContent: 'center',
		marginHorizontal: Spacing[16],
		marginTop: Spacing[8],
		minHeight: 44,
		paddingHorizontal: Spacing[12],
	},
	notice: {
		alignItems: 'center',
		borderBottomWidth: StyleSheet.hairlineWidth,
		flexDirection: 'row',
		gap: Spacing[12],
		justifyContent: 'space-between',
		minHeight: 44,
		paddingHorizontal: Spacing[16],
	},
	noticeText: {
		flex: 1,
	},
	noticeAction: {
		alignItems: 'center',
		justifyContent: 'center',
		minHeight: 44,
	},
	root: {
		flex: 1,
	},
	headerBlock: {
		justifyContent: "flex-end",
		overflow: "hidden",
		paddingHorizontal: Spacing[24],
		position: "relative",
	},
	calendarCard: {
		// The month grid is the page, and the header floats over it, so this
		// owns the whole screen rather than the space below the band.
		flex: 1,
		gap: Spacing[4],
	},
	monthHeading: {
		paddingBottom: Spacing[4],
		paddingHorizontal: Spacing[16],
		paddingTop: Spacing[12],
	},
	monthStatus: {
		paddingHorizontal: Spacing[24],
		paddingBottom: Spacing[8],
	},
	weekdayRow: {
		borderBottomWidth: StyleSheet.hairlineWidth,
		flexDirection: "row",
		gap: GRID_COLUMN_GAP,
		paddingBottom: Spacing[4],
	},
	weekdayCell: {
		flex: 1,
		alignItems: "center",
	},
	pager: {},
	pagerBox: {
		flex: 1,
	},
	grid: {
		flex: 1,
		gap: GRID_COLUMN_GAP,
	},
	weekRow: {
		borderTopWidth: StyleSheet.hairlineWidth,
		flex: 1,
		flexDirection: "row",
		gap: GRID_COLUMN_GAP,
	},
	emptyWeekRow: {
		flex: 1,
	},
	dayCell: {
		flex: 1,
		minHeight: 44,
		paddingVertical: 6,
		alignItems: "center",
		justifyContent: "flex-start",
		gap: 3,
		// Strips may pass the cell edge, the way Apple's do: a title that fits
		// says more than one clipped to a column.
		overflow: "visible",
	},
	dayNumber: {
		minWidth: 28,
		minHeight: 28,
		borderRadius: 14,
		alignItems: "center",
		justifyContent: "center",
		paddingHorizontal: 4,
	},
	sheet: {
		flex: 1,
	},
	sheetBar: {
		alignItems: 'center',
		flexDirection: 'row',
		justifyContent: 'flex-end',
		minHeight: 44,
		paddingHorizontal: Spacing[8],
	},
	sheetClose: {
		alignItems: 'center',
		justifyContent: 'center',
		minHeight: 44,
		minWidth: 44,
	},
	stripRow: {
		alignItems: "stretch",
		alignSelf: "stretch",
		gap: 2,
	},
	stripMore: {
		paddingLeft: 2,
	},
	strip: {
		alignItems: "center",
		borderRadius: 4,
		flexDirection: "row",
		gap: 2,
		paddingHorizontal: 3,
		paddingVertical: 1,
	},
	stripText: {
		flexShrink: 1,
		// 9pt read as a smudge; 11 is the smallest size that still holds as a
		// word in a cell this narrow.
		fontSize: 11,
		lineHeight: 14,
	},
	dot: {
		width: 5,
		height: 5,
		borderRadius: Radii.pill,
	},
	pressed: {
		opacity: 0.9,
	},
});
