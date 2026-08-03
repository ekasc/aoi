import { Image } from "expo-image";
import { memo, useMemo } from "react";
import { StyleSheet, View } from "react-native";

import { AudioPlayer } from "@/components/media/audio-player";
import { ThemedText } from "@/components/themed-text";
import { Divider } from "@/components/ui/divider";
import { Surface } from "@/components/ui/surface";
import { Spacing } from "@/constants/theme";
import { getGoalHorizon } from "@/features/moments/moment-goal-utils";
import type { Moment, MomentType } from "@/features/moments/types";
import { useThemeColor } from "@/hooks/use-theme-color";

export type MomentCardProps = {
	moment: Moment;
};

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

	return date
		.toLocaleDateString("en-US", {
			month: "short",
			day: "2-digit",
			year: "numeric",
		})
		.toUpperCase();
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

function MomentCardComponent({ moment }: MomentCardProps) {
	const accent = useThemeColor({}, "accent");
	const partnerAccent = useThemeColor({}, "partnerAccent");
	const warning = useThemeColor({}, "warning");
	const border = useThemeColor({}, "border");
	const surface = useThemeColor({}, "surface");
	const surface2 = useThemeColor({}, "surface2");
	const onAccent = useThemeColor({}, "onAccent");
	const text = useThemeColor({}, "text");
	const muted = useThemeColor({}, "muted");
	const isYou = moment.authorRole === "you";
	const isGoal = moment.type === "goal";
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
	const badgeStyle = useMemo(
		() => [
			styles.badge,
			{
				backgroundColor: isYou ? accent : partnerAccent,
			},
		],
		[accent, isYou, partnerAccent],
	);
	const badgeLabelStyle = useMemo(
		() => [styles.badgeLabel, { color: isYou ? onAccent : text }],
		[isYou, onAccent, text],
	);
	const metaStyle = useMemo(() => [styles.meta, { color: muted }], [muted]);
	const titleStyle = useMemo(() => [styles.title, { color: text }], [text]);
	const bodyStyle = useMemo(() => [styles.body, { color: text }], [text]);

	const meta = useMemo(
		() =>
			`${formatDateLabel(moment.occurredAt)}  ·  ${
				MOMENT_TYPE_LABELS[moment.type]
			}${isGoal ? `  ·  ${goalHorizon}` : ""}`,
		[goalHorizon, isGoal, moment.occurredAt, moment.type],
	);

	return (
		<View style={rowStyle}>
			<View
				accessibilityElementsHidden
				importantForAccessibility="no-hide-descendants"
				style={knotStyle}
			/>
			<Surface variant="raised" style={cardStyle}>
				<View style={styles.metaRow}>
					<View style={badgeStyle}>
						<ThemedText type="meta" style={badgeLabelStyle}>
							{isYou ? "You" : moment.authorName}
						</ThemedText>
					</View>
					<ThemedText type="meta" style={metaStyle}>
						{meta}
					</ThemedText>
				</View>
				<Divider style={styles.divider} />
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
		justifyContent: "space-between",
		alignItems: "center",
		gap: 8,
	},
	meta: {
		flexShrink: 1,
		textAlign: "right",
	},
	badge: {
		borderRadius: 999,
		paddingHorizontal: 10,
		paddingVertical: 4,
	},
	badgeLabel: {
		letterSpacing: 0.2,
	},
	divider: {
		marginVertical: Spacing[8],
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
