import { useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
	buildMonthGrid,
	formatDateTitle,
	formatMonthTitle,
	formatTimeRange,
	formatWeekdayShort,
	isSameDay,
	isSameMonth,
	toDayKey,
} from "@/features/calendar/calendar-date-utils";
import {
	useCalendar,
	useCalendarMonthNavigation,
} from "@/features/calendar/calendar-context";
import { ThemedText } from "@/components/themed-text";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Surface } from "@/components/ui/surface";
import { Spacing } from "@/constants/theme";
import { useThemeColor } from "@/hooks/use-theme-color";

function buildMonthWeeks(days: Date[]) {
	const weeks: Date[][] = [];

	for (let index = 0; index < days.length; index += 7) {
		weeks.push(days.slice(index, index + 7));
	}

	return weeks;
}

export default function CalendarScreen() {
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const {
		selectedDate,
		visibleMonth,
		monthSummary,
		eventsForDay,
		setSelectedDate,
		isLoading,
	} = useCalendar();
	const { goToPreviousMonth, goToNextMonth } = useCalendarMonthNavigation();
	const textColor = useThemeColor({}, "text");
	const muted = useThemeColor({}, "muted");
	const border = useThemeColor({}, "border");
	const surface = useThemeColor({}, "surface");
	const surface2 = useThemeColor({}, "surface2");
	const accent = useThemeColor({}, "accent");
	const partnerAccent = useThemeColor({}, "partnerAccent");
	const onAccent = useThemeColor({}, "onAccent");
	const background = useThemeColor({}, "background");

	const monthTitle = useMemo(
		() => formatMonthTitle(visibleMonth),
		[visibleMonth],
	);
	const monthGrid = useMemo(
		() => buildMonthGrid(visibleMonth),
		[visibleMonth],
	);
	const monthWeeks = useMemo(() => buildMonthWeeks(monthGrid), [monthGrid]);
	const weekdayLabels = useMemo(
		() =>
			(monthWeeks[0] ?? monthGrid.slice(0, 7)).map((day) =>
				formatWeekdayShort(day),
			),
		[monthGrid, monthWeeks],
	);
	const selectedDayEvents = useMemo(
		() => eventsForDay[toDayKey(selectedDate)] ?? [],
		[eventsForDay, selectedDate],
	);
	const selectedDateTitle = useMemo(
		() => formatDateTitle(selectedDate),
		[selectedDate],
	);
	const selectedDateIso = useMemo(
		() => selectedDate.toISOString(),
		[selectedDate],
	);

	const handleSelectDate = useCallback(
		(date: Date) => {
			setSelectedDate(date);
		},
		[setSelectedDate],
	);
	const handleAddEvent = useCallback(() => {
		router.push({
			pathname: "/(app)/calendar/new-event",
			params: { date: selectedDateIso },
		});
	}, [router, selectedDateIso]);
	const contentContainerStyle = useMemo(
		() => [
			styles.contentContainer,
			{
				paddingTop: insets.top + Spacing[8],
				paddingBottom: insets.bottom + Spacing[16],
			},
		],
		[insets.bottom, insets.top],
	);

	return (
		<ScrollView
			style={{ backgroundColor: background }}
			contentContainerStyle={contentContainerStyle}
			contentInsetAdjustmentBehavior="automatic"
			showsVerticalScrollIndicator={false}
		>
			<View style={styles.headerRow}>
				<View style={styles.monthNav}>
					<IconButton
						accessibilityLabel="Previous month"
						variant="secondary"
						label="Previous month"
						onPress={goToPreviousMonth}
					>
						{"‹"}
					</IconButton>
					<View style={styles.headerText}>
						<ThemedText type="meta" selectable>
							Time together
						</ThemedText>
						<ThemedText type="title" selectable>
							{monthTitle}
						</ThemedText>
					</View>
					<IconButton
						accessibilityLabel="Next month"
						variant="secondary"
						label="Next month"
						onPress={goToNextMonth}
					>
						{"›"}
					</IconButton>
				</View>
				<Button label="Add event" onPress={handleAddEvent} />
			</View>

			<Surface variant="raised" style={styles.calendarPanel}>
				<View style={styles.weekdayRow}>
					{weekdayLabels.map((label) => (
						<View key={label} style={styles.weekdayCell}>
							<ThemedText type="meta" style={{ color: muted }}>
								{label}
							</ThemedText>
						</View>
					))}
				</View>

				<View style={styles.grid}>
					{monthWeeks.map((week) => (
						<View key={toDayKey(week[0])} style={styles.weekRow}>
							{week.map((day) => {
								const dayKey = toDayKey(day);
								const summary = monthSummary[dayKey];
								const isSelected = isSameDay(day, selectedDate);
								const isCurrentMonth = isSameMonth(
									day,
									visibleMonth,
								);
								const dayTextColor = isSelected
									? onAccent
									: isCurrentMonth
										? textColor
										: muted;
								const dayBackground = isSelected
									? accent
									: surface;
								const count = summary?.total ?? 0;

								return (
									<Pressable
										accessibilityLabel={`Select ${formatDateTitle(day)}`}
										accessibilityRole="button"
										key={dayKey}
										onPress={() => handleSelectDate(day)}
										style={[
											styles.dayCell,
											{
												borderColor: isSelected
													? accent
													: border,
												backgroundColor: dayBackground,
												opacity: isCurrentMonth
													? 1
													: 0.6,
											},
										]}
									>
										<ThemedText
											type="caption"
											style={{ color: dayTextColor }}
										>
											{day.getDate()}
										</ThemedText>
										{count > 0 ? (
											<View
												style={[
													styles.countBadge,
													{
														backgroundColor:
															surface2,
													},
												]}
											>
												<ThemedText
													type="meta"
													selectable
													style={{
														color: muted,
														fontVariant: [
															"tabular-nums",
														],
													}}
												>
													{count}
												</ThemedText>
											</View>
										) : null}
										<View style={styles.actorHintRow}>
											{summary?.youCount ? (
												<View
													style={[
														styles.actorHint,
														{
															backgroundColor:
																accent,
														},
													]}
												/>
											) : null}
											{summary?.partnerCount ? (
												<View
													style={[
														styles.actorHint,
														{
															backgroundColor:
																partnerAccent,
														},
													]}
												/>
											) : null}
										</View>
									</Pressable>
								);
							})}
						</View>
					))}
				</View>
			</Surface>

			<View style={styles.agendaHeader}>
				<ThemedText type="meta" selectable>
					Today&apos;s plans
				</ThemedText>
				<ThemedText type="title" selectable>
					{selectedDateTitle}
				</ThemedText>
			</View>

			{isLoading ? (
				<Surface style={styles.emptyState}>
					<ThemedText type="body">Loading events…</ThemedText>
				</Surface>
			) : null}

			{!isLoading && selectedDayEvents.length === 0 ? (
				<Surface style={styles.emptyState}>
					<ThemedText type="body">No plans yet. Add something to look forward to.</ThemedText>
					<Button
						accessibilityLabel={`Add event for ${selectedDateTitle}`}
						label="Add event"
						onPress={handleAddEvent}
						variant="secondary"
					/>
				</Surface>
			) : null}

			{!isLoading
				? selectedDayEvents.map((event) => {
						const eventLabel =
							event.label.customText?.trim() ||
							event.label.preset;
						return (
							<Pressable
								accessibilityLabel={`Open event ${event.title}`}
								accessibilityRole="button"
								key={event.id}
								onPress={() =>
									router.push(
										`/(app)/calendar/edit/${event.id}`,
									)
								}
							>
								<Surface style={styles.eventCard}>
									<View style={styles.eventTopRow}>
										<ThemedText type="title">
											{event.title}
										</ThemedText>
										<View
											style={[
												styles.actorPill,
												{
													backgroundColor:
														event.actor === "you"
															? accent
															: partnerAccent,
												},
											]}
										>
											<ThemedText
												type="meta"
												style={{ color: onAccent }}
											>
												{event.actor === "you"
													? "You"
													: event.actorName}
											</ThemedText>
										</View>
									</View>
									<ThemedText
										type="caption"
										selectable
										style={{ color: muted }}
									>
										{formatTimeRange(
											event.startsAt,
											event.endsAt,
										)}
									</ThemedText>
									<ThemedText
										type="caption"
										style={{ color: muted }}
									>
										{eventLabel}
									</ThemedText>
								</Surface>
							</Pressable>
						);
					})
				: null}
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	contentContainer: {
		paddingHorizontal: Spacing[16],
		paddingBottom: Spacing[24],
		gap: Spacing[12],
	},
	headerRow: {
		flexDirection: "row",
		justifyContent: "space-between",
		alignItems: "center",
		gap: Spacing[12],
	},
	monthNav: {
		flexDirection: "row",
		alignItems: "center",
		gap: Spacing[8],
		flex: 1,
	},
	headerText: {
		gap: Spacing[4],
	},
	calendarPanel: {
		gap: Spacing[12],
		borderRadius: 24,
	},
	weekdayRow: {
		flexDirection: "row",
		gap: Spacing[8],
	},
	weekdayCell: {
		flex: 1,
		alignItems: "center",
	},
	grid: {
		gap: Spacing[8],
	},
	weekRow: {
		flexDirection: "row",
		gap: Spacing[8],
	},
	dayCell: {
		flex: 1,
		minHeight: 58,
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: 14,
		paddingHorizontal: 8,
		paddingVertical: 6,
		justifyContent: "space-between",
	},
	countBadge: {
		alignSelf: "flex-start",
		borderRadius: 999,
		paddingHorizontal: 7,
		paddingVertical: 2,
	},
	actorHintRow: {
		flexDirection: "row",
		gap: 4,
	},
	actorHint: {
		width: 7,
		height: 7,
		borderRadius: 999,
	},
	agendaHeader: {
		gap: Spacing[4],
	},
	emptyState: {
		gap: Spacing[4],
	},
	eventCard: {
		gap: Spacing[4],
		borderRadius: 18,
	},
	eventTopRow: {
		flexDirection: "row",
		justifyContent: "space-between",
		alignItems: "center",
		gap: Spacing[8],
	},
	actorPill: {
		borderRadius: 999,
		paddingHorizontal: 9,
		paddingVertical: 4,
	},
});
