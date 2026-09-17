import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import {
	FlatList,
	Pressable,
	StyleSheet,
	useWindowDimensions,
	View,
} from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useCalendar } from '@/features/calendar/calendar-context';
import {
	buildMonthGrid,
	formatMonthTitle,
	isSameDay,
	isSameMonth,
	startOfMonth,
	toDayKey,
} from '@/features/calendar/calendar-date-utils';
import { useThemeColor } from '@/hooks/use-theme-color';

/** Every row is the same fixed height, so the list opens on this year without
 *  measuring anything: the constant sets the layout instead of guessing it. */
const MINI_WEEKS = 6;
const MINI_ROW_HEIGHT = 13;
const MINI_NAME_HEIGHT = 18;
const MINI_MONTH_HEIGHT = MINI_NAME_HEIGHT + MINI_WEEKS * MINI_ROW_HEIGHT;
const MINI_GAP = Spacing[12];
const YEAR_TITLE_HEIGHT = 34;
const YEAR_SECTION_PADDING = Spacing[16];
const YEAR_SECTION_HEIGHT =
	YEAR_SECTION_PADDING * 2 +
	YEAR_TITLE_HEIGHT +
	4 * MINI_MONTH_HEIGHT +
	3 * MINI_GAP;
/** Years either side of this one, so the list has room without an end. */
const YEARS_EITHER_SIDE = 8;

/** The month laid out as weeks, padded to a constant six rows. */
function weeksOf(month: Date): Date[][] {
	const days = buildMonthGrid(month);
	const weeks: Date[][] = [];
	for (let index = 0; index < days.length; index += 7) {
		weeks.push(days.slice(index, index + 7));
	}
	while (weeks.length < MINI_WEEKS) {
		weeks.push([]);
	}
	return weeks.slice(0, MINI_WEEKS);
}

type MiniMonthProps = {
	month: Date;
	/** Three to a row, so the caller owns the width. */
	width: number;
	now: Date;
	selectedDate: Date;
	/** Day keys that hold plans, or null while they are being read. */
	daysWithPlans: Set<string> | null;
	onOpen: (month: Date) => void;
};

function MiniMonth({
	month,
	width,
	now,
	selectedDate,
	daysWithPlans,
	onOpen,
}: MiniMonthProps) {
	const accent = useThemeColor({}, 'accent');
	const muted = useThemeColor({}, 'muted');
	const textColor = useThemeColor({}, 'text');
	const weeks = useMemo(() => weeksOf(month), [month]);

	return (
		<Pressable
			accessibilityHint="Opens the month in the calendar"
			accessibilityLabel={`Open ${formatMonthTitle(month)}`}
			accessibilityRole="button"
			onPress={() => onOpen(month)}
			style={[styles.miniMonth, { width }]}
		>
			<ThemedText numberOfLines={1} type="caption" style={styles.miniName}>
				{month.toLocaleDateString('en-US', { month: 'long' })}
			</ThemedText>
			{weeks.map((week, weekIndex) => (
				<View key={`${month.getMonth()}:${weekIndex}`} style={styles.miniWeek}>
					{week.map((day) => {
						const inMonth = isSameMonth(day, month);
						const isToday = isSameDay(day, now);
						const isSelected = isSameDay(day, selectedDate);
						return (
							<View key={day.toISOString()} style={styles.miniDay}>
								<ThemedText
									style={[
										styles.miniDayText,
										{
											color: isToday || isSelected ? accent : textColor,
											fontWeight: isToday || isSelected ? '700' : '400',
											opacity: inMonth ? 1 : 0.35,
										},
									]}
								>
									{day.getDate()}
								</ThemedText>
								{/* A day that holds plans carries a dot, the same signal
								    the month grid gives. */}
								{daysWithPlans?.has(toDayKey(day)) ? (
									<View
										accessible={false}
										style={[styles.miniDot, { backgroundColor: accent }]}
										testID={`plans:${toDayKey(day)}`}
									/>
								) : (
									<View accessible={false} style={styles.miniDot} />
								)}
							</View>
						);
					})}
				</View>
			))}
			<View style={[styles.miniRule, { backgroundColor: muted, opacity: 0.25 }]} />
		</Pressable>
	);
}

type YearSectionProps = {
	year: number;
	width: number;
	now: Date;
	selectedDate: Date;
	onOpen: (month: Date) => void;
	/** Stagger, so seventeen years do not all animate at once. */
	index: number;
	reduceMotion: boolean;
};

function YearSection({
	year,
	width,
	now,
	selectedDate,
	onOpen,
	index,
	reduceMotion,
}: YearSectionProps) {
	const { eventsInRange } = useCalendar();
	const muted = useThemeColor({}, 'muted');
	const [daysWithPlans, setDaysWithPlans] = useState<Set<string> | null>(null);
	const [failed, setFailed] = useState(false);

	// Each year reads its own density as it mounts, so scrolling costs nothing
	// for years nobody is looking at.
	useEffect(() => {
		let live = true;
		setFailed(false);
		setDaysWithPlans(null);
		eventsInRange(new Date(year, 0, 1), new Date(year + 1, 0, 1))
			.then((events) => {
				if (!live) {
					return;
				}
				setDaysWithPlans(
					new Set(events.map((event) => toDayKey(new Date(event.startsAt)))),
				);
			})
			.catch(() => {
				if (live) {
					setFailed(true);
				}
			});
		return () => {
			live = false;
		};
	}, [eventsInRange, year]);

	return (
		<MotiView
			animate={{ opacity: 1, translateY: 0 }}
			from={{ opacity: 0, translateY: reduceMotion ? 0 : 12 }}
			style={[styles.yearSection, { height: YEAR_SECTION_HEIGHT }]}
			transition={{
				delay: reduceMotion ? 0 : Math.min(index, 4) * 40,
				duration: reduceMotion ? 0 : 240,
				type: 'timing',
			}}
		>
			<View style={styles.yearHeader}>
				<ThemedText type="subheading">{year}</ThemedText>
				{failed ? (
					<ThemedText
						accessibilityLiveRegion="polite"
						type="caption"
						style={{ color: muted }}
					>
						Could not load plans
					</ThemedText>
				) : null}
			</View>
			<View style={styles.yearGrid}>
				{Array.from({ length: 12 }, (_, monthIndex) => (
					<MiniMonth
						key={monthIndex}
						daysWithPlans={daysWithPlans}
						month={new Date(year, monthIndex, 1)}
						now={now}
						onOpen={onOpen}
						selectedDate={selectedDate}
						width={width}
					/>
				))}
			</View>
		</MotiView>
	);
}

/**
 * The year at a glance: twelve months as small calendars, the current year
 * opened first, days holding plans dotted, and a tap on any month returns to
 * it in the calendar.
 */
export default function CalendarYearScreen() {
	const router = useRouter();
	const reduceMotion = useReducedMotion();
	const { selectedDate, setSelectedDate, setVisibleMonth } = useCalendar();
	const background = useThemeColor({}, 'background');
	const { width: windowWidth } = useWindowDimensions();
	// Three to a row with the gaps taken out of the width first: percentages
	// plus gaps overflow and wrap the third month onto its own line.
	const miniWidth =
		(windowWidth - YEAR_SECTION_PADDING * 2 - MINI_GAP * 2) / 3;
	const now = useMemo(() => new Date(), []);
	const thisYear = now.getFullYear();

	const years = useMemo(
		() =>
			Array.from({ length: YEARS_EITHER_SIDE * 2 + 1 }, (_, index) =>
				thisYear + index - YEARS_EITHER_SIDE,
			),
		[thisYear],
	);

	const openMonth = useCallback(
		(month: Date) => {
			setVisibleMonth(startOfMonth(month));
			setSelectedDate(startOfMonth(month));
			router.back();
		},
		[router, setSelectedDate, setVisibleMonth],
	);

	const renderYear = useCallback(
		({ item, index }: { item: number; index: number }) => (
			<YearSection
				index={index}
				now={now}
				onOpen={openMonth}
				reduceMotion={reduceMotion}
				selectedDate={selectedDate}
				width={miniWidth}
				year={item}
			/>
		),
		[miniWidth, now, reduceMotion, openMonth, selectedDate],
	);

	return (
		<View style={[styles.root, { backgroundColor: background }]}>
			{/* A fixed row height, so the opening offset is arithmetic on that
			    height and the list lands on this year without measuring. */}
			<FlatList
				data={years}
				getItemLayout={(_, index) => ({
					index,
					length: YEAR_SECTION_HEIGHT,
					offset: YEAR_SECTION_HEIGHT * index,
				})}
				initialNumToRender={1}
				initialScrollIndex={YEARS_EITHER_SIDE}
				keyExtractor={(year) => String(year)}
				removeClippedSubviews
				renderItem={renderYear}
				showsVerticalScrollIndicator={false}
				windowSize={5}
			/>
		</View>
	);
}

const styles = StyleSheet.create({
	miniDay: {
		alignItems: 'center',
		flex: 1,
		height: MINI_ROW_HEIGHT,
		justifyContent: 'center',
	},
	miniDot: {
		borderRadius: 999,
		height: 3,
		marginTop: 1,
		width: 3,
	},
	miniDayText: {
		fontSize: 10,
		fontVariant: ['tabular-nums'],
	},
	miniMonth: {
		height: MINI_MONTH_HEIGHT,
	},
	miniName: {
		height: MINI_NAME_HEIGHT,
	},
	miniRule: {
		height: StyleSheet.hairlineWidth,
		marginTop: Spacing[4],
	},
	miniWeek: {
		flexDirection: 'row',
	},
	root: {
		flex: 1,
	},
	yearGrid: {
		flexDirection: 'row',
		flexWrap: 'wrap',
		gap: MINI_GAP,
		rowGap: MINI_GAP,
	},
	yearHeader: {
		alignItems: 'baseline',
		flexDirection: 'row',
		gap: Spacing[8],
		height: YEAR_TITLE_HEIGHT,
	},
	yearSection: {
		paddingHorizontal: YEAR_SECTION_PADDING,
		paddingTop: YEAR_SECTION_PADDING,
	},
	yearTitle: {
		height: YEAR_TITLE_HEIGHT,
	},
});
