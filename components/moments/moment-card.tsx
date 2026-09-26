import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { memo, useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AudioPlayer } from "@/components/media/audio-player";
import { VideoPlayer } from "@/components/media/video-player";
import { FeedPhoto, MomentOrderedAudios, MomentOrderedImages, hasOrderedAttachments, orderedImageAttachments } from "@/components/moments/moment-attachments";
import type { PhotoOrigin } from "@/components/moments/zoomable-photo";
import { ThemedText } from "@/components/themed-text";
import { Pressed } from "@/components/ui/pressed";
import { MediaFrame } from "@/components/ui/media-frame";
import { Spacing } from "@/constants/theme";
import type { Moment } from "@/features/moments/types";
import { UNTITLED_MOMENT_TITLE } from "@/features/moments/types";
import { resolveStagedUri } from "@/features/composer/staged-uri";
import {
	formatMomentDate,
	formatMomentShortDate,
	formatMomentTime,
} from '@/features/moments/labels';
import { useThemeColor } from '@/hooks/use-theme-color';

export type MomentCardProps = {
	moment: Moment;
	/** Read destination: tapping opens the memory detail. */
	onPress?: (momentId: string) => void;
	/** Present only for the viewer's own moments; long-press opens actions. */
	onLongPress?: (momentId: string) => void;
	/** Fullscreen photo tap: tapping a feed photo opens the viewer instead. */
	onPhotoPress?: (momentId: string, photoIndex: number, origin?: PhotoOrigin) => void;
	/** Explicit menu trigger, independent of the native long-press gesture. */
	onActions?: (momentId: string) => void;
	/**
	 * Space reserved at the row's right edge for a floating control the host
	 * screen puts there. The Memories feed floats its round add button in that
	 * corner, and without this the button lands on top of this row's own
	 * actions: a 32pt trigger under a 56pt control is neither visible nor
	 * tappable, and the tap that was meant for it fires the floating one.
	 * Screens without such a control leave it at 0.
	 */
	actionsInset?: number;
	/**
	 * Article keeps the existing detail/chapter look (full date, larger
	 * type). Timeline is the compact Memories row: day separators own the
	 * date, so the caption shows author + local time with smaller shared
	 * type tokens and tighter spacing.
	 */
	presentation?: "article" | "timeline";
};

/** Ignore clock skew / write latency under one second. */
const EDITED_TOLERANCE_MS = 1000;

/** Timeline media frame stays landscape-friendly and bounded, matching photos. */
const TIMELINE_MEDIA_ASPECT = 4 / 3;

/**
 * Clamp a measured photo aspect ratio (width / height) into a sane Story
 * frame: portrait stays portrait, landscape stays landscape, extremes
 * letterbox instead of exploding the layout.
 */
export function clampPhotoAspect(aspect: number): number {
	if (!Number.isFinite(aspect) || aspect <= 0) {
		return 4 / 3;
	}

	return Math.min(16 / 9, Math.max(3 / 4, aspect));
}

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

/** A goal's target date, or "Someday" when it has none we can read. */
function formatGoalTargetLabel(targetAt?: string | null) {
	if (!targetAt) {
		return "Someday";
	}

	return formatMomentDate(targetAt, "Someday");
}

function MomentCardComponent({ moment, onPress, onLongPress, onActions, actionsInset = 0, onPhotoPress, presentation = "article" }: MomentCardProps) {
	const isTimeline = presentation === "timeline";
	const secondary = useThemeColor({}, "textSecondary");
	const accentInk = useThemeColor({}, "accentInk");
	const partnerAccentInk = useThemeColor({}, "partnerAccentInk");
	const muted = useThemeColor({}, "muted");
	const border = useThemeColor({}, "border");
	const avatarBackground = useThemeColor({}, "surface2");
	const authorColor = moment.authorRole === "you" ? accentInk : partnerAccentInk;
	const isGoal = moment.type === "goal";
	// Untitled memories carry an empty title; the legacy creation
	// placeholder reads as untitled too, so it never prints.
	const rawTitle = moment.title?.trim() ?? "";
	const title = rawTitle === UNTITLED_MOMENT_TITLE ? "" : rawTitle;
	const body = moment.body?.trim() ?? "";
	const authorName =
		moment.authorRole === "you"
			? "You"
			: moment.authorName?.trim() || "Partner";
	const avatarInitial = authorName.trim().charAt(0).toUpperCase() || "?";

	// Article/detail measures the photo and shows it whole — never cropped.
	// The timeline renders through FeedPhoto instead (content-aligned,
	// rounded, measured ratio, cover). Falls back to 4:3 while loading.
	const [photoAspect, setPhotoAspect] = useState<number | null>(null);
	const handlePhotoLoad = useCallback(
		(event: { source: { width: number; height: number } }) => {
			const { width, height } = event.source;
			if (Number.isFinite(width) && Number.isFinite(height) && height > 0) {
				setPhotoAspect(clampPhotoAspect(width / height));
			}
		},
		[],
	);

	const goalTargetLabel = useMemo(
		() => formatGoalTargetLabel(moment.targetAt),
		[moment.targetAt],
	);

	const isEdited = useMemo(() => isEditedMoment(moment), [moment]);

	const dateLabel = useMemo(
		() => formatMomentDate(moment.occurredAt, 'Date TBD'),
		[moment.occurredAt],
	);

	const shortDateLabel = useMemo(
		() => formatMomentShortDate(moment.occurredAt),
		[moment.occurredAt],
	);

	const timeLabel = useMemo(
		() => formatMomentTime(moment.occurredAt),
		[moment.occurredAt],
	);

	const metaLabel = useMemo(() => {
	 const parts = [`${dateLabel} · ${authorName}`];

		if (isEdited) {
			parts.push("Edited");
		}

		return parts.join(" · ");
	}, [authorName, dateLabel, isEdited]);

	// The timeline byline owns the day: a short local date and time, then the
	// shared Edited marker. The author is a separate coloured leading segment
	// (see timelineByline).
	const timelineMetaLabel = useMemo(() => {
		const parts = [shortDateLabel, timeLabel].filter(Boolean);

		if (isEdited) {
			parts.push("Edited");
		}

		return parts.join(" · ");
	}, [isEdited, shortDateLabel, timeLabel]);

	const titleType = isTimeline ? "subheading" : "title";
	const bodyType = "body";

	const handleLongPress = useMemo(
		() => (onLongPress ? () => onLongPress(moment.id) : undefined),
		[moment.id, onLongPress],
	);

	const handlePress = useMemo(
		() => (onPress ? () => onPress(moment.id) : undefined),
		[moment.id, onPress],
	);
	const handleActions = useMemo(
		() => (onActions ? () => onActions(moment.id) : handleLongPress),
		[moment.id, onActions, handleLongPress],
	);

	// Article meta line: author dot, full date, Edited marker.
	// Full text always renders (no truncation); long unbroken words wrap via
	// the minWidth/flexShrink chain below — never an emoji regex.
	const metaBlock = (
		<View style={styles.metaRow}>
			<View style={[styles.authorDot, { backgroundColor: authorColor }]} />
			<ThemedText
				type="caption"
				selectable
				style={[{ color: secondary }, styles.metaText]}
			>
				{metaLabel}
			</ThemedText>
		</View>
	);

	// Timeline byline: two-person colour stays on the author alone; the short
	// local date and time stay neutral metadata and wrap as one line.
	const timelineByline = (
		<View style={styles.timelineByline}>
			<ThemedText
				type="supporting"
				selectable
				style={[{ color: secondary }, styles.timelineMetaText]}
			>
				<Text style={{ color: authorColor }}>{authorName}</Text>
				{timelineMetaLabel ? ` · ${timelineMetaLabel}` : ""}
			</ThemedText>
		</View>
	);

	const hasOrdered = hasOrderedAttachments(moment);
	const orderedImagesBlock = hasOrdered ? <MomentOrderedImages moment={moment} paged={isTimeline} /> : null;
	const orderedAudiosBlock = hasOrdered ? <MomentOrderedAudios moment={moment} /> : null;
	// Dev-preview video wins the media slot over the still: the still
	// (mediaPreview) becomes the poster instead of a duplicate photo.
	const hasVideo = !hasOrdered && Boolean(moment.videoUri);
	const videoBlock = hasVideo ? (
		<VideoPlayer
			aspectRatio={isTimeline ? TIMELINE_MEDIA_ASPECT : 16 / 9}
			label={moment.title?.trim() || "Video memory"}
			posterUri={moment.mediaPreview}
			uri={moment.videoUri as string}
		/>
	) : null;
	const photoBlock = !hasOrdered && !hasVideo && moment.mediaPreview ? (
		isTimeline ? (
			<FeedPhoto uri={moment.mediaPreview} label="Memory photo" />
		) : (
			<MediaFrame aspectRatio={photoAspect ?? 4 / 3}>
				<Image
					accessible={false}
					source={{ uri: resolveStagedUri(moment.mediaPreview) }}
					style={styles.mediaImage}
					contentFit="contain"
					transition={200}
					onLoad={handlePhotoLoad}
				/>
			</MediaFrame>
		)
	) : null;
	const mediaBlock = videoBlock ?? photoBlock;

	const goalBlock = isGoal ? (
		<ThemedText type="caption" style={{ color: secondary }}>
			{goalTargetLabel}
		</ThemedText>
	) : null;

	// Album hierarchy: photo entries lead with the photograph, date/byline
	// sits below it, then title/body group closely as the caption.
	// Text-only entries keep the date above title/body.
	const hasPhoto = hasOrdered ? orderedImageAttachments(moment).length > 0 : Boolean(moment.mediaPreview || moment.videoUri);
	const hasCaption = Boolean(title || body || isGoal);
	const entryStyle = isTimeline ? [styles.entry, styles.timelineEntry] : styles.entry;
	const navInnerStyle = isTimeline ? [styles.navInner, styles.timelineNavInner] : styles.navInner;
	const captionGroupStyle = isTimeline
		? [styles.captionGroup, styles.timelineCaptionGroup]
		: styles.captionGroup;
	const titleStyle = isTimeline ? [styles.title, styles.timelineTitle] : styles.title;
	const bodyStyle = isTimeline ? [styles.timelineBody] : styles.body;
	const captionBodyStyle = isTimeline
		? [styles.captionBody, styles.timelineBody]
		: [styles.body, styles.captionBody];
	const navContent = hasPhoto ? (
		<View style={navInnerStyle}>
			{hasOrdered ? orderedImagesBlock : mediaBlock}
			{metaBlock}
			{title || body || isGoal ? (
				<View style={captionGroupStyle}>
					{title ? (
						<ThemedText type={titleType} style={titleStyle}>
							{title}
						</ThemedText>
					) : null}
					{body ? (
						<ThemedText type={bodyType} selectable style={captionBodyStyle}>
							{body}
						</ThemedText>
					) : null}
					{goalBlock}
				</View>
			) : null}
		</View>
	) : (
		<View style={navInnerStyle}>
			{metaBlock}
			{title ? (
				<ThemedText type={titleType} style={titleStyle}>
					{title}
				</ThemedText>
				) : null}
			{body ? (
				<ThemedText type={bodyType} selectable style={bodyStyle}>
					{body}
				</ThemedText>
				) : null}
			{goalBlock}
		</View>
	);

	const audioBlock = !hasOrdered && moment.audioUri ? (
		<AudioPlayer uri={moment.audioUri} />
	) : null;

	const momentA11yLabel = `Moment${title ? `: ${title}` : ''}`;

	if (isTimeline) {
		// Single prints stay aligned with the entry text; a photo set escapes
		// the text column and bleeds edge to edge as a sideways strip.
		const isPhotoSet = hasOrdered && orderedImageAttachments(moment).length > 1;
		const singlePhotoNode = !hasOrdered && !hasVideo && moment.mediaPreview ? (
			<FeedPhoto
				uri={moment.mediaPreview}
				label="Memory photo"
				onPress={
					onPhotoPress
						? (origin) =>
								origin ? onPhotoPress(moment.id, 0, origin) : onPhotoPress(moment.id, 0)
						: undefined
				}
				onLongPress={handleLongPress}
				actionLabel="Open photo fullscreen"
			/>
		) : null;
		const contentMediaNode = hasVideo
			? videoBlock
			: hasOrdered
				? (
					<MomentOrderedImages
						moment={moment}
						paged
						onPhotoPress={
							onPhotoPress
								? (index, origin) =>
										origin
											? onPhotoPress(moment.id, index, origin)
											: onPhotoPress(moment.id, index)
								: undefined
						}
						onPhotoLongPress={handleLongPress}
					/>
				)
				: singlePhotoNode;
		// Photos carry their own fullscreen tap (and own-moment hold); only
		// video keeps the outer hold wrapper since it has no tap of its own.
		const captionNode = hasCaption ? (
			<View style={navInnerStyle}>
				<View style={captionGroupStyle}>
					{title ? (
						<ThemedText type={titleType} style={titleStyle}>
							{title}
						</ThemedText>
					) : null}
					{body ? (
						<ThemedText type={bodyType} selectable style={captionBodyStyle}>
							{body}
						</ThemedText>
					) : null}
					{goalBlock}
				</View>
			</View>
		) : null;
		return (
			<View style={[styles.timelineEntry, { borderBottomColor: border }]}>
				<View style={styles.timelineRow}>
					<View
						accessible={false}
						accessibilityElementsHidden
						importantForAccessibility="no-hide-descendants"
						style={[styles.avatar, { backgroundColor: avatarBackground }]}
					>
						<Text style={[styles.avatarInitial, { color: authorColor }]}>
							{avatarInitial}
						</Text>
					</View>
					<View style={styles.timelineContent}>
						<View
							style={[
								styles.timelineHeader,
								actionsInset > 0 ? { paddingRight: actionsInset } : null,
							]}
						>
						{timelineByline}
						{/* One menu path, on every platform. This used to be two:
						    a native MenuView wrapping a plain View that
						    announced itself as a button but only the native
						    touch reached, so VoiceOver could focus it and
						    activate it into nothing. The long-press already
						    opens the platform menu where there is one, so the
						    ellipsis is free to be an honest button that opens
						    the app's own sheet. */}
						{handleActions ? (
							<Pressable
								accessibilityHint="Opens edit and remove for this moment"
								accessibilityLabel="More actions"
								accessibilityRole="button"
								hitSlop={6}
								onPress={handleActions}
								style={({ pressed }) => [
									styles.ellipsis,
									pressed && styles.ellipsisPressed,
								]}
							>
								<Ionicons color={muted} name="ellipsis-horizontal" size={18} />
							</Pressable>
						) : null}
						</View>
					{captionNode ? (
						handleLongPress ? (
							<Pressable
								accessibilityHint="Hold to edit or remove this moment"
								accessibilityLabel={momentA11yLabel}
								accessibilityRole="button"
								delayLongPress={400}
								onLongPress={handleLongPress}
								style={({ pressed }) => (pressed ? Pressed.at : undefined)}
							>
								{captionNode}
							</Pressable>
						) : (
							captionNode
						)
					) : null}
						{!isPhotoSet && hasPhoto ? (
							hasVideo && handleLongPress ? (
								<Pressable
									// Gesture-only wrapper for video: tapping
									// plays inline, long-press opens actions.
									// It carries no label of its own, so no
									// focusable is ever doubled.
									accessible={false}
									delayLongPress={400}
									onLongPress={handleLongPress}
									style={styles.timelineMedia}
								>
									{contentMediaNode}
								</Pressable>
							) : (
								<View style={styles.timelineMedia}>
									{contentMediaNode}
								</View>
							)
						) : null}
						{hasOrdered ? orderedAudiosBlock : audioBlock}
					</View>
				</View>
				{isPhotoSet ? (
					<View style={styles.timelineStrip}>
						<MomentOrderedImages
							moment={moment}
							paged
							onPhotoPress={
							onPhotoPress
								? (index, origin) =>
										origin
											? onPhotoPress(moment.id, index, origin)
											: onPhotoPress(moment.id, index)
								: undefined
						}
							onPhotoLongPress={handleLongPress}
						/>
					</View>
				) : null}
			</View>
		);
	}

	if (!handlePress && !handleLongPress) {
		return (
			<View style={entryStyle}>
				{navContent}
				{hasOrdered ? orderedAudiosBlock : audioBlock}
			</View>
		);
	}

	return (
		<View style={entryStyle}>
			<Pressable
			accessibilityHint={handleLongPress ? "Hold to edit or remove this moment" : "Open this memory"}
			accessibilityLabel={momentA11yLabel}
			accessibilityRole="button"
			delayLongPress={400}
			onLongPress={handleLongPress}
			onPress={handlePress}
			style={({ pressed }) => (pressed ? Pressed.at : undefined)}
			>
				{navContent}
			</Pressable>
			{hasOrdered ? orderedAudiosBlock : audioBlock}
		</View>
	);
}

export const MomentCard = memo(MomentCardComponent);

const styles = StyleSheet.create({
	entry: {
		gap: Spacing[12],
	},
	timelineEntry: {
		minWidth: 0,
		borderBottomWidth: StyleSheet.hairlineWidth,
	},
	timelineRow: {
		flexDirection: "row",
		alignItems: "flex-start",
		gap: Spacing[12],
		paddingHorizontal: Spacing[24],
		paddingTop: Spacing[16],
		paddingBottom: Spacing[16],
	},
	timelineMedia: {
		marginTop: Spacing[4],
	},
	timelineStrip: {
		// The row's bottom pad already separates text from strip; this pads
		// strip from the entry divider. No horizontal pad: the strip bleeds
		// off both screen edges.
		marginBottom: Spacing[16],
	},
	timelineContent: {
		flex: 1,
		minWidth: 0,
		gap: Spacing[8],
	},
	timelineHeader: {
		flexDirection: "row",
		alignItems: "center",
		gap: Spacing[8],
	},
	avatar: {
		width: 36,
		height: 36,
		borderRadius: 18,
		alignItems: "center",
		justifyContent: "center",
	},
	avatarInitial: {
		fontSize: 15,
		fontWeight: "600",
	},
	timelineByline: {
		flex: 1,
		minWidth: 0,
	},
	ellipsis: {
		width: 32,
		height: 32,
		borderRadius: 16,
		alignItems: "center",
		justifyContent: "center",
	},
	ellipsisPressed: {
		opacity: 0.55,
	},
	navInner: {
		gap: Spacing[12],
	},
	timelineNavInner: {
		gap: Spacing[8],
		minWidth: 0,
		flexShrink: 1,
	},
	metaRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: Spacing[8],
	},
	authorDot: {
		width: 8,
		height: 8,
		borderRadius: 4,
	},
	metaText: {
		flexShrink: 1,
	},
	timelineMetaText: {
		flexShrink: 1,
		minWidth: 0,
		fontVariant: ["tabular-nums"],
	},
	timelineTitle: {
		flexShrink: 1,
		minWidth: 0,
	},
	timelineBody: {
		flexShrink: 1,
		minWidth: 0,
		marginTop: Spacing[0],
	},
	timelineCaptionGroup: {
		minWidth: 0,
		flexShrink: 1,
	},
	title: {
		marginBottom: Spacing[0],
	},
	body: {
		marginTop: Spacing[4],
	},
	captionGroup: {
		gap: Spacing[8],
	},
	captionBody: {
		marginTop: Spacing[0],
	},
	mediaImage: {
		width: "100%",
		height: "100%",
	},
});
