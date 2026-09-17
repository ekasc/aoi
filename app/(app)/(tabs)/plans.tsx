import { FrostedBackdrop } from '@/components/ui/frosted-backdrop';
import { withAlpha } from '@/constants/theme';
import { BlurView } from 'expo-blur';
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
} from "@/components/home/memory-sky";
import { useMoments } from "@/features/moments/moments-context";
import type { Moment } from "@/features/moments/types";
import { ThemedText } from "@/components/themed-text";
import { Button } from "@/components/ui/button";
import { Divider } from "@/components/ui/divider";
import { IconButton } from "@/components/ui/icon-button";
import { GlassSurface } from "@/components/ui/glass-surface";
import { ScreenHeader } from "@/components/ui/screen-header";
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

/** The title row inside the header block, above the calendar. */
const HEADER_ROW_HEIGHT = 56;

/** The weekday row, which belongs to the header rather than to the grid. */
const WEEKDAY_ROW_HEIGHT = 40;
const PAGER_WINDOW_SIZE = PAGER_WINDOW_RADIUS * 2 + 1;
// Fixed six rows per page; each row fits the tallest cell (day number +
// dot row + today underline + padding/gaps, >= styles.dayCell.minHeight)
// so the pager height is deterministic and never measured from itself.
const CALENDAR_ROW_COUNT = 6;
const CALENDAR_ROW_HEIGHT = 64;
const CALENDAR_GRID_GAP = Spacing[4];
const PAGER_HEIGHT =
	CALENDAR_ROW_COUNT * CALENDAR_ROW_HEIGHT +
	(CALENDAR_ROW_COUNT - 1) * CALENDAR_GRID_GAP;

type DayMark = {
	hasItems: boolean;
	anniversary: boolean;
};

type MonthGridColors = {
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
	/** Event titles per day, in the order they happen. */
	stripsByDay?: Record<string, string[]>;
	colors: MonthGridColors;
	onSelectDate: (date: Date) => void;
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
										{(stripsByDay?.[dayKey] ?? []).slice(0, 2).map((title, index) => (
											<View
												key={`${dayKey}:${index}`}
												style={[
													styles.strip,
													{
														backgroundColor: withAlpha(colors.accent, 0.16),
													},
												]}
											>
												<View
													style={[styles.stripDot, { backgroundColor: colors.accent }]}
												/>
												<ThemedText
													numberOfLines={1}
													type="caption"
													style={[styles.stripText, { color: colors.text }]}
												>
													{title}
												</ThemedText>
											</View>
										))}
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
	const [screenHeight, setScreenHeight] = useState(0);
	const [headerMeasured, setHeaderMeasured] = useState(0);
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
	const gridColors = useMemo(
		() => ({ text: textColor, muted, accent, onAccent }),
		[textColor, muted, accent, onAccent],
	);

	const monthTitle = useMemo(
		() => formatMonthTitle(currentMonth),
		[currentMonth],
	);
	const weekdayLabels = useMemo(
		() =>
			buildMonthGrid(currentMonth)
				.slice(0, 7)
				.map((day) => formatWeekdayShort(day).toUpperCase()),
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
		const strips: Record<string, string[]> = {};
		for (const key of Object.keys(eventsForDay)) {
			const titles = eventsForDay[key]
				.slice()
				.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
				.map((event) => event.title);
			if (titles.length > 0) {
				strips[key] = titles;
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
		},
		[setSelectedDate],
	);
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
	// One month of the vertical stack: the month name, then its grid.
	// The month fills the screen under the header, the way Apple's does. Rows
	// stretch to the space, so a month never leaves half the page unusable.
	// Measured where the device will tell us, computed where it will not. A
	// month that fits its screen cannot be got right by arithmetic alone.
	const availableHeight =
		screenHeight > 0 && headerMeasured > 0
			? screenHeight - headerMeasured - SYSTEM_TAB_BAR_IOS_CLEARANCE
			: windowHeight -
				compactSkyHeightForWindow(windowHeight) -
				HEADER_ROW_HEIGHT -
				insets.bottom -
				SYSTEM_TAB_BAR_IOS_CLEARANCE - WEEKDAY_ROW_HEIGHT;
	const MONTH_PAGE_HEIGHT = Math.max(PAGER_HEIGHT + 76, availableHeight);


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
	const backgroundIsLight = useMemo(() => {
		const hex = background.replace('#', '');
		if (hex.length < 6) {
			return false;
		}
		const value =
			(0.299 * parseInt(hex.slice(0, 2), 16) +
				0.587 * parseInt(hex.slice(2, 4), 16) +
				0.114 * parseInt(hex.slice(4, 6), 16)) /
			255;
		return value > 0.6;
	}, [background]);

	const rootStyle = useMemo(
		() => [
			styles.root,
			{ backgroundColor: background },
		],
		[background],
	);
	const headerBlockStyle = useMemo(
		() => [
			styles.headerBlock,
			{
				paddingTop: insets.top + Spacing[8],
			},
		],
		[insets.top],
	);

	return (
		<View
			onLayout={(event) => setScreenHeight(Math.round(event.nativeEvent.layout.height))}
			style={rootStyle}
		>
      <FrostedBackdrop />
			<View
				onLayout={(event) => setHeaderMeasured(Math.round(event.nativeEvent.layout.height))}
				style={headerBlockStyle}
			>
				<MemorySky compact moments={moments ?? []} daysTogether={daysTogether} startDate={space?.relationshipStartDate ?? null} focused={isFocused} />
				<ScreenHeader
					tone={backgroundIsLight ? 'onLight' : 'onDark'}
					title="Plans"
				/>
				{/* Frosted band, the same recipe the Memories header uses: the sky
				    reads through, blurred, and the chrome sits on top of it. */}
				<View
					accessible={false}
					importantForAccessibility="no-hide-descendants"
					pointerEvents="none"
					style={StyleSheet.absoluteFill}
				>
					<BlurView
						intensity={60}
						tint={backgroundIsLight ? 'light' : 'dark'}
						style={StyleSheet.absoluteFill}
					/>
					<View
						style={[
							StyleSheet.absoluteFill,
							{ backgroundColor: withAlpha(background, 0.45) },
						]}
					/>
				</View>
				{/* Part of the header, so it never moves and never leaves a gap. */}
			<View style={[styles.weekdayRow, { borderBottomColor: border }]}>
				{weekdayLabels.map((label) => (
					<View key={label} style={styles.weekdayCell}>
						<ThemedText type="meta" style={{ color: muted }}>
							{label}
						</ThemedText>
					</View>
				))}
			</View>

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

			<View style={styles.calendarCard}>
			{/* Weekday header stays put; the month grid slides beneath it. */}
			<ScrollView
				ref={pagerRef}
				contentOffset={{ x: 0, y: MONTH_PAGE_HEIGHT * PAGER_WINDOW_RADIUS }}
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
						<ThemedText type="display" style={styles.monthHeading}>
							{formatMonthTitle(month)}
						</ThemedText>
						<MonthGrid
							colors={gridColors}
							marks={marksByDay}
							stripsByDay={stripsByDay}
							month={month}
							now={now}
							onSelectDate={handleSelectDate}
							selectedDate={selectedDate}
						/>
					</View>
				))}
			</ScrollView>
			</View>
			<Pressable
				accessibilityHint="Creates an event on the selected day"
				accessibilityLabel="Add event"
				accessibilityRole="button"
				onPress={handleAddEvent}
				style={({ pressed }) => [
					styles.fab,
					styles.fabGlass,
					{
						bottom: fabBottomOffset(insets.bottom, process.env.EXPO_OS === 'ios'),
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
								process.env.EXPO_OS === 'ios' ? 0.25 : 0.6,
							),
						},
					]}
				>
					<Ionicons color={onAccent} name="add" size={26} />
				</GlassSurface>
			</Pressable>
		</View>
	);
}

const styles = StyleSheet.create({
	root: {
		flex: 1,
	},
	headerBlock: {
		position: "relative",
		paddingHorizontal: Spacing[24],
		overflow: "hidden",
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
	fab: {
		borderRadius: 28,
		height: 56,
		overflow: "hidden",
		position: "absolute",
		right: Spacing[24],
		width: 56,
	},
	fabGlass: {
		alignItems: "center",
		flex: 1,
		justifyContent: "center",
	},
	calendarCard: {
		// Apple's month grid is the page, not a card on it: full bleed, no
		// border, no radius, and it starts flush under the weekday row.
		flex: 1,
		gap: Spacing[4],
	},
	monthHeading: {
		letterSpacing: -1,
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
		gap: 3,
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
