import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	FlatList,
	StyleSheet,
	View,
	type ListRenderItemInfo,
	type NativeScrollEvent,
	type NativeSyntheticEvent,
	type ViewToken,
} from "react-native";
import Animated, { FadeInDown, ReduceMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MomentCard } from "@/components/moments/moment-card";
import { ThemedText } from "@/components/themed-text";
import { IconButton } from "@/components/ui/icon-button";
import { Surface } from "@/components/ui/surface";
import { Motion, Spacing } from "@/constants/theme";
import {
	getGoalHorizon,
	isUpcomingGoal,
} from "@/features/moments/moment-goal-utils";
import { useMoments } from "@/features/moments/moments-context";
import type { Moment } from "@/features/moments/types";
import { useThemeColor } from "@/hooks/use-theme-color";
import { useSpace } from "@/features/space/space-context";

function ListSpacer() {
	return <View style={styles.listSpacer} />;
}

function formatPeriodLabel(date: Date) {
	return date.toLocaleDateString("en-US", {
		month: "long",
		year: "numeric",
	});
}

function formatGoalDateLabel(targetAt?: string | null) {
	if (!targetAt) {
		return "Someday";
	}

	const targetDate = new Date(targetAt);

	if (Number.isNaN(targetDate.getTime())) {
		return "Someday";
	}

	return targetDate.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

function compareUpcomingGoals(left: Moment, right: Moment) {
	const leftTarget = left.targetAt
		? new Date(left.targetAt).getTime()
		: Number.POSITIVE_INFINITY;
	const rightTarget = right.targetAt
		? new Date(right.targetAt).getTime()
		: Number.POSITIVE_INFINITY;

	if (leftTarget !== rightTarget) {
		return leftTarget - rightTarget;
	}

	return (
		new Date(left.occurredAt).getTime() -
		new Date(right.occurredAt).getTime()
	);
}

function formatTimelineContextLabel(occurredAt: string) {
	const date = new Date(occurredAt);

	if (Number.isNaN(date.getTime())) {
		return "Timeline";
	}

	return date.toLocaleDateString("en-US", {
		month: "short",
		year: "numeric",
	});
}

export default function TimelineScreen() {
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const isAndroid = process.env.EXPO_OS === "android";
	const { moments } = useMoments();
	const listRef = useRef<FlatList<Moment> | null>(null);
	const now = useMemo(() => new Date(), []);
	const thread = useThemeColor({}, "thread");
	const muted = useThemeColor({}, "muted");
	const border = useThemeColor({}, "border");
	const surface = useThemeColor({}, "surface");
	const surface2 = useThemeColor({}, "surface2");
	const accent = useThemeColor({}, "accent");
	const background = useThemeColor({}, "background");
	const { space } = useSpace();
	const upcomingGoals = useMemo(
		() =>
			moments
				.filter((moment) => isUpcomingGoal(moment, now))
				.sort(compareUpcomingGoals),
		[moments, now],
	);
	const timelineMoments = useMemo(
		() => moments.filter((moment) => !isUpcomingGoal(moment, now)),
		[moments, now],
	);
	const [hasInitialScroll, setHasInitialScroll] = useState(false);
	const periodLabel = useMemo(() => formatPeriodLabel(new Date()), []);
	const [contextLabel, setContextLabel] = useState(
		upcomingGoals.length > 0 ? "Upcoming goals" : periodLabel,
	);
	const shouldAnimateSections = !isAndroid;

	useEffect(() => {
		setContextLabel(
			upcomingGoals.length > 0 ? "Upcoming goals" : periodLabel,
		);
	}, [periodLabel, upcomingGoals.length]);

	useEffect(() => {
		setHasInitialScroll(false);
	}, [timelineMoments.length]);

	const setContextLabelSafely = useCallback((nextLabel: string) => {
		setContextLabel((currentLabel) =>
			currentLabel === nextLabel ? currentLabel : nextLabel,
		);
	}, []);

	const handleAddMoment = useCallback(() => {
		router.push("/(app)/moment/new");
	}, [router]);

	const keyExtractor = useCallback((item: Moment) => item.id, []);
	const renderItem = useCallback(
		({ item }: ListRenderItemInfo<Moment>) => <MomentCard moment={item} />,
		[],
	);

	const emptyState = useMemo(
		() => (
			<Surface
				style={[
					styles.emptyState,
					{ borderColor: border, backgroundColor: surface },
				]}
			>
				<ThemedText type="title" style={styles.emptyTitle}>
					Start your timeline
				</ThemedText>
				<ThemedText type="caption">
					Add milestones and notes from your story.
				</ThemedText>
			</Surface>
		),
		[border, surface],
	);

	const railStyle = useMemo(
		() => [styles.rail, { backgroundColor: thread }],
		[thread],
	);
	const rootStyle = useMemo(
		() => [
			styles.root,
			{
				backgroundColor: background,
				paddingTop: insets.top + Spacing[8],
			},
		],
		[background, insets.top],
	);
	const contentContainerStyle = useMemo(
		() => [
			styles.contentContainer,
			{ paddingBottom: insets.bottom + Spacing[24] },
		],
		[insets.bottom],
	);
	const contextChipStyle = useMemo(
		() => [
			styles.contextChip,
			{
				borderColor: border,
				backgroundColor: surface2,
			},
		],
		[border, surface2],
	);

	const onViewableItemsChanged = useCallback(
		({ viewableItems }: { viewableItems: ViewToken<Moment>[] }) => {
			const firstVisibleMoment = viewableItems.find(
				(item) => item.isViewable,
			)?.item;

			if (!firstVisibleMoment) {
				return;
			}

			setContextLabelSafely(
				formatTimelineContextLabel(firstVisibleMoment.occurredAt),
			);
		},
		[setContextLabelSafely],
	);

	const viewabilityConfig = useMemo(
		() => ({ itemVisiblePercentThreshold: 45 }),
		[],
	);

	const handleContentSizeChange = useCallback(() => {
		if (hasInitialScroll || timelineMoments.length === 0) {
			return;
		}

		requestAnimationFrame(() => {
			listRef.current?.scrollToEnd({ animated: false });
		});
		setHasInitialScroll(true);
	}, [hasInitialScroll, timelineMoments.length]);

	const handleScroll = useCallback(
		(event: NativeSyntheticEvent<NativeScrollEvent>) => {
			if (upcomingGoals.length === 0) {
				return;
			}

			if (event.nativeEvent.contentOffset.y <= Spacing[24]) {
				setContextLabelSafely("Upcoming goals");
			}
		},
		[setContextLabelSafely, upcomingGoals.length],
	);

	return (
		<View style={rootStyle}>
			<Animated.View
				entering={
					shouldAnimateSections
						? FadeInDown.duration(Motion.slow)
								.delay(20)
								.reduceMotion(ReduceMotion.System)
						: undefined
				}
				style={styles.heroRow}
			>
				<View style={styles.heroText}>
					<ThemedText type="meta" selectable>
						{space?.name}
					</ThemedText>
					<ThemedText type="title" selectable>
						Your moments
					</ThemedText>
					<ThemedText type="caption" style={{ color: muted }}>
						{periodLabel}
					</ThemedText>
				</View>
				<IconButton
					accessibilityLabel="Add a new moment"
					variant="accent"
					label="Add moment"
					onPress={handleAddMoment}
				>
					+
				</IconButton>
			</Animated.View>

			{upcomingGoals.length > 0 ? (
				<Animated.View
					entering={
						shouldAnimateSections
							? FadeInDown.duration(Motion.base)
									.delay(70)
									.reduceMotion(ReduceMotion.System)
							: undefined
					}
				>
					<Surface variant="raised" style={styles.upcomingLane}>
						<View style={styles.upcomingHeader}>
							<ThemedText type="meta">Upcoming goals</ThemedText>
							<ThemedText
								type="meta"
								style={{
									color: muted,
									fontVariant: ["tabular-nums"],
								}}
							>
								{upcomingGoals.length}
							</ThemedText>
						</View>
						<View style={styles.upcomingStack}>
							{upcomingGoals.map((goal) => (
								<View key={goal.id} style={styles.upcomingRow}>
									<View
										style={[
											styles.upcomingDot,
											{ backgroundColor: accent },
										]}
									/>
									<View style={styles.upcomingTextBlock}>
										<ThemedText type="caption" selectable>
											{goal.title}
										</ThemedText>
										<ThemedText
											type="meta"
											style={{ color: muted }}
										>
											{getGoalHorizon(goal, now)} ·{" "}
											{formatGoalDateLabel(goal.targetAt)}
										</ThemedText>
									</View>
								</View>
							))}
						</View>
					</Surface>
				</Animated.View>
			) : null}

			<View style={styles.timelineWrap}>
				<View
					accessibilityElementsHidden
					importantForAccessibility="no-hide-descendants"
					style={railStyle}
				/>
				{upcomingGoals.length > 0 ? (
					<View style={styles.railMarkers}>
						{upcomingGoals.slice(0, 3).map((goal) => (
							<View
								key={goal.id}
								style={[
									styles.railMarker,
									{ borderColor: accent },
								]}
							/>
						))}
					</View>
				) : null}
				<View style={styles.contextChipWrap} pointerEvents="none">
					<View style={contextChipStyle}>
						<ThemedText type="meta" style={{ color: muted }}>
							{contextLabel}
						</ThemedText>
					</View>
				</View>
				<FlatList
					ref={listRef}
					contentInsetAdjustmentBehavior="automatic"
					contentContainerStyle={contentContainerStyle}
					data={timelineMoments}
					ItemSeparatorComponent={ListSpacer}
					keyExtractor={keyExtractor}
					ListEmptyComponent={emptyState}
					onContentSizeChange={handleContentSizeChange}
					onScroll={handleScroll}
					onViewableItemsChanged={onViewableItemsChanged}
					renderItem={renderItem}
					showsVerticalScrollIndicator={false}
					viewabilityConfig={viewabilityConfig}
				/>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	root: {
		flex: 1,
		paddingHorizontal: Spacing[16],
		paddingBottom: Spacing[0],
		gap: Spacing[12],
	},
	heroRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: Spacing[12],
	},
	heroText: {
		flex: 1,
		gap: Spacing[4],
	},
	upcomingLane: {
		gap: Spacing[8],
	},
	upcomingHeader: {
		flexDirection: "row",
		justifyContent: "space-between",
		alignItems: "center",
	},
	upcomingStack: {
		gap: Spacing[8],
	},
	upcomingRow: {
		flexDirection: "row",
		gap: Spacing[8],
		alignItems: "flex-start",
	},
	upcomingDot: {
		width: 8,
		height: 8,
		borderRadius: 999,
		marginTop: 6,
	},
	upcomingTextBlock: {
		flex: 1,
		gap: 2,
	},
	timelineWrap: {
		flex: 1,
		position: "relative",
	},
	rail: {
		position: "absolute",
		top: 0,
		bottom: 0,
		left: "50%",
		width: StyleSheet.hairlineWidth,
		transform: [{ translateX: -0.5 }],
		opacity: 0.95,
		zIndex: 0,
	},
	railMarkers: {
		position: "absolute",
		left: "50%",
		top: 18,
		transform: [{ translateX: -6 }],
		zIndex: 2,
		gap: 8,
	},
	railMarker: {
		width: 12,
		height: 12,
		borderRadius: 999,
		borderWidth: 2,
		backgroundColor: "transparent",
	},
	contextChipWrap: {
		position: "absolute",
		left: 0,
		right: 0,
		top: 8,
		alignItems: "center",
		zIndex: 3,
	},
	contextChip: {
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: 999,
		paddingHorizontal: 10,
		paddingVertical: 4,
	},
	contentContainer: {
		gap: Spacing[8],
		paddingBottom: Spacing[24],
		paddingTop: Spacing[12],
	},
	listSpacer: {
		height: Spacing[8],
	},
	emptyState: {
		marginHorizontal: Spacing[16],
	},
	emptyTitle: {
		marginBottom: Spacing[8],
	},
});
