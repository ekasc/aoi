import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppState, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
	buildMonthGrid,
	findCountdownEvent,
	formatAnniversaryLabel,
	formatCountdownLabel,
	formatDateTitle,
	formatEventTimeLabel,
	formatMonthTitle,
	formatTimeRange,
	formatWeekdayShort,
	getAnniversaryForDate,
	getAnniversaryMarkers,
	groupAgendaEvents,
	isSameDay,
	isSameMonth,
	toDayKey,
} from "@/features/calendar/calendar-date-utils";
import {
	useCalendar,
	useCalendarMonthNavigation,
} from "@/features/calendar/calendar-context";
import {
	getAnswerableProposals,
	formatProposalWhen,
} from "@/features/proposals/proposal-time";
import { useProposals } from "@/features/proposals/proposals-context";
import { ThemedText } from "@/components/themed-text";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Surface } from "@/components/ui/surface";
import { Radii, Spacing } from "@/constants/theme";
import { useSpace } from "@/features/space/space-context";
import { useThemeColor } from "@/hooks/use-theme-color";

type CalendarViewMode = "day" | "agenda";

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
		upcomingEvents,
		setSelectedDate,
		isLoading,
		refresh: refreshCalendar,
	} = useCalendar();
	const { goToPreviousMonth, goToNextMonth } = useCalendarMonthNavigation();
	const {
		proposals,
		accept: acceptProposal,
		decline: declineProposal,
		reload: reloadProposals,
	} = useProposals();
	const { space } = useSpace();
	const [viewMode, setViewMode] = useState<CalendarViewMode>("day");
	const [resolvingProposalId, setResolvingProposalId] = useState<string | null>(null);
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

	const [now, setNow] = useState(() => new Date());

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

	const countdownLabel = useMemo(
		() => formatCountdownLabel(findCountdownEvent(upcomingEvents, now)),
		[now, upcomingEvents],
	);
	const anniversaryTodayLabel = useMemo(
		() =>
			formatAnniversaryLabel(
				getAnniversaryForDate(space?.relationshipStartDate, now),
			),
		[now, space?.relationshipStartDate],
	);
	const anniversaryMarkersByDay = useMemo(() => {
		const map: Record<string, "monthly" | "yearly"> = {};
		const markers = getAnniversaryMarkers(
			space?.relationshipStartDate,
			visibleMonth,
		);
		for (const marker of markers) {
			map[toDayKey(marker.date)] = marker.kind;
		}
		return map;
	}, [space?.relationshipStartDate, visibleMonth]);
	const agendaDays = useMemo(
		() => groupAgendaEvents(upcomingEvents, now),
		[now, upcomingEvents],
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

	// Suggestions are only ever answerable when they are the partner's and
	// still pending — yours wait for them, quietly.
	const answerableProposals = useMemo(
		() => getAnswerableProposals(proposals),
		[proposals],
	);

	const handleProposeTime = useCallback(() => {
		router.push({ pathname: "/(app)/proposal/new" });
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
				// Calm — re-read the list in case it was answered elsewhere.
				void reloadProposals();
			} finally {
				setResolvingProposalId(null);
			}
		},
		[acceptProposal, declineProposal, refreshCalendar, reloadProposals],
	);
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

			{countdownLabel || anniversaryTodayLabel ? (
				<View style={styles.quietLanes}>
					{anniversaryTodayLabel ? (
						<ThemedText
							type="caption"
							selectable
							style={{ color: accent }}
						>
							{anniversaryTodayLabel}
						</ThemedText>
					) : null}
					{countdownLabel ? (
						<ThemedText
							type="caption"
							selectable
							style={{ color: muted }}
						>
							{countdownLabel}
						</ThemedText>
					) : null}
				</View>
			) : null}

			{answerableProposals.length > 0 ? (
				<Surface variant="glass" style={styles.proposalsPanel}>
					<ThemedText type="meta" selectable>
						They suggested a time
					</ThemedText>
					{answerableProposals.map((proposal) => (
						<View key={proposal.id} style={styles.proposalRow}>
							<View style={styles.proposalText}>
								<ThemedText type="body" numberOfLines={2}>
									{proposal.title}
								</ThemedText>
								<ThemedText
									type="caption"
									selectable
									style={{ color: muted }}
								>
									{formatProposalWhen(proposal)}
								</ThemedText>
							</View>
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
						</View>
					))}
				</Surface>
			) : null}

			<Pressable
				accessibilityLabel="Suggest a time for the two of you"
				accessibilityRole="button"
				onPress={handleProposeTime}
				style={styles.proposeEntry}
			>
				<ThemedText type="caption" style={{ color: muted }}>
					Suggest a time for the two of you
				</ThemedText>
			</Pressable>

			<Surface variant="glass" style={styles.calendarPanel}>
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
								// Dots belong to the visible month only —
								// never on adjacent-month grid cells.
								const anniversaryKind = isCurrentMonth
									? anniversaryMarkersByDay[dayKey]
									: undefined;

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
										<View style={styles.dayNumberRow}>
											<ThemedText
												type="caption"
												style={{ color: dayTextColor }}
											>
												{day.getDate()}
											</ThemedText>
											{anniversaryKind ? (
												<View
													accessibilityLabel={
														anniversaryKind === "yearly"
															? "Yearly anniversary"
															: "Monthly anniversary"
													}
													style={[
														styles.anniversaryDot,
														{
															backgroundColor:
																anniversaryKind ===
																"yearly"
																	? accent
																	: muted,
														},
													]}
												/>
											) : null}
										</View>
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

			<View style={styles.viewToggle}>
				{(["day", "agenda"] as const).map((mode) => {
					const selected = viewMode === mode;
					return (
						<Pressable
							accessibilityLabel={
								mode === "day"
									? "Show day view"
									: "Show agenda view"
							}
							accessibilityRole="button"
							accessibilityState={{ selected }}
							key={mode}
							onPress={() => setViewMode(mode)}
							style={[
								styles.viewToggleChip,
								{
									borderColor: selected ? accent : border,
									backgroundColor: selected
										? accent
										: surface,
								},
							]}
						>
							<ThemedText
								type="caption"
								style={{
									color: selected ? onAccent : muted,
								}}
							>
								{mode === "day" ? "Day" : "Agenda"}
							</ThemedText>
						</Pressable>
					);
				})}
			</View>

			{viewMode === "agenda" ? (
				<Surface style={styles.agendaPanel}>
					{isLoading ? (
						<ThemedText type="body">Loading plans…</ThemedText>
					) : agendaDays.length === 0 ? (
						<ThemedText
							type="body"
							selectable
							style={{ color: muted }}
						>
							Nothing planned yet — the days are open.
						</ThemedText>
					) : (
						agendaDays.map((agendaDay) => (
							<View
								key={agendaDay.key}
								style={styles.agendaGroup}
							>
								<ThemedText type="meta" selectable>
									{agendaDay.label}
								</ThemedText>
								{agendaDay.events.map((event) => (
									<Pressable
										accessibilityLabel={`Open event ${event.title}`}
										accessibilityRole="button"
										key={event.id}
										onPress={() =>
											router.push(
												`/(app)/calendar/edit/${event.id}`,
											)
										}
										style={styles.agendaRow}
									>
										<ThemedText
											type="caption"
											style={[
												styles.agendaTime,
												{ color: muted },
											]}
										>
											{formatEventTimeLabel(event)}
										</ThemedText>
										<ThemedText
											type="body"
											numberOfLines={1}
											style={styles.agendaTitle}
										>
											{event.title}
										</ThemedText>
										<View
											style={[
												styles.actorHint,
												{
													backgroundColor:
														event.actor === "you"
															? accent
															: partnerAccent,
												},
											]}
										/>
									</Pressable>
								))}
							</View>
						))
					)}
				</Surface>
			) : null}

			{viewMode === "day" ? (
				<>
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
							<ThemedText type="body" style={{ color: muted }}>No plans yet.</ThemedText>
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
												{event.allDay
													? "All day"
													: formatTimeRange(
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
				</>
			) : null}
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	contentContainer: {
		paddingHorizontal: Spacing[16],
		paddingBottom: Spacing[24],
		gap: Spacing[16],
	},
	headerRow: {
		flexDirection: "row",
		justifyContent: "space-between",
		alignItems: "center",
		gap: Spacing[12],
		marginBottom: Spacing[4],
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
		marginTop: Spacing[4],
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
	quietLanes: {
		gap: Spacing[4],
	},
	proposalsPanel: {
		gap: Spacing[12],
		borderRadius: 18,
	},
	proposalRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: Spacing[12],
	},
	proposalText: {
		flex: 1,
		gap: Spacing[4],
	},
	proposalActions: {
		flexDirection: "row",
		gap: Spacing[8],
	},
	proposeEntry: {
		alignSelf: "flex-start",
		paddingVertical: Spacing[4],
		paddingRight: Spacing[16],
	},
	dayNumberRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: 4,
	},
	anniversaryDot: {
		width: 6,
		height: 6,
		borderRadius: Radii.pill,
	},
	viewToggle: {
		flexDirection: "row",
		gap: Spacing[8],
	},
	viewToggleChip: {
		minHeight: 36,
		borderRadius: Radii.pill,
		borderWidth: StyleSheet.hairlineWidth,
		paddingHorizontal: Spacing[16],
		alignItems: "center",
		justifyContent: "center",
	},
	agendaPanel: {
		gap: Spacing[16],
		borderRadius: 18,
	},
	agendaGroup: {
		gap: Spacing[8],
	},
	agendaRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: Spacing[12],
		minHeight: 40,
	},
	agendaTime: {
		width: 76,
		fontVariant: ["tabular-nums"],
	},
	agendaTitle: {
		flex: 1,
	},
});
