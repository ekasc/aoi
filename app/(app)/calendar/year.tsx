import { useMemo } from 'react';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import {
	Pressable,
	ScrollView,
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
	onOpen: (month: Date) => void;
};

function MiniMonth({ month, width, now, selectedDate, onOpen }: MiniMonthProps) {
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
							</View>
						);
					})}
				</View>
			))}
			<View style={[styles.miniRule, { backgroundColor: muted, opacity: 0.25 }]} />
		</Pressable>
	);
}

/**
 * The year at a glance: twelve months as small calendars, the current year
 * opened first, and a tap on any month returns to it in the calendar.
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
				new Date(thisYear + index - YEARS_EITHER_SIDE, 0, 1),
			),
		[thisYear],
	);

	const openMonth = (month: Date) => {
		setVisibleMonth(startOfMonth(month));
		setSelectedDate(startOfMonth(month));
		router.back();
	};

	return (
		<View style={[styles.root, { backgroundColor: background }]}>
			<ScrollView
				contentOffset={{ x: 0, y: YEARS_EITHER_SIDE * YEAR_SECTION_HEIGHT }}
				showsVerticalScrollIndicator={false}
			>
				{years.map((year, yearIndex) => (
					<MotiView
						animate={{ opacity: 1, translateY: 0 }}
						from={{
							opacity: 0,
							translateY: reduceMotion ? 0 : 12,
						}}
						key={year.getFullYear()}
						style={[styles.yearSection, { height: YEAR_SECTION_HEIGHT }]}
						transition={{
							delay: reduceMotion ? 0 : Math.min(yearIndex, 4) * 40,
							duration: reduceMotion ? 0 : 240,
							type: 'timing',
						}}
					>
						<ThemedText type="subheading" style={styles.yearTitle}>
							{year.getFullYear()}
						</ThemedText>
						<View style={styles.yearGrid}>
							{Array.from({ length: 12 }, (_, monthIndex) => (
								<MiniMonth
									key={monthIndex}
									month={new Date(year.getFullYear(), monthIndex, 1)}
									width={miniWidth}
									now={now}
									onOpen={openMonth}
									selectedDate={selectedDate}
								/>
							))}
						</View>
					</MotiView>
				))}
			</ScrollView>
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
	yearSection: {
		paddingHorizontal: YEAR_SECTION_PADDING,
		paddingTop: YEAR_SECTION_PADDING,
	},
	yearTitle: {
		height: YEAR_TITLE_HEIGHT,
	},
});
