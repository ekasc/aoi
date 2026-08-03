import { Image } from "expo-image";
import { Stack } from "expo-router";
import { memo, useCallback, useMemo, useState } from "react";
import {
	FlatList,
	Modal,
	Pressable,
	StyleSheet,
	useWindowDimensions,
	View,
} from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AudioPlayer } from "@/components/media/audio-player";
import { ThemedText } from "@/components/themed-text";
import { Surface } from "@/components/ui/surface";
import { Motion, Radii, Spacing } from "@/constants/theme";
import { useMoments } from "@/features/moments/moments-context";
import type { Moment, MomentAuthorRole } from "@/features/moments/types";
import { useSpace } from "@/features/space/space-context";
import { useThemeColor } from "@/hooks/use-theme-color";

const ROW_ANIMATION = FadeIn.duration(Motion.base).reduceMotion(
	ReduceMotion.System,
);

type WallItem = {
	id: string;
	kind: "image" | "voice";
	uri: string;
	occurredAt: string;
	authorRole: MomentAuthorRole;
	title: string;
};

type WallRow = {
	key: string;
	/** Two images side by side, or one full-width voice trace. */
	items: WallItem[];
};

function formatWallDate(iso: string) {
	const date = new Date(iso);

	if (Number.isNaN(date.getTime())) {
		return "";
	}

	return date.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

/**
 * One wall item per moment: its photo when it has one, otherwise its voice.
 * (A moment that carries both stays represented by its photo here — the
 * voice lives on the timeline card.)
 */
function toWallItems(moments: Moment[]): WallItem[] {
	const items: WallItem[] = [];

	for (const moment of moments) {
		if (moment.mediaPreview) {
			items.push({
				id: moment.id,
				kind: "image",
				uri: moment.mediaPreview,
				occurredAt: moment.occurredAt,
				authorRole: moment.authorRole,
				title: moment.title,
			});
		} else if (moment.audioUri) {
			items.push({
				id: moment.id,
				kind: "voice",
				uri: moment.audioUri,
				occurredAt: moment.occurredAt,
				authorRole: moment.authorRole,
				title: moment.title,
			});
		}
	}

	// Newest first — the album opens with what just happened.
	items.sort((left, right) => {
		if (left.occurredAt !== right.occurredAt) {
			return left.occurredAt < right.occurredAt ? 1 : -1;
		}
		return left.id < right.id ? 1 : -1;
	});

	return items;
}

function packWallRows(items: WallItem[]): WallRow[] {
	const rows: WallRow[] = [];
	let pendingImages: WallItem[] = [];

	const flushImages = () => {
		if (pendingImages.length > 0) {
			rows.push({
				key: pendingImages.map((item) => item.id).join("-"),
				items: pendingImages,
			});
			pendingImages = [];
		}
	};

	for (const item of items) {
		if (item.kind === "image") {
			pendingImages.push(item);
			if (pendingImages.length === 2) {
				flushImages();
			}
		} else {
			flushImages();
			rows.push({ key: item.id, items: [item] });
		}
	}

	flushImages();
	return rows;
}

type MemoryWallRowProps = {
	row: WallRow;
	cellSize: number;
	accent: string;
	partnerAccent: string;
	background: string;
	border: string;
	muted: string;
	partnerName: string;
	onOpenImage: (item: WallItem) => void;
};

const MemoryWallRow = memo(function MemoryWallRow({
	row,
	cellSize,
	accent,
	partnerAccent,
	background,
	border,
	muted,
	partnerName,
	onOpenImage,
}: MemoryWallRowProps) {
	const item = row.items[0];

	if (item.kind === "voice") {
		const authorLabel = item.authorRole === "you" ? "You" : partnerName;

		return (
			<Animated.View entering={ROW_ANIMATION}>
				<Surface
					style={[styles.voiceRow, { width: cellSize * 2 + Spacing[8] }]}
				>
					<ThemedText type="meta" style={{ color: muted }}>
						Voice · {formatWallDate(item.occurredAt)} · {authorLabel}
					</ThemedText>
					<AudioPlayer uri={item.uri} />
				</Surface>
			</Animated.View>
		);
	}

	return (
		<Animated.View entering={ROW_ANIMATION} style={styles.imageRow}>
			{row.items.map((imageItem) => {
				const dotColor =
					imageItem.authorRole === "you" ? accent : partnerAccent;

				return (
					<Pressable
						accessibilityLabel={`Open photo from ${formatWallDate(
							imageItem.occurredAt,
						)}`}
						accessibilityRole="button"
						key={imageItem.id}
						onPress={() => onOpenImage(imageItem)}
						style={[
							styles.imageCell,
							{
								backgroundColor: border,
								height: cellSize,
								width: cellSize,
							},
						]}
					>
						<Image
							contentFit="cover"
							source={{ uri: imageItem.uri }}
							style={styles.imageCellImage}
							transition={200}
						/>
						<View
							style={[
								styles.authorDot,
								{ backgroundColor: dotColor, borderColor: background },
							]}
						/>
					</Pressable>
				);
			})}
		</Animated.View>
	);
});

/**
 * The memory wall: every photo and voice trace the two of you have kept,
 * gathered like a printed album. Newest first, nothing ranked, nothing
 * counted — just the wall itself.
 */
export default function MemoryWallScreen() {
	const insets = useSafeAreaInsets();
	const { width } = useWindowDimensions();
	const { moments } = useMoments();
	const { space } = useSpace();
	const accent = useThemeColor({}, "accent");
	const background = useThemeColor({}, "background");
	const border = useThemeColor({}, "border");
	const muted = useThemeColor({}, "muted");
	const partnerAccent = useThemeColor({}, "partnerAccent");
	const [viewerItem, setViewerItem] = useState<WallItem | null>(null);

	const partnerName = space?.partnerName ?? "them";
	const cellSize = Math.floor(
		(width - Spacing[16] * 2 - Spacing[8]) / 2,
	);

	const rows = useMemo(
		() => packWallRows(toWallItems(moments)),
		[moments],
	);

	const handleOpenImage = useCallback((item: WallItem) => {
		setViewerItem(item);
	}, []);

	const handleCloseViewer = useCallback(() => {
		setViewerItem(null);
	}, []);

	const renderItem = useCallback(
		({ item }: { item: WallRow }) => (
			<MemoryWallRow
				accent={accent}
				background={background}
				border={border}
				cellSize={cellSize}
				muted={muted}
				onOpenImage={handleOpenImage}
				partnerAccent={partnerAccent}
				partnerName={partnerName}
				row={item}
			/>
		),
		[
			accent,
			background,
			border,
			cellSize,
			handleOpenImage,
			muted,
			partnerAccent,
			partnerName,
		],
	);

	const contentContainerStyle = useMemo(
		() => [
			styles.contentContainer,
			{
				paddingTop: Spacing[16],
				paddingBottom: insets.bottom + Spacing[24],
			},
		],
		[insets.bottom],
	);

	const viewerAuthorLabel = viewerItem
		? viewerItem.authorRole === "you"
			? "Kept by you"
			: `Kept by ${partnerName}`
		: "";

	return (
		<View style={[styles.root, { backgroundColor: background }]}>
			<Stack.Screen options={{ title: "Memory wall" }} />
			{rows.length === 0 ? (
				<View style={styles.emptyState}>
					<ThemedText type="caption" style={{ color: muted }}>
						Nothing on the wall yet — photos and voices you keep will
						gather here.
					</ThemedText>
				</View>
			) : (
				<FlatList
					contentContainerStyle={contentContainerStyle}
					data={rows}
					initialNumToRender={8}
					keyExtractor={(row) => row.key}
					renderItem={renderItem}
					showsVerticalScrollIndicator={false}
				/>
			)}

			<Modal
				animationType="fade"
				onRequestClose={handleCloseViewer}
				transparent
				visible={viewerItem !== null}
			>
				<Pressable
					accessibilityLabel="Close photo"
					accessibilityRole="button"
					onPress={handleCloseViewer}
					style={[
						styles.viewerBackdrop,
						{
							backgroundColor: background,
							paddingTop: insets.top + Spacing[16],
							paddingBottom: insets.bottom + Spacing[16],
						},
					]}
				>
					{viewerItem ? (
						<>
							<Image
								contentFit="contain"
								source={{ uri: viewerItem.uri }}
								style={styles.viewerImage}
							/>
							<View style={styles.viewerCaption}>
								<ThemedText type="caption" style={{ color: muted }}>
									{formatWallDate(viewerItem.occurredAt)} ·{" "}
									{viewerAuthorLabel}
								</ThemedText>
							</View>
						</>
					) : null}
				</Pressable>
			</Modal>
		</View>
	);
}

const styles = StyleSheet.create({
	root: {
		flex: 1,
	},
	contentContainer: {
		gap: Spacing[8],
		paddingHorizontal: Spacing[16],
	},
	imageRow: {
		flexDirection: "row",
		gap: Spacing[8],
	},
	imageCell: {
		borderRadius: Radii.md,
		overflow: "hidden",
	},
	imageCellImage: {
		height: "100%",
		width: "100%",
	},
	authorDot: {
		borderRadius: Radii.pill,
		borderWidth: 2,
		bottom: Spacing[8],
		height: 12,
		left: Spacing[8],
		position: "absolute",
		width: 12,
	},
	voiceRow: {
		gap: Spacing[8],
	},
	emptyState: {
		alignItems: "center",
		flex: 1,
		justifyContent: "center",
		paddingHorizontal: Spacing[32],
	},
	viewerBackdrop: {
		alignItems: "center",
		flex: 1,
		justifyContent: "center",
	},
	viewerImage: {
		flex: 1,
		height: "100%",
		width: "100%",
	},
	viewerCaption: {
		paddingTop: Spacing[12],
	},
});
