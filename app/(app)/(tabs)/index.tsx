import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
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
import { ResurfaceCard } from "@/components/moments/resurface-card";
import { TombstoneMarker } from "@/components/moments/tombstone-marker";
import { ThemedText } from "@/components/themed-text";
import { ActionSheet } from "@/components/ui/action-sheet";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Surface } from "@/components/ui/surface";
import { Motion, Spacing } from "@/constants/theme";
import {
	getGoalHorizon,
	isUpcomingGoal,
} from "@/features/moments/moment-goal-utils";
import { useMoments } from "@/features/moments/moments-context";
import { isOwnMoment } from "@/features/moments/ownership";
import { findResurfaces } from "@/features/moments/resurface";
import { useResurfaceNotification } from "@/features/moments/use-resurface-notification";
import type {
	Moment,
	SpaceActivityItem,
} from "@/features/moments/types";
import { useSqueeze } from "@/features/squeeze/squeeze-context";
import { useThemeColor } from "@/hooks/use-theme-color";
import { useSpace } from "@/features/space/space-context";

/** Tombstones share the API's 7-day retention window. */
const TOMBSTONE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

type RailItem =
	| {
			kind: "moment";
			key: string;
			occurredAt: string;
			moment: Moment;
	  }
	| {
			kind: "tombstone";
			key: string;
			occurredAt: string;
			tombstone: SpaceActivityItem;
	  };

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
	const { moments, activity, removeMoment } = useMoments();
	const listRef = useRef<FlatList<RailItem> | null>(null);
	const [actionMoment, setActionMoment] = useState<Moment | null>(null);
	const [confirmMoment, setConfirmMoment] = useState<Moment | null>(null);
	const [isRemoving, setIsRemoving] = useState(false);
	const [removeError, setRemoveError] = useState("");
	const now = useMemo(() => new Date(), []);
	const thread = useThemeColor({}, "thread");
	const muted = useThemeColor({}, "muted");
	const border = useThemeColor({}, "border");
	const surface = useThemeColor({}, "surface");
	const surface2 = useThemeColor({}, "surface2");
	const accent = useThemeColor({}, "accent");
	const onAccent = useThemeColor({}, "onAccent");
	const background = useThemeColor({}, "background");
	const { space } = useSpace();
	const { sendSqueeze, isSending: isSqueezeSending } = useSqueeze();
	const resurfaces = useMemo(() => findResurfaces(moments, now), [moments, now]);

	useResurfaceNotification(moments);

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
	const tombstones = useMemo(
		() =>
			activity.filter((item) => {
				if (item.kind !== "moment_deleted") {
					return false;
				}
				const occurredAt = new Date(item.occurredAt).getTime();
				return (
					!Number.isNaN(occurredAt) &&
					occurredAt >= now.getTime() - TOMBSTONE_RETENTION_MS
				);
			}),
		[activity, now],
	);
	const railItems = useMemo(() => {
		const items: RailItem[] = [
			...timelineMoments.map(
				(moment): RailItem => ({
					kind: "moment",
					key: `moment:${moment.id}`,
					occurredAt: moment.occurredAt,
					moment,
				}),
			),
			...tombstones.map(
				(tombstone): RailItem => ({
					kind: "tombstone",
					key: `tombstone:${tombstone.id}`,
					occurredAt: tombstone.occurredAt,
					tombstone,
				}),
			),
		];

		return items.sort(
			(left, right) =>
				new Date(left.occurredAt).getTime() -
				new Date(right.occurredAt).getTime(),
		);
	}, [timelineMoments, tombstones]);
	const momentsById = useMemo(() => {
		const byId = new Map<string, Moment>();
		moments.forEach((moment) => byId.set(moment.id, moment));
		return byId;
	}, [moments]);
	const [hasInitialScroll, setHasInitialScroll] = useState(false);
	const periodLabel = useMemo(() => formatPeriodLabel(new Date()), []);
	const [contextLabel, setContextLabel] = useState(
		upcomingGoals.length > 0 ? "Upcoming goals" : periodLabel,
	);

	useEffect(() => {
		setContextLabel(
			upcomingGoals.length > 0 ? "Upcoming goals" : periodLabel,
		);
	}, [periodLabel, upcomingGoals.length]);

	useEffect(() => {
		setHasInitialScroll(false);
	}, [railItems.length]);

	const setContextLabelSafely = useCallback((nextLabel: string) => {
		setContextLabel((currentLabel) =>
			currentLabel === nextLabel ? currentLabel : nextLabel,
		);
	}, []);

	const handleAddMoment = useCallback(() => {
		router.push("/(app)/moment/new");
	}, [router]);

	const handleTrace = useCallback(() => {
		router.push("/(app)/moment/trace");
	}, [router]);

	const handleSqueeze = useCallback(() => {
		void sendSqueeze();
	}, [sendSqueeze]);

	const keyExtractor = useCallback((item: RailItem) => item.key, []);

	const handleMomentLongPress = useCallback(
		(momentId: string) => {
			const moment = momentsById.get(momentId);
			if (moment) {
				setActionMoment(moment);
			}
		},
		[momentsById],
	);

	const renderItem = useCallback(
		({ item }: ListRenderItemInfo<RailItem>) => {
			if (item.kind === "tombstone") {
				return <TombstoneMarker actorName={item.tombstone.actorName} />;
			}

			return (
				<MomentCard
					moment={item.moment}
					onLongPress={
						isOwnMoment(item.moment)
							? handleMomentLongPress
							: undefined
					}
				/>
			);
		},
		[handleMomentLongPress],
	);

	const handleCloseActionSheet = useCallback(() => {
		setActionMoment(null);
	}, []);

	const handleEditMoment = useCallback(() => {
		if (!actionMoment) {
			return;
		}
		const momentToEdit = actionMoment;
		setActionMoment(null);
		router.push(`/(app)/moment/edit/${momentToEdit.id}`);
	}, [actionMoment, router]);

	const handleRequestDelete = useCallback(() => {
		setConfirmMoment(actionMoment);
		setRemoveError("");
		setActionMoment(null);
	}, [actionMoment]);

	const actionSheetActions = useMemo(
		() => [
			{ label: "Edit", onPress: handleEditMoment },
			{
				label: "Delete",
				onPress: handleRequestDelete,
				variant: "destructive" as const,
			},
		],
		[handleEditMoment, handleRequestDelete],
	);

	const handleCloseConfirmSheet = useCallback(() => {
		if (isRemoving) {
			return;
		}
		setConfirmMoment(null);
		setRemoveError("");
	}, [isRemoving]);

	const handleConfirmDelete = useCallback(async () => {
		if (!confirmMoment || isRemoving) {
			return;
		}
		setIsRemoving(true);
		setRemoveError("");
		try {
			await removeMoment(confirmMoment.id);
			setConfirmMoment(null);
		} catch {
			// Tender-error policy: gentle message, no stack traces.
			setRemoveError("Couldn't remove this moment right now. Try again?");
		} finally {
			setIsRemoving(false);
		}
	}, [confirmMoment, isRemoving, removeMoment]);

	const confirmSheetActions = useMemo(
		() => [
			{
				label: isRemoving ? "Removing…" : "Remove",
				onPress: () => {
					void handleConfirmDelete();
				},
				variant: "destructive" as const,
			},
			{ label: "Cancel", onPress: handleCloseConfirmSheet },
		],
		[handleCloseConfirmSheet, handleConfirmDelete, isRemoving],
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
				<ThemedText type="body" style={{ color: muted, marginBottom: Spacing[8] }}>
					Tap the + button to add your first moment.
				</ThemedText>
				<View style={styles.emptyHints}>
					<ThemedText type="meta" style={{ color: muted }}>
						Notes
					</ThemedText>
					<ThemedText type="caption" style={{ color: muted }}>
						Write a quick thought or memory.
					</ThemedText>
				</View>
				<View style={styles.emptyHints}>
					<ThemedText type="meta" style={{ color: muted }}>
						Milestones
					</ThemedText>
					<ThemedText type="caption" style={{ color: muted }}>
						First date, moving in, engagements — the big ones.
					</ThemedText>
				</View>
				<View style={styles.emptyHints}>
					<ThemedText type="meta" style={{ color: muted }}>
						Goals
					</ThemedText>
					<ThemedText type="caption" style={{ color: muted }}>
						Plans you&apos;re working toward together.
					</ThemedText>
				</View>
				<View style={styles.emptyCta}>
					<Button
						label="Add your first moment"
						onPress={handleAddMoment}
						variant="secondary"
					/>
				</View>
			</Surface>
		),
		[border, muted, surface, handleAddMoment],
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
		({ viewableItems }: { viewableItems: ViewToken<RailItem>[] }) => {
			const firstVisibleMoment = viewableItems.find(
				(item) => item.isViewable && item.item.kind === "moment",
			)?.item;

			if (!firstVisibleMoment || firstVisibleMoment.kind !== "moment") {
				return;
			}

			setContextLabelSafely(
				formatTimelineContextLabel(firstVisibleMoment.moment.occurredAt),
			);
		},
		[setContextLabelSafely],
	);

	const viewabilityConfig = useMemo(
		() => ({ itemVisiblePercentThreshold: 45 }),
		[],
	);

	const handleContentSizeChange = useCallback(() => {
		if (hasInitialScroll || railItems.length === 0) {
			return;
		}

		requestAnimationFrame(() => {
			listRef.current?.scrollToEnd({ animated: false });
		});
		setHasInitialScroll(true);
	}, [hasInitialScroll, railItems.length]);

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
				entering={FadeInDown.duration(Motion.slow)
					.delay(20)
					.reduceMotion(ReduceMotion.System)}
				style={styles.heroRow}
			>
				{space?.photoUri ? (
					<Image source={{ uri: space.photoUri }} style={styles.heroPhoto} contentFit="cover" />
				) : null}
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
				<View style={styles.heroActions}>
					<IconButton
					accessibilityLabel={`Send a squeeze to ${space?.partnerName ?? "your partner"}`}
					disabled={isSqueezeSending}
					label="Send a squeeze"
					onPress={handleSqueeze}
					variant="secondary"
				>
					<Ionicons color={accent} name="heart" size={20} />
					</IconButton>
					<IconButton
					accessibilityLabel="Keep a quick trace"
					label="Trace"
					onPress={handleTrace}
					variant="secondary"
				>
					<Ionicons color={accent} name="flash-outline" size={20} />
					</IconButton>
				<IconButton
					accessibilityLabel="Add a new moment"
					variant="accent"
					label="Add moment"
					onPress={handleAddMoment}
				>
					<Ionicons color={onAccent} name="add" size={24} />
				</IconButton>
				</View>
			</Animated.View>

			{resurfaces.length > 0 ? (
				<Animated.View
					entering={FadeInDown.duration(Motion.base)
						.delay(50)
						.reduceMotion(ReduceMotion.System)}
					style={styles.resurfaceWrap}
				>
					<ResurfaceCard resurfaces={resurfaces} />
				</Animated.View>
			) : null}

			{upcomingGoals.length > 0 ? (
				<Animated.View
					entering={FadeInDown.duration(Motion.base)
						.delay(70)
						.reduceMotion(ReduceMotion.System)}
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
					data={railItems}
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

			<ActionSheet
				actions={actionSheetActions}
				onClose={handleCloseActionSheet}
				title={actionMoment?.title?.trim() || "This moment"}
				visible={actionMoment !== null}
			/>

			<ActionSheet
				actions={confirmSheetActions}
				description={
					removeError ||
					"This moment will be removed from your shared timeline"
				}
				onClose={handleCloseConfirmSheet}
				title="Remove this moment?"
				visible={confirmMoment !== null}
			/>
		</View>
	);
}

const styles = StyleSheet.create({
	root: {
		flex: 1,
		paddingHorizontal: Spacing[16],
		paddingBottom: Spacing[0],
		gap: Spacing[8],
	},
	heroRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: Spacing[12],
		marginBottom: Spacing[4],
	},
	heroActions: {
		alignItems: "center",
		flexDirection: "row",
		gap: Spacing[8],
	},
	resurfaceWrap: {
		marginHorizontal: Spacing[16],
		marginBottom: Spacing[8],
	},
	heroPhoto: {
		width: 44,
		height: 44,
		borderRadius: 22,
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
		marginBottom: Spacing[4],
	},
	upcomingStack: {
		gap: Spacing[12],
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
		paddingTop: Spacing[16],
	},
	listSpacer: {
		height: Spacing[8],
	},
	emptyState: {
		marginHorizontal: Spacing[16],
		gap: Spacing[4],
	},
	emptyTitle: {
		marginBottom: Spacing[4],
	},
	emptyHints: {
		flexDirection: "row",
		gap: Spacing[8],
		alignItems: "baseline",
		marginTop: Spacing[4],
	},
	emptyCta: {
		marginTop: Spacing[16],
	},
});
