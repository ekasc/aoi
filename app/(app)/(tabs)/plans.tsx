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
import { MemorySky, compactSkyHeightForWindow, SYSTEM_TAB_BAR_IOS_CLEARANCE } from "@/components/home/memory-sky";
import { useMoments } from "@/features/moments/moments-context";
import type { Moment } from "@/features/moments/types";
import { ThemedText } from "@/components/themed-text";
import { Button } from "@/components/ui/button";
import { Divider } from "@/components/ui/divider";
import { IconButton } from "@/components/ui/icon-button";
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
const PAGER_WINDOW_RADIUS = 3;
const PAGER_WINDOW_SIZE = PAGER_WINDOW_RADIUS * 2 + 1;
// Fixed six rows per page; each row fits the tallest cell (day number +
// dot row + today underline + padding/gaps, >= styles.dayCell.minHeight)
// so the pager height is deterministic and never measured from itself.
const CALENDAR_ROW_COUNT = 6;
const CALENDAR_ROW_HEIGHT = 48;
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
											isSelected
												? { backgroundColor: colors.accent }
												: undefined,
										]}
									>
										<ThemedText
											type="caption"
											style={{
												color: dayTextColor,
												fontWeight:
													isSelected || (isToday && isCurrentMonth)
														? "700"
														: undefined,
											}}
										>
											{day.getDate()}
										</ThemedText>
									</View>
									<View style={styles.dotRow}>
										{mark?.hasItems ? (
											<View
												style={[
													styles.dot,
													{ backgroundColor: colors.muted },
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
									{isToday && isCurrentMonth ? (
										<View
											style={[
												styles.todayUnderline,
												{ backgroundColor: colors.accent },
											]}
										/>
									) : null}
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
	const [calendarExpandedOverride, setCalendarExpandedOverride] = useState<boolean | null>(null);
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
	const hasUpcoming = upcomingEvents.length > 0;
	const calendarExpanded = calendarExpandedOverride ?? !hasUpcoming;
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
		setCalendarExpandedOverride(true);
	}, [nextEventDate, setSelectedDate]);
	const handleToggleCalendar = useCallback(() => {
		setCalendarExpandedOverride((expanded) => !(expanded ?? !hasUpcoming));
	}, [hasUpcoming]);
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
	const PAGE_WIDTH = windowWidth - Spacing[24] * 2 - Spacing[12] * 2;
	const pagerRef = useRef<ScrollView | null>(null);
	const pagerHeight = PAGER_HEIGHT;

	// Keep the pager visually centered after every rebase (mount included);
	// the user's swipe or tap already supplied the motion.
	useEffect(() => {
		pagerRef.current?.scrollTo({
			x: PAGE_WIDTH * PAGER_WINDOW_RADIUS,
			animated: false,
		});
	}, [PAGE_WIDTH, centerMonth]);

	// Keep the context's loaded window in step with the month the user is on.
	useEffect(() => {
		if (!isSameMonth(currentMonth, visibleMonth)) {
			setVisibleMonth(currentMonth);
		}
	}, [currentMonth, setVisibleMonth, visibleMonth]);

	const handleGoToPreviousMonth = useCallback(() => {
		setCenterMonth((month) => addMonths(month, -1));
	}, []);

	const handleGoToNextMonth = useCallback(() => {
		setCenterMonth((month) => addMonths(month, 1));
	}, []);

	const handlePagerMomentumEnd = useCallback(
		(event: NativeSyntheticEvent<NativeScrollEvent>) => {
			const page = Math.round(
				event.nativeEvent.contentOffset.x / PAGE_WIDTH,
			);
			const month = addMonths(centerMonth, page - PAGER_WINDOW_RADIUS);
			if (isSameMonth(month, centerMonth)) {
				return;
			}
			setCenterMonth(month);
		},
		[PAGE_WIDTH, centerMonth],
	);

	const relationshipSubtitle = useMemo(
		() =>
			relationshipStartDate
				? `Together since ${relationshipStartDate.toLocaleDateString("en-US", {
						month: "long",
						day: "numeric",
						year: "numeric",
					})}`
				: undefined,
		[relationshipStartDate],
	);

	const headerBlockHeight = useMemo(
		() => compactSkyHeightForWindow(windowHeight),
		[windowHeight],
	);
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
				height: headerBlockHeight,
				paddingTop: insets.top + Spacing[8],
			},
		],
		[headerBlockHeight, insets.top],
	);

	const somedayPreview = useMemo(
		() => somedayOpen.slice(0, 3),
		[somedayOpen],
	);

	return (
		<View style={rootStyle}>
      <FrostedBackdrop />
			<View style={headerBlockStyle}>
				<MemorySky compact moments={moments ?? []} daysTogether={daysTogether} startDate={space?.relationshipStartDate ?? null} focused={isFocused} />
				<ScreenHeader
					title="Plans"
					subtitle={relationshipSubtitle}
					primaryAction={{
						label: 'Add an event for the selected day',
						icon: <Ionicons color={onAccent} name="add" size={20} />,
						onPress: handleAddEvent,
					}}
				/>
			</View>
			<ScrollView
				contentContainerStyle={[
					styles.content,
					{
						paddingBottom:
							insets.bottom +
							Spacing[32] +
							(process.env.EXPO_OS === 'ios'
								? SYSTEM_TAB_BAR_IOS_CLEARANCE
								: 0),
					},
				]}
				showsVerticalScrollIndicator={false}
				style={styles.scroll}
			>
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

			<Button
				label={calendarExpanded ? "Hide calendar" : "Show calendar"}
				variant="secondary"
				onPress={handleToggleCalendar}
				accessibilityState={{ expanded: calendarExpanded }}
			/>

			{calendarExpanded ? (
			<View style={[styles.calendarCard, { backgroundColor: withAlpha(surface, 0.3), borderColor: border }]}>
			<View style={styles.monthNav}>
				<IconButton
					accessibilityLabel="Previous month"
					variant="ghost"
					label="Previous month"
					onPress={handleGoToPreviousMonth}
				>
					{"‹"}
				</IconButton>
				<ThemedText
					type="title"
					selectable
					numberOfLines={2}
					style={styles.monthTitle}
				>
					{monthTitle}
				</ThemedText>
				<IconButton
					accessibilityLabel="Next month"
					variant="ghost"
					label="Next month"
					onPress={handleGoToNextMonth}
				>
					{"›"}
				</IconButton>
			</View>

			{/* Weekday header stays put; the month grid slides beneath it. */}
			<View style={styles.weekdayRow}>
				{weekdayLabels.map((label) => (
					<View key={label} style={styles.weekdayCell}>
						<ThemedText type="meta" style={{ color: muted }}>
							{label}
						</ThemedText>
					</View>
				))}
			</View>

			<ScrollView
				ref={pagerRef}
				contentOffset={{ x: PAGE_WIDTH * PAGER_WINDOW_RADIUS, y: 0 }}
				decelerationRate="fast"
				horizontal
				nestedScrollEnabled
				onMomentumScrollEnd={handlePagerMomentumEnd}
				pagingEnabled
				showsHorizontalScrollIndicator={false}
				style={[styles.pager, { height: pagerHeight }]}
			>
				{pagerMonths.map((month) => (
					<View
						accessibilityLabel={`Month page ${formatMonthTitle(month)}`}
						key={toDayKey(month)}
						style={{
							width: PAGE_WIDTH,
							height: pagerHeight,
						}}
					>
						<MonthGrid
							colors={gridColors}
							marks={marksByDay}
							month={month}
							now={now}
							onSelectDate={handleSelectDate}
							selectedDate={selectedDate}
						/>
					</View>
				))}
			</ScrollView>
			</View>
			) : null}

			<View style={styles.section}>
				<ThemedText type="title" selectable style={styles.agendaHeading}>
					{formatDateTitle(selectedDate)}
				</ThemedText>
				{selectedDayAnniversary ? (
					<ThemedText type="caption" style={{ color: muted }}>
						{formatAnniversaryLabel(selectedDayAnniversary)}
					</ThemedText>
				) : null}
				{agendaRows.length === 0 ? (
					<View style={styles.emptyAgenda}>
						{calendarError ? (
							<ThemedText type="body" style={{ color: muted }}>
								Couldn&apos;t load plans, check your connection.
							</ThemedText>
						) : (
							<ThemedText type="body" style={{ color: muted }}>
								An open day. Add something small if you like.
							</ThemedText>
						)}
						<Button
							label="Add event"
							variant="secondary"
							onPress={handleAddEvent}
						/>
					</View>
				) : (
					agendaRows.map((row, index) => (
						<View key={`${row.kind}:${row.id}`}>
							{index > 0 ? (
								<View
									style={[styles.separator, { backgroundColor: border }]}
								/>
							) : null}
							<Pressable
								accessibilityLabel={`Open ${row.title}`}
								accessibilityRole="button"
								onPress={() => {
									if (row.kind === "event") {
										handleOpenEvent(row.id);
									} else if (row.kind === "goal") {
										handleOpenGoal(row.id);
									} else {
										handleSuggestTime();
									}
								}}
								style={({ pressed }) => [
									styles.row,
									pressed ? styles.pressed : undefined,
								]}
							>
								<ThemedText
									type="caption"
									style={[styles.rowWhen, { color: muted }]}
								>
									{row.when}
								</ThemedText>
								<ThemedText type="body" style={styles.rowTitle}>
									{row.title}
								</ThemedText>
								<Ionicons color={muted} name="chevron-forward" size={16} />
							</Pressable>
						</View>
					))
				)}
			</View>

			<Divider />

			<View style={styles.section}>
				<View style={styles.sectionHeader}>
					<ThemedText type="title">Proposals</ThemedText>
					<Button
						label="Suggest a time"
						variant="ghost"
						size="sm"
						onPress={handleSuggestTime}
					/>
				</View>
				{pendingProposals.length === 0 ? (
					<ThemedText type="body" style={{ color: muted }}>
						Nothing waiting for a yes right now.
					</ThemedText>
				) : (
					<View style={[styles.groupCard, { backgroundColor: withAlpha(surface, 0.3), borderColor: border }]}>
					{pendingProposals.map((proposal, proposalIndex) => {
						const answerable = answerableIds.has(proposal.id);
						return (
							<View key={proposal.id}>
								{proposalIndex > 0 ? (
									<View style={[styles.groupSeparator, { backgroundColor: border }]} />
								) : null}
							<View style={styles.proposalRow}>
								{answerable ? (
									<View style={[styles.pendingDot, { backgroundColor: warning }]} />
								) : null}
								<View style={styles.proposalText}>
									<ThemedText type="body" numberOfLines={2}>
										{proposal.title}
									</ThemedText>
									<ThemedText
										type="caption"
										selectable
										style={{ color: answerable ? muted : warning }}
									>
										{formatProposalWhen(proposal)}
										{answerable ? "" : " · Waiting on them"}
									</ThemedText>
								</View>
								{answerable ? (
									<View style={styles.proposalActions}>
										<Button
											label="Accept"
											size="sm"
											disabled={resolvingProposalId !== null}
											onPress={() =>
												void handleResolveProposal(proposal.id, "accept")
											}
										/>
										<Button
											label="Not now"
											variant="ghost"
											size="sm"
											disabled={resolvingProposalId !== null}
											onPress={() =>
												void handleResolveProposal(proposal.id, "decline")
											}
										/>
									</View>
								) : null}
							</View>
							</View>
						);
					})}
					</View>
				)}
			</View>

			<Divider />

			<View style={styles.section}>
				<View style={styles.sectionHeader}>
					<ThemedText type="title">Someday</ThemedText>
					<Button
						label={somedayOpen.length > 3 ? `See all ${somedayOpen.length}` : "Open list"}
						variant="ghost"
						size="sm"
						onPress={handleOpenSomeday}
					/>
				</View>
				{somedayPreview.length === 0 ? (
					<ThemedText type="body" style={{ color: muted }}>
						No someday ideas yet. Save one when it comes to you.
					</ThemedText>
				) : (
					<View style={[styles.groupCard, { backgroundColor: withAlpha(surface, 0.3), borderColor: border }]}>
					{somedayPreview.map((item, itemIndex) => (
						<View key={item.id}>
							{itemIndex > 0 ? (
								<View style={[styles.groupSeparator, { backgroundColor: border }]} />
							) : null}
						<Pressable
							accessibilityLabel={`Open Someday list`}
							accessibilityRole="button"
							onPress={handleOpenSomeday}
							style={({ pressed }) => [
								styles.row,
								pressed ? styles.pressed : undefined,
							]}
						>
							<ThemedText type="body" style={styles.rowTitle}>
								{item.title}
							</ThemedText>
							<Ionicons color={muted} name="chevron-forward" size={16} />
						</Pressable>
						</View>
					))}
					</View>
				)}
			</View>

			<Divider />

			<View style={styles.section}>
				<View style={styles.sectionHeader}>
					<ThemedText type="title">Future goals</ThemedText>
					<Button
						label="New goal"
						variant="ghost"
						size="sm"
						onPress={handleNewGoal}
					/>
				</View>
				{goals === null ? (
					<ThemedText type="body" style={{ color: muted }}>
						Loading goals…
					</ThemedText>
				) : goals.length === 0 ? (
					<ThemedText type="body" style={{ color: muted }}>
						Nothing you are dreaming toward yet.
					</ThemedText>
				) : (
					<View style={[styles.groupCard, { backgroundColor: withAlpha(surface, 0.3), borderColor: border }]}>
					{goals.map((goal, index) => (
						<View key={goal.id}>
							{index > 0 ? (
								<View
									style={[styles.groupSeparator, { backgroundColor: border }]}
								/>
							) : null}
							<Pressable
								accessibilityLabel={`Open goal ${goal.title}`}
								accessibilityRole="button"
								onPress={() => handleOpenGoal(goal.id)}
								style={({ pressed }) => [
									styles.row,
									pressed ? styles.pressed : undefined,
								]}
							>
								<ThemedText type="body" style={styles.rowTitle}>
									{goal.title.trim() || "Untitled goal"}
								</ThemedText>
								<ThemedText type="caption" style={{ color: muted }}>
									{getGoalHorizon(goal, now)}
								</ThemedText>
								<Ionicons color={muted} name="chevron-forward" size={16} />
							</Pressable>
						</View>
					))}
					</View>
				)}
			</View>

		</ScrollView>
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
	scroll: {
		flex: 1,
	},
	content: {
		paddingHorizontal: Spacing[24],
		gap: Spacing[32],
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
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: Radii.lg,
		paddingHorizontal: Spacing[12],
		paddingVertical: Spacing[12],
		gap: Spacing[8],
	},
	monthNav: {
		flexDirection: "row",
		alignItems: "center",
		gap: Spacing[4],
	},
	monthTitle: {
		flex: 1,
		textAlign: "center",
		fontSize: 22,
		lineHeight: 28,
	},
	weekdayRow: {
		flexDirection: "row",
		gap: Spacing[4],
		paddingBottom: Spacing[8],
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
		borderRadius: Radii.sm,
		paddingVertical: 4,
		alignItems: "center",
		justifyContent: "center",
		gap: 2,
		overflow: "hidden",
	},
	dayNumber: {
		minWidth: 28,
		minHeight: 28,
		borderRadius: 14,
		alignItems: "center",
		justifyContent: "center",
		paddingHorizontal: 4,
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
	todayUnderline: {
		width: 16,
		height: 2,
		borderRadius: 1,
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
