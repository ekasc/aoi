import { FrostedBackdrop } from '@/components/ui/frosted-backdrop';
import { withAlpha } from '@/constants/theme';
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
	addMonths,
	buildMonthGrid,
	findCountdownEvent,
	formatAnniversaryLabel,
	formatCountdownLabel,
	formatDateTitle,
	formatEventTimeLabel,
	formatMonthTitle,
	formatWeekdayShort,
	getAnniversaryForDate,
	getAnniversaryMarkers,
	isSameDay,
	isSameMonth,
	toDayKey,
} from "@/features/calendar/calendar-date-utils";
import { getGoalHorizon } from "@/features/moments/moment-goal-utils";
import { useCalendar } from "@/features/calendar/calendar-context";
import type {
	CalendarEvent,
} from "@/features/calendar/types";
import {
	formatProposalWhen,
} from "@/features/proposals/proposal-time";
import type { EventProposal } from "@/features/proposals/types";
import { useProposals } from "@/features/proposals/proposals-context";
import { useSomeday } from "@/features/someday/someday-context";
import {
	MemorySky,
	compactSkyHeightForWindow,
	fabBottomOffset,
	SYSTEM_TAB_BAR_IOS_CLEARANCE,
	systemTabBarTopOffset,
} from "@/components/home/memory-sky";
import { useMoments } from "@/features/moments/moments-context";
import type { Moment } from "@/features/moments/types";
import { ThemedText } from "@/components/themed-text";
import { MotiView } from "moti";
import { useReducedMotion } from "react-native-reanimated";
import { DayTimeline } from "@/components/calendar/day-timeline";
import { WeekStrip } from "@/components/calendar/week-strip";
import { GlassSurface } from "@/components/ui/glass-surface";
import { SpaceAvatarButton } from "@/components/space/space-avatar-button";
import { Radii, Spacing } from "@/constants/theme";
import { FontFamilies } from "@/constants/typography";
import { getDaysTogether } from "@/features/time-together/time-together";
import { useSpace } from "@/features/space/space-context";
import { useThemeColor } from "@/hooks/use-theme-color";

function buildMonthWeeks(days: Date[]) {
	const weeks: Date[][] = [];

	for (let index = 0; index < days.length; index += 7) {
		weeks.push(days.slice(index, index + 7));
	}

	return weeks;
}

/** Bounded lazy pager: months materialize on demand, never precomputed. */
// Two years either way: far past any real scroll, and light enough that the
// whole list can render without the screen choking on it.
const PAGER_WINDOW_RADIUS = 24;

const PAGER_WINDOW_SIZE = PAGER_WINDOW_RADIUS * 2 + 1;
// Fixed six rows per page; each row fits the tallest cell (day number +
// dot row + today underline + padding/gaps, >= styles.dayCell.minHeight)
// so the pager height is deterministic and never measured from itself.

export type Strip = {
	title: string;
	/** Whose event it is. Both means shared. */
	tone: 'you' | 'partner' | 'both';
};

type DayMark = {
	hasItems: boolean;
	anniversary: boolean;
};

type MonthGridColors = {
	/** The partner's accent, so a day shows whose event is whose. */
	partner: string;
	text: string;
	muted: string;
	accent: string;
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
	onSelectDate,
	onCreateOnDate,
}: MonthGridProps) {
	const monthGrid = useMemo(() => buildMonthGrid(month), [month]);
	const monthWeeks = useMemo(() => {
		const weeks = buildMonthWeeks(monthGrid);
		// Constant six rows per page so the pager never changes height
		// between months, the layout stays put while swiping.
		while (weeks.length < 6) {
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
							const dayTextColor = isSelected
								? colors.onAccent
								: isCurrentMonth
									? colors.text
									: colors.muted;

							return (
								<Pressable
									accessibilityLabel={`${formatDateTitle(day)}${
										mark?.hasItems ? ", has plans" : ""
									}`}
									accessibilityRole="button"
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
											isSelected || (isToday && isCurrentMonth)
												? { backgroundColor: colors.accent }
												: undefined,
										]}
									>
										<ThemedText
											style={{
												color:
													isSelected || (isToday && isCurrentMonth)
														? colors.onAccent
														: dayTextColor,
												fontSize: 19,
												fontWeight:
													isSelected || (isToday && isCurrentMonth)
														? "600"
														: "400",
											}}
										>
											{day.getDate()}
										</ThemedText>
									</View>
									{/* Apple's month view puts the event titles in the
									    cell, not a dot: two lines of tiny text say what
									    the day holds, a dot only says something is there. */}
									<View style={styles.stripRow}>
										{(stripsByDay?.[dayKey] ?? []).slice(0, 2).map((strip, index) => {
											const tint =
												strip.tone === 'partner' ? colors.partner : colors.accent;
											return (
												<View
													key={`${dayKey}:${index}`}
													style={[
														styles.strip,
														{ backgroundColor: withAlpha(tint, 0.16) },
													]}
												>
													<View style={[styles.stripDot, { backgroundColor: tint }]} />
													{strip.tone === 'both' ? (
														<View style={[styles.stripDot, { backgroundColor: tint }]} />
													) : null}
													<ThemedText
														numberOfLines={1}
														type="caption"
														style={[styles.stripText, { color: colors.text }]}
													>
														{strip.title}
													</ThemedText>
												</View>
											);
										})}
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

/** 'YYYY-MM-DD' parsed as a local calendar date (never UTC midnight). */
/** ISO week number, the W38 style stamp a day header carries. */
function isoWeekNumber(date: Date): number {
	const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
	const weekday = (target.getDay() + 6) % 7;
	target.setDate(target.getDate() - weekday + 3);
	const firstThursday = new Date(target.getFullYear(), 0, 4);
	const firstWeekday = (firstThursday.getDay() + 6) % 7;
	firstThursday.setDate(firstThursday.getDate() - firstWeekday + 3);
	return 1 + Math.round((target.getTime() - firstThursday.getTime()) / 604800000);
}

/** "Wednesday \u2013 Sep 16, 2026", the way a day header reads. */
function formatDayHeading(date: Date): string {
	const weekday = date.toLocaleDateString('en-US', { weekday: 'long' });
	const rest = date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
	return `${weekday} \u2013 ${rest}`;
}

function parseLocalDate(value: string): Date | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
	if (!match) {
		return null;
	}
	const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
	return Number.isNaN(date.getTime()) ? null : date;
}

type AgendaProposal = {
	kind: "proposal";
	id: string;
	title: string;
	when: string;
	proposal: EventProposal;
	answerable: boolean;
};

type AgendaGoal = {
	kind: "goal";
	id: string;
	title: string;
	when: string;
	moment: Moment;
};

type AgendaEvent = {
	kind: "event";
	id: string;
	title: string;
	when: string;
	event: CalendarEvent;
};

type AgendaRow = AgendaEvent | AgendaProposal | AgendaGoal;

export default function PlansScreen() {
	const router = useRouter();
	const isFocused = useIsFocused();
	const insets = useSafeAreaInsets();
	const reduceMotion = useReducedMotion();
	const { width: windowWidth, height: windowHeight } = useWindowDimensions();
	const {
		selectedDate,
		visibleMonth,
		eventsForDay,
		upcomingEvents,
		setSelectedDate,
		setVisibleMonth,
		refresh: refreshCalendar,
		error: calendarError,
	} = useCalendar();
	const [centerMonth, setCenterMonth] = useState(() => visibleMonth);
	const [listHeight, setListHeight] = useState(0);
	// Month grid, or one day hour by hour. Tapping a date opens the day.
	const [viewMode, setViewMode] = useState<'month' | 'day'>('month');
	const pagerMonths = useMemo(
		() =>
			Array.from({ length: PAGER_WINDOW_SIZE }, (_, index) =>
				addMonths(centerMonth, index - PAGER_WINDOW_RADIUS),
			),
		[centerMonth],
	);
	const currentMonth = centerMonth;
	const {
		proposals,
		accept: acceptProposal,
		decline: declineProposal,
		reload: reloadProposals,
	} = useProposals();
	const { openItems: somedayOpen } = useSomeday();
	const { moments, loadGoals } = useMoments();
	const { space } = useSpace();
	const [resolvingProposalId, setResolvingProposalId] = useState<string | null>(null);
	const [goals, setGoals] = useState<Moment[] | null>(null);
	const textColor = useThemeColor({}, "text");
	const muted = useThemeColor({}, "muted");
	const border = useThemeColor({}, "border");
	const accent = useThemeColor({}, "accent");
	const onAccent = useThemeColor({}, "onAccent");
	const warning = useThemeColor({}, "warning");
	const background = useThemeColor({}, "background");
	const surface = useThemeColor({}, "surface");
	const partnerAccent = useThemeColor({}, "partnerAccent");
	const gridColors = useMemo(
		() => ({ text: textColor, muted, accent, onAccent, partner: partnerAccent }),
		[textColor, muted, accent, onAccent, partnerAccent],
	);

	const dayCounts = useMemo(() => {
		const counts: Record<string, number> = {};
		for (const key of Object.keys(eventsForDay)) {
			counts[key] = eventsForDay[key].length;
		}
		return counts;
	}, [eventsForDay]);

	const monthTitle = useMemo(
		() => formatMonthTitle(currentMonth),
		[currentMonth],
	);

	// The month named by the header pill: the day's month in day view, the
	// week on screen once the strip is swiped, the list's month in month view.
	const [stripWeek, setStripWeek] = useState<Date | null>(null);
	const pillTitle = useMemo(
		() =>
			viewMode === 'day'
				? formatMonthTitle(stripWeek ?? selectedDate)
				: monthTitle,
		[monthTitle, selectedDate, stripWeek, viewMode],
	);
	const weekdayLabels = useMemo(
		() =>
			buildMonthGrid(currentMonth)
				.slice(0, 7)
				.map((day) => formatWeekdayShort(day).toUpperCase().slice(0, 1)),
		[currentMonth],
	);
	const selectedDayEvents = useMemo(
		() => eventsForDay[toDayKey(selectedDate)] ?? [],
		[eventsForDay, selectedDate],
	);
	const selectedDateIso = useMemo(
		() => selectedDate.toISOString(),
		[selectedDate],
	);

	const [now, setNow] = useState(() => new Date());
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

	const countdownInfo = useMemo(
		() => findCountdownEvent(upcomingEvents, now),
		[now, upcomingEvents],
	);
	const countdownLabel = useMemo(
		() => formatCountdownLabel(countdownInfo),
		[countdownInfo],
	);
	const nextEventDate = useMemo(() => {
		if (!countdownInfo) {
			return null;
		}
		const date = new Date(countdownInfo.event.startsAt);
		return Number.isNaN(date.getTime()) ? null : date;
	}, [countdownInfo]);
	const selectedDayAnniversary = useMemo(
		() => getAnniversaryForDate(space?.relationshipStartDate, selectedDate),
		[selectedDate, space?.relationshipStartDate],
	);
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
	const relationshipStartDate = useMemo(
		() =>
			space?.relationshipStartDate
				? parseLocalDate(space.relationshipStartDate)
				: null,
		[space?.relationshipStartDate],
	);

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
	// Suggestions are only ever answerable when they are the partner's and
	// still pending, yours wait for them, quietly.
	const answerableIds = useMemo(() => {
		const ids = new Set<string>();
		for (const proposal of pendingProposals) {
			if (proposal.proposerRole === "partner") {
				ids.add(proposal.id);
			}
		}
		return ids;
	}, [pendingProposals]);

	// Dots for every date carrying plans: events, pending proposals, and
	// dated future goals, plus the anniversary mark. Titles stay out of
	// the cells; the agenda below owns the details.
	// What each day holds, for the strips inside the month grid.
	const stripsByDay = useMemo(() => {
		const strips: Record<string, Strip[]> = {};
		for (const key of Object.keys(eventsForDay)) {
			const day = eventsForDay[key]
				.slice()
				.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
				.map((event) => ({
					title: event.title,
					tone: (event.together ? 'both' : event.isOwn ? 'you' : 'partner') as Strip['tone'],
				}));
			if (day.length > 0) {
				strips[key] = day;
			}
		}
		return strips;
	}, [eventsForDay]);

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

	const agendaRows = useMemo<AgendaRow[]>(() => {
		const dayKey = toDayKey(selectedDate);
		const rows: AgendaRow[] = selectedDayEvents.map((event) => ({
			kind: "event" as const,
			id: event.id,
			title: event.title,
			when: event.allDay ? "All day" : formatEventTimeLabel(event),
			event,
		}));
		for (const proposal of pendingProposals) {
			if (toDayKey(new Date(proposal.proposedStart)) === dayKey) {
				rows.push({
					kind: "proposal" as const,
					id: proposal.id,
					title: proposal.title,
					when: formatProposalWhen(proposal),
					proposal,
					answerable: answerableIds.has(proposal.id),
				});
			}
		}
		for (const goal of goals ?? []) {
			if (goal.targetAt && toDayKey(new Date(goal.targetAt)) === dayKey) {
				rows.push({
					kind: "goal" as const,
					id: goal.id,
					title: goal.title,
					when: `Goal · ${getGoalHorizon(goal, now)}`,
					moment: goal,
				});
			}
		}
		return rows;
	}, [selectedDate, selectedDayEvents, pendingProposals, answerableIds, goals, now]);

	const handleSelectDate = useCallback(
		(date: Date) => {
			setSelectedDate(date);
			setCenterMonth(date);
			setViewMode('day');
		},
		[setCenterMonth, setSelectedDate],
	);
	const handleJumpToToday = useCallback(() => {
		const today = new Date();
		setCenterMonth(today);
		setSelectedDate(today);
		if (viewMode === 'day') {
			setViewMode('day');
		}
	}, [setSelectedDate, viewMode]);

	const handleShowMonths = useCallback(() => {
		setViewMode('month');
	}, []);


	const handleOpenNextEvent = useCallback(() => {
		if (!nextEventDate) {
			return;
		}
		setCenterMonth(nextEventDate);
		setSelectedDate(nextEventDate);
	}, [nextEventDate, setSelectedDate]);
	const handleAddEvent = useCallback(() => {
		router.push({
			pathname: "/(app)/calendar/new-event",
			params: { date: selectedDateIso },
		});
	}, [router, selectedDateIso]);

	/** Adds to the day the sheet is showing. */
	const handleCreateAtHour = useCallback(
		(hour: number) => {
			router.push({
				pathname: "/(app)/calendar/new-event",
				params: { date: selectedDateIso, hour: String(hour) },
			});
		},
		[router, selectedDateIso],
	);

	const handleCreateOnDate = useCallback(
		(date: Date) => {
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
	const handleOpenGoal = useCallback(
		(momentId: string) => {
			const goal = goals?.find((item) => item.id === momentId);
			router.push({
				pathname: '/(app)/moment/[id]' as const,
				params: goal ? { id: goal.id, at: goal.occurredAt } : { id: momentId },
			});
		},
		[goals, router],
	);
	const handleNewGoal = useCallback(() => {
		router.push("/(app)/goal-new");
	}, [router]);
	const handleSuggestTime = useCallback(() => {
		router.push({ pathname: "/(app)/proposal/new" });
	}, [router]);
	const handleOpenSomeday = useCallback(() => {
		router.push("/(app)/someday");
	}, [router]);

	const handleResolveProposal = useCallback(
		async (proposalId: string, action: "accept" | "decline") => {
			setResolvingProposalId(proposalId);
			try {
				if (action === "accept") {
					await acceptProposal(proposalId);
					// An accepted suggestion becomes a real event.
					await refreshCalendar();
				} else {
					await declineProposal(proposalId);
				}
			} catch {
				// Calm, re-read the list in case it was answered elsewhere.
				void reloadProposals();
			} finally {
				setResolvingProposalId(null);
			}
		},
		[acceptProposal, declineProposal, refreshCalendar, reloadProposals],
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

	// One month of the vertical stack: the month name, then its grid, filling
	// the space the list actually has. The list reports that space, so there
	// is no safe area, no tab bar clearance and no row heights to add up.
	// The page IS the viewport. A page taller or shorter than the step makes the
	// pager land mid month, and the error compounds over the pages between the
	// anchor and today: that is what left the tail of one month sitting above the
	// next month's heading. One number, measured, for both.
	const MONTH_PAGE_HEIGHT = listHeight;

	// A deliberate month change puts the list back on its centre page. This
	// runs on the month changing, never on a scroll, so it cannot loop.
	useEffect(() => {
		pagerRef.current?.scrollTo({
			animated: false,
			y: MONTH_PAGE_HEIGHT * PAGER_WINDOW_RADIUS,
		});
	}, [MONTH_PAGE_HEIGHT, centerMonth]);


	// The pill carries the month now, so the header no longer reads the
	// background luminance to pick a title tone.
	// Keep the context's loaded window in step with the month the user is on.
	useEffect(() => {
		if (!isSameMonth(currentMonth, visibleMonth)) {
			setVisibleMonth(currentMonth);
		}
	}, [currentMonth, setVisibleMonth, visibleMonth]);



	// The band plus the title row. The block clips what it holds, so a height
	// that only counted the sky pushed the header out of view.
	// The chrome is written for text over the sky, but the sky's lower edge is
	// pale in light mode: pick the tone from the background so the title reads.
	const rootStyle = useMemo(
		() => [
			styles.root,
			{
				backgroundColor: background,
				// Without this the month grid runs to the bottom of the screen and
				// parks its last row behind the tab bar.
				paddingBottom: systemTabBarTopOffset(insets.bottom),
			},
		],
		[background, insets.bottom],
	);
	// A sky band, not a sliver: the band is as tall as the sky draws, and the
	// calendar chrome sits along its lower edge with the sky visible above it.
	const headerBlockStyle = useMemo(
		() => [
			styles.headerBlock,
			{
				minHeight: compactSkyHeightForWindow(windowHeight) + Spacing[8],
				paddingTop: insets.top + Spacing[8],
			},
		],
		[insets.top, windowHeight],
	);

	return (
		<View style={rootStyle}>
      <FrostedBackdrop />
			<View style={headerBlockStyle}>
				<MemorySky compact moments={moments ?? []} daysTogether={daysTogether} startDate={space?.relationshipStartDate ?? null} focused={isFocused} />
				<View style={styles.pillRow}>
					<SpaceAvatarButton />
					<GlassSurface style={styles.pill}>
						{viewMode === 'day' ? (
							<Pressable
								accessibilityHint="Shows the months again"
								accessibilityLabel="Back to the month"
								accessibilityRole="button"
								onPress={handleShowMonths}
								style={styles.pillTap}
							>
								<Ionicons color={textColor} name="chevron-back" size={18} />
								<ThemedText type="bodyEmphasis">{pillTitle}</ThemedText>
							</Pressable>
						) : (
							<View style={styles.pillTap}>
								<ThemedText type="bodyEmphasis">{pillTitle}</ThemedText>
							</View>
						)}
					</GlassSurface>
					<GlassSurface style={styles.pill}>
						<Pressable
							accessibilityHint={
								viewMode === 'day' ? 'Shows the month grid' : 'Shows the selected day'
							}
							accessibilityLabel={viewMode === 'day' ? 'Month view' : 'Day view'}
							accessibilityRole="button"
							onPress={() =>
								setViewMode((mode) => (mode === 'day' ? 'month' : 'day'))
							}
							style={styles.pillIcon}
						>
							<Ionicons
								color={textColor}
								name={viewMode === 'day' ? 'grid-outline' : 'time-outline'}
								size={20}
							/>
						</Pressable>
						<Pressable
							accessibilityLabel="Add an event for the selected day"
							accessibilityRole="button"
							onPress={handleAddEvent}
							style={styles.pillIcon}
						>
							<Ionicons color={accent} name="add" size={22} />
						</Pressable>
					</GlassSurface>
				</View>
				{viewMode === 'day' ? (
					<WeekStrip
						accent={accent}
						markedDays={dayCounts}
						onAccent={onAccent}
						onSelectDate={handleSelectDate}
						onWeekChange={setStripWeek}
						selectedDate={selectedDate}
					/>
				) : null}
			</View>
			{countdownInfo && countdownLabel && nextEventDate ? (
				<Pressable
					accessibilityLabel={`Next: ${countdownInfo.event.title}, ${countdownLabel}`}
					accessibilityRole="button"
					onPress={handleOpenNextEvent}
					style={({ pressed }) => [
						styles.nextBlock,
						{ borderBottomColor: border },
						pressed ? styles.pressed : undefined,
					]}
				>
					<ThemedText type="meta" style={{ color: muted }}>
						Next
					</ThemedText>
					<ThemedText numberOfLines={2} style={styles.nextTitle}>
						{countdownInfo.event.title}
					</ThemedText>
					<ThemedText type="caption" style={{ color: muted }}>
						{countdownLabel} · {formatDateTitle(nextEventDate)} · {formatEventTimeLabel(countdownInfo.event)}
					</ThemedText>
				</Pressable>
			) : null}

			{viewMode === 'day' ? (
				<MotiView
					animate={{ opacity: 1, translateY: 0 }}
					from={{ opacity: 0, translateY: reduceMotion ? 0 : 16 }}
					key="day"
					style={styles.daySurface}
					transition={{ duration: reduceMotion ? 0 : 260, type: 'timing' }}
				>
					<View style={[styles.dayHeading, { borderBottomColor: border }]}>
						<ThemedText type="meta" style={[styles.dayWeek, { color: muted }]}>
							{`W${isoWeekNumber(selectedDate)}`}
						</ThemedText>
						<ThemedText numberOfLines={1} type="subheading" style={styles.dayHeadingText}>
							{formatDayHeading(selectedDate)}
						</ThemedText>
					</View>
					<DayTimeline
						events={selectedDayEvents}
						onCreateAtHour={handleCreateAtHour}
						onOpenEvent={handleOpenEvent}
						ownColor={accent}
						partnerColor={partnerAccent}
					/>
				</MotiView>
			) : (
			<MotiView
				animate={{ opacity: 1, translateY: 0 }}
				from={{ opacity: 0, translateY: reduceMotion ? 0 : -12 }}
				key="month"
				style={styles.calendarCard}
				transition={{ duration: reduceMotion ? 0 : 260, type: 'timing' }}
			>
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
				contentOffset={{ x: 0, y: MONTH_PAGE_HEIGHT * PAGER_WINDOW_RADIUS }}
				pagingEnabled
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
							colors={gridColors}
							marks={marksByDay}
							stripsByDay={stripsByDay}
							month={month}
							now={now}
							onCreateOnDate={handleCreateOnDate}
							onSelectDate={handleSelectDate}
							selectedDate={selectedDate}
						/>
					</View>
				))}
			</ScrollView>
			) : null}
			</View>
			</MotiView>
			)}
			<Pressable
				accessibilityHint="Scrolls the calendar back to this month"
				accessibilityLabel="Today"
				accessibilityRole="button"
				onPress={handleJumpToToday}
				style={({ pressed }) => [
					styles.todayPill,
					{
						backgroundColor: surface,
						borderColor: border,
						bottom: systemTabBarTopOffset(insets.bottom) + Spacing[16],
					},
					pressed ? styles.pressed : undefined,
				]}
			>
				<ThemedText type="bodyEmphasis">Today</ThemedText>
			</Pressable>

		</View>
	);
}

const styles = StyleSheet.create({
	todayPill: {
		alignItems: 'center',
		borderRadius: Radii.pill,
		borderWidth: StyleSheet.hairlineWidth,
		justifyContent: 'center',
		left: Spacing[24],
		minHeight: 44,
		paddingHorizontal: Spacing[16],
		position: 'absolute',
	},
	pill: {
		borderRadius: Radii.pill,
		flexDirection: 'row',
		overflow: 'hidden',
	},
	pillIcon: {
		alignItems: 'center',
		height: 44,
		justifyContent: 'center',
		width: 44,
	},
	pillRow: {
		alignItems: 'center',
		flexDirection: 'row',
		justifyContent: 'space-between',
		paddingHorizontal: Spacing[16],
		paddingVertical: Spacing[8],
	},
	pillTap: {
		alignItems: 'center',
		flexDirection: 'row',
		gap: Spacing[4],
		minHeight: 44,
		paddingHorizontal: Spacing[12],
	},
	daySurface: {
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
		textAlign: 'center',
	},
	dayWeek: {
		width: 40,
	},
	dayBack: {
		alignItems: 'center',
		flexDirection: 'row',
		gap: Spacing[4],
		minHeight: 44,
	},
	dayHeader: {
		gap: Spacing[4],
		paddingBottom: Spacing[8],
		paddingHorizontal: Spacing[24],
	},
	sheetBody: {
		gap: Spacing[12],
		paddingHorizontal: Spacing[24],
		paddingVertical: Spacing[16],
	},
	sheetRow: {
		alignItems: 'center',
		borderBottomWidth: StyleSheet.hairlineWidth,
		flexDirection: 'row',
		gap: Spacing[8],
		minHeight: 44,
	},
	sheetWhen: {
		minWidth: 72,
	},
	sheetTitle: {
		flex: 1,
	},
	authorDot: {
		borderRadius: 4,
		height: 8,
		width: 8,
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
	nextBlock: {
		gap: Spacing[4],
		paddingVertical: Spacing[24],
		borderBottomWidth: StyleSheet.hairlineWidth,
		minHeight: 44,
		justifyContent: "center",
	},
	nextTitle: {
		fontFamily: FontFamilies.display,
		fontSize: 26,
		lineHeight: 34,
		letterSpacing: -0.2,
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
	weekdayRow: {
		borderBottomWidth: StyleSheet.hairlineWidth,
		flexDirection: "row",
		gap: Spacing[4],
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
		gap: Spacing[4],
	},
	weekRow: {
		borderTopWidth: StyleSheet.hairlineWidth,
		flex: 1,
		flexDirection: "row",
		gap: Spacing[4],
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
	stripRow: {
		alignItems: "stretch",
		alignSelf: "stretch",
		gap: 2,
	},
	strip: {
		alignItems: "center",
		borderRadius: 4,
		flexDirection: "row",
		gap: 2,
		paddingHorizontal: 3,
		paddingVertical: 1,
	},
	stripDot: {
		borderRadius: Radii.pill,
		height: 5,
		width: 5,
	},
	stripText: {
		flexShrink: 1,
		fontSize: 9,
		lineHeight: 12,
	},
	dotRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		gap: 3,
		minHeight: 6,
	},
	dot: {
		width: 5,
		height: 5,
		borderRadius: Radii.pill,
	},
	pressed: {
		opacity: 0.9,
	},
	section: {
		gap: Spacing[8],
	},
	agendaHeading: {
		flexShrink: 1,
	},
	sectionHeader: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: Spacing[12],
	},
	groupCard: {
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: Radii.lg,
		paddingHorizontal: Spacing[12],
		paddingVertical: Spacing[4],
	},
	groupSeparator: {
		height: StyleSheet.hairlineWidth,
	},
	emptyAgenda: {
		gap: Spacing[8],
		alignItems: "flex-start",
	},
	row: {
		flexDirection: "row",
		alignItems: "center",
		gap: Spacing[12],
		minHeight: 44,
	},
	rowWhen: {
		width: 76,
		fontVariant: ["tabular-nums"],
	},
	emptyActions: {
		alignItems: "center",
		flexDirection: "row",
		gap: Spacing[8],
	},
	rowActions: {
		alignItems: "center",
		flexDirection: "row",
		gap: Spacing[8],
	},
	rowTitle: {
		flex: 1,
	},
	separator: {
		height: StyleSheet.hairlineWidth,
		marginLeft: 76 + Spacing[12],
	},
	proposalRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: Spacing[12],
		paddingVertical: Spacing[8],
	},
	pendingDot: {
		width: 8,
		height: 8,
		borderRadius: Radii.pill,
		flexShrink: 0,
	},
	proposalText: {
		flex: 1,
		gap: Spacing[4],
	},
	proposalActions: {
		flexDirection: "row",
		flexWrap: "wrap",
		alignItems: "center",
		gap: Spacing[8],
	},
});
