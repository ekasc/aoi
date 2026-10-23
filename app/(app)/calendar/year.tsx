import { useCallback, useMemo } from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { YearPager } from '@/components/calendar/year-pager';
import { useCalendar } from '@/features/calendar/calendar-context';
import { startOfMonth } from '@/features/calendar/calendar-date-utils';
import { useThemeColor } from '@/hooks/use-theme-color';

/**
 * The year at a glance: twelve months as small calendars, the current year
 * opened first, days holding plans dotted, and a tap on any month returns to
 * it in the calendar.
 */
export default function CalendarYearScreen() {
	const router = useRouter();
	const { selectedDate, setSelectedDate, setVisibleMonth } = useCalendar();
	const background = useThemeColor({}, 'background');
	const { width: windowWidth } = useWindowDimensions();

	const now = useMemo(() => new Date(), []);
	const thisYear = now.getFullYear();


	const openMonth = useCallback(
		(month: Date) => {
			setVisibleMonth(startOfMonth(month));
			setSelectedDate(startOfMonth(month));
			router.back();
		},
		[router, setSelectedDate, setVisibleMonth],
	);


	return (
		<View style={[styles.root, { backgroundColor: background }]}>
			<YearPager initialYear={thisYear} now={now} onOpen={openMonth} selectedDate={selectedDate} width={windowWidth} />
		</View>
	);
}

const styles = StyleSheet.create({
	root: {
		flex: 1,
	},
});
