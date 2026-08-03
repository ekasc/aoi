import { Image } from "expo-image";
import { memo, useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AudioPlayer } from "@/components/media/audio-player";
import { ThemedText } from "@/components/themed-text";
import { Surface } from "@/components/ui/surface";
import { Spacing } from "@/constants/theme";
import { getGoalHorizon } from "@/features/moments/moment-goal-utils";
import type { Moment, MomentType } from "@/features/moments/types";
import { useThemeColor } from "@/hooks/use-theme-color";

export type MomentCardProps = {
	moment: Moment;
	/** Present only for the viewer's own moments; long-press opens actions. */
	onLongPress?: (momentId: string) => void;
};

/** Ignore clock skew / write latency under one second. */
const EDITED_TOLERANCE_MS = 1000;

function isEditedMoment(moment: Moment): boolean {
	if (!moment.updatedAt) {
		return false;
	}

	const createdAt = new Date(moment.createdAt).getTime();
	const updatedAt = new Date(moment.updatedAt).getTime();

	if (Number.isNaN(createdAt) || Number.isNaN(updatedAt)) {
		return false;
	}

	return updatedAt - createdAt > EDITED_TOLERANCE_MS;
}

const MOMENT_TYPE_LABELS: Record<MomentType, string> = {
	note: "Note",
	milestone: "Milestone",
	date: "Date",
	goal: "Goal",
	media: "Media",
	trace: "Trace",
};

function formatDateLabel(value: string) {
	const date = new Date(value);

	if (Number.isNaN(date.getTime())) {
		return "Date TBD";
	}

	return date.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

function formatGoalTargetLabel(targetAt?: string | null) {
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

function MomentCardComponent({ moment, onLongPress }: MomentCardProps) {
	const accent = useThemeColor({}, "accent");
	const partnerAccent = useThemeColor({}, "partnerAccent");
	const warning = useThemeColor({}, "warning");
	const border = useThemeColor({}, "border");
	const surface = useThemeColor({}, "surface");
	const surface2 = useThemeColor({}, "surface2");
	const text = useThemeColor({}, "text");
	const muted = useThemeColor({}, "muted");
	const isYou = moment.authorRole === "you";
	const isGoal = moment.type === "goal";
	const isNote = moment.type === "note";
	const isTrace = moment.type === "trace";
	const title = moment.title?.trim() || (isTrace ? "" : "Untitled moment");
	const body = moment.body?.trim() || (isTrace ? "" : "No details added yet.");
	const goalHorizon = useMemo(() => getGoalHorizon(moment), [moment]);
	const goalTargetLabel = useMemo(
		() => formatGoalTargetLabel(moment.targetAt),
		[moment.targetAt],
	);

	const rowStyle = useMemo(
		() => [styles.row, isYou ? styles.rowYou : styles.rowPartner],
		[isYou],
	);
	const knotStyle = useMemo(
		() => [
			styles.knot,
			{
				borderColor: isYou ? accent : border,
				backgroundColor: isYou ? accent : partnerAccent,
			},
			isGoal ? styles.goalKnot : undefined,
		],
		[accent, border, isGoal, isYou, partnerAccent],
	);
	const cardStyle = useMemo(
		() => [
			styles.card,
			{
				backgroundColor: isYou ? surface2 : surface,
				borderColor: isYou ? accent : partnerAccent,
			},
			isGoal ? styles.goalCard : undefined,
			isYou ? styles.cardYou : styles.cardPartner,
		],
		[accent, isGoal, isYou, partnerAccent, surface, surface2],
	);
	const authorDotStyle = useMemo(
		() => [
			styles.authorDot,
			{ backgroundColor: isYou ? accent : partnerAccent },
		],
		[accent, isYou, partnerAccent],
	);
	const metaStyle = useMemo(() => [styles.meta, { color: muted }], [muted]);
	const titleStyle = useMemo(() => [styles.title, { color: text }], [text]);
	const bodyStyle = useMemo(() => [styles.body, { color: text }], [text]);

	const isEdited = useMemo(() => isEditedMoment(moment), [moment]);

	const dateLabel = useMemo(
		() => formatDateLabel(moment.occurredAt),
		[moment.occurredAt],
	);

	const handleLongPress = useMemo(
		() => (onLongPress ? () => onLongPress(moment.id) : undefined),
		[moment.id, onLongPress],
	);

	const card = (
		<Surface variant="raised" style={cardStyle}>
			<View style={styles.metaRow}>
				<View
					accessible
					accessibilityRole="text"
					accessibilityLabel={
						isYou ? "Added by you" : `Added by ${moment.authorName}`
					}
					style={authorDotStyle}
				/>
				{!isNote ? (
					<ThemedText type="meta" style={metaStyle}>
						{MOMENT_TYPE_LABELS[moment.type]}
					</ThemedText>
				) : null}
				<View style={styles.metaSpacer} />
				<ThemedText type="meta" style={metaStyle}>
					{dateLabel}
					{isEdited ? " · Edited" : ""}
				</ThemedText>
			</View>
			{title ? (
				<ThemedText type="title" style={titleStyle}>
					{title}
				</ThemedText>
			) : null}
			{moment.mediaPreview ? (
				<View style={[styles.mediaContainer, { borderColor: border }]}>
					<Image
						source={{ uri: moment.mediaPreview }}
						style={styles.mediaImage}
						contentFit="cover"
						transition={200}
					/>
				</View>
			) : null}
			{isGoal ? (
				<View style={styles.goalMetaRow}>
					<View
						style={[
							styles.goalPill,
							{
								borderColor: warning,
								backgroundColor: surface2,
							},
						]}
					>
						<ThemedText type="meta" style={{ color: warning }}>
							{goalHorizon}
						</ThemedText>
					</View>
					<ThemedText type="caption" style={{ color: muted }}>
						{goalTargetLabel}
					</ThemedText>
				</View>
			) : null}
			{moment.audioUri ? (
				<AudioPlayer uri={moment.audioUri} />
			) : null}
			{body ? (
				<ThemedText type="body" style={bodyStyle}>
					{body}
				</ThemedText>
			) : null}
		</Surface>
	);

	return (
		<View style={rowStyle}>
			<View
				accessibilityElementsHidden
				importantForAccessibility="no-hide-descendants"
				style={knotStyle}
			/>
			{handleLongPress ? (
				<Pressable
					accessibilityHint="Hold to edit or remove this moment"
					accessibilityRole="button"
					delayLongPress={400}
					onLongPress={handleLongPress}
					style={styles.longPressWrap}
				>
					{card}
				</Pressable>
			) : (
				card
			)}
		</View>
	);
}

export const MomentCard = memo(MomentCardComponent);

const styles = StyleSheet.create({
	row: {
		flexDirection: "row-reverse",
		alignItems: "flex-start",
		gap: 12,
	},
	rowYou: {
		flexDirection: "row-reverse",
	},
	rowPartner: {
		flexDirection: "row",
	},
	knot: {
		width: 12,
		height: 12,
		borderRadius: 12,
		borderWidth: 3,
		marginTop: 18,
	},
	goalKnot: {
		width: 14,
		height: 14,
		marginTop: 16,
	},
	longPressWrap: {
		flex: 1,
	},
	card: {
		flex: 1,
		maxWidth: "92%",
		borderWidth: 1,
	},
	goalCard: {
		borderStyle: "dashed",
	},
	cardYou: {
		marginRight: 8,
	},
	cardPartner: {
		marginLeft: 8,
	},
	metaRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: Spacing[8],
		marginBottom: Spacing[8],
	},
	metaSpacer: {
		flex: 1,
	},
	authorDot: {
		width: 8,
		height: 8,
		borderRadius: 999,
	},
	meta: {
		flexShrink: 1,
		textAlign: "right",
	},
	title: {
		marginBottom: Spacing[4],
	},
	goalMetaRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
		marginBottom: Spacing[4],
	},
	goalPill: {
		borderRadius: 999,
		borderWidth: StyleSheet.hairlineWidth,
		paddingHorizontal: 9,
		paddingVertical: 2,
	},
	body: {
		opacity: 1,
	},
	mediaContainer: {
		borderRadius: 12,
		overflow: "hidden",
		borderWidth: StyleSheet.hairlineWidth,
		marginBottom: Spacing[8],
	},
	mediaImage: {
		width: "100%",
		height: 180,
	},
});
