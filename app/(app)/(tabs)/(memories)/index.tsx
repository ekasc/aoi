import { FrostedBackdrop } from '@/components/ui/frosted-backdrop';
import { Ionicons } from "@expo/vector-icons";
import { MenuView, type MenuAction } from "@expo/ui/community/menu";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useReducedMotion } from "react-native-reanimated";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	Animated,
	FlatList,
	Pressable,
	ScrollView,
	StyleSheet,
	TextInput,
	useWindowDimensions,
	View,
	type ListRenderItemInfo,
	type NativeScrollEvent,
	type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MemorySky, fabBottomOffset } from "@/components/home/memory-sky";
import { SpaceAvatarButton } from "@/components/space/space-avatar-button";
import { GalleryTile } from "@/components/moments/gallery-tile";
import { MomentCard } from "@/components/moments/moment-card";
import { PhotoViewer, type ViewerPhoto } from "@/components/moments/photo-viewer";
import { PendingMemoryRow } from "@/components/moments/pending-memory-row";
import { ThemedText } from "@/components/themed-text";
import { ActionSheet } from "@/components/ui/action-sheet";
import { GlassSurface } from "@/components/ui/glass-surface";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Radii, Spacing, withAlpha } from "@/constants/theme";
import { getDaysTogether } from "@/features/time-together/time-together";
import { haptics } from "@/features/haptics/haptics";
import { useMoments } from "@/features/moments/moments-context";
import { useStoryFeed } from "@/features/moments/use-story-feed";
import {
	GALLERY_COLUMNS,
	buildGalleryRows,
	buildGallerySections,
	galleryPhotosOf,
	type GalleryPhoto,
	type GalleryRow,
} from "@/features/moments/gallery";
import {
	filterFeedMoments,
	groupFeedChronological,
	type FeedMonthSection,
	type FeedTypeFilter,
} from "@/features/moments/story-feed";
import { isOwnMoment } from "@/features/moments/ownership";
import { settleTargetForProgress } from "@/features/moments/header-settle";
import { useResurfaceNotification } from "@/features/moments/use-resurface-notification";
import type { Moment } from "@/features/moments/types";
import type { PendingRecord } from "@/features/composer/types";
import { useSpace } from "@/features/space/space-context";
import { useAoiTheme } from "@/features/theme/theme-context";
import { useThemeColor } from "@/hooks/use-theme-color";

/** Round FAB over the feed, clear of the docked system tab bar. */
const FAB_SIZE = 56;

type FeedRow =
	| { kind: "pending"; key: string; record: PendingRecord }
	| { kind: "month"; key: string; section: FeedMonthSection }
	| { kind: "moment"; key: string; moment: Moment };

/** Two presentations of one archive: the Story feed and the photo grid. */
type MemoriesView = "feed" | "gallery";

/** Mirrors styles.root maxWidth: tiles size to the list, not the window. */
const ROOT_MAX_WIDTH = 720;

/** Dense gallery gutters, in points. */
const GALLERY_GAP = 2;

/** Scroll-up distance past the deep point that reopens the header anywhere. */
const REOPEN_DISTANCE = 24;

/** Milliseconds a header settle/reopen takes (header-only; feed never moves). */
const HEADER_ANIM_DURATION = 220;



/** Archive filters, in the order they earn space. */
const FILTERS: { key: FeedTypeFilter; label: string }[] = [
	{ key: "all", label: "All" },
	{ key: "photos", label: "Photos" },
	{ key: "notes", label: "Notes" },
	{ key: "voice", label: "Voice" },
];

/**
 * Own-moment long-press actions. On iOS these render in a native SwiftUI
 * ContextMenu (blurred preview, HIG-standard): Edit, then destructive
 * Delete. Android and web keep the ActionSheet fallback below — MenuView
 * on those platforms is a passthrough around the trigger.
 */
const MOMENT_MENU_ACTIONS: MenuAction[] = [
	{ id: "edit", title: "Edit", image: "pencil" },
	{
		id: "delete",
		title: "Delete",
		image: "trash",
		attributes: { destructive: true },
	},
];

/**
 * Memories is one oldest-first archive with two presentations. The Feed is
 * the dashboard default: photo, note, and voice memories render inline in a
 * single scroll, grouped under subdued month headings that open their
 * chapter. The Gallery is the same archive as a dense, month-grouped photo
 * grid. Neither owns a second data source — the shared moments list is the
 * only feed input, paged by the same cursor the context owns. Unsent
 * memories pin to the top of the Feed. The compact sky stays pinned behind
 * the header, same as Plans.
 */
export default function MemoriesScreen() {
	const router = useRouter();
	const isFocused = useIsFocused();
	const insets = useSafeAreaInsets();
	const { width: windowWidth } = useWindowDimensions();
	const feed = useStoryFeed();
	const { moments: signalMoments, removeMoment } = useMoments();
	const { space } = useSpace();
	const [actionMoment, setActionMoment] = useState<Moment | null>(null);
	const [confirmMoment, setConfirmMoment] = useState<Moment | null>(null);
	const [isRemoving, setIsRemoving] = useState(false);
	const [removeError, setRemoveError] = useState("");
	const [keptNotice, setKeptNotice] = useState(false);
	const [view, setView] = useState<MemoriesView>("feed");
	const [switcherHidden, setSwitcherHidden] = useState(false);
	const [isSearching, setIsSearching] = useState(false);
	const [viewerPhoto, setViewerPhoto] = useState<{ photos: ViewerPhoto[]; index: number } | null>(null);
	const [query, setQuery] = useState("");
	const [typeFilter, setTypeFilter] = useState<FeedTypeFilter>("all");
	const [searchFocused, setSearchFocused] = useState(false);

	// Pinned overlay header: title row above the view switcher (always that
	// order). The feed scrolls underneath it, and the header condenses 1:1
	// with the scroll — no timed toggle, so nothing ever jumps: content only
	// moves exactly as much as the finger scrolls. The sky stays pinned
	// behind the header throughout.
	const TITLE_ROW = 56;
	const TABS_ROW = 52;
	const HEADER_GAP = Spacing[8];
	const HEADER_PAD_BOTTOM = Spacing[12];
	const searchExtra = isSearching ? 96 : 0;
	const headerExpanded =
		insets.top + TITLE_ROW + HEADER_GAP + TABS_ROW + HEADER_PAD_BOTTOM + searchExtra;
	// Condensed height: the title row survives; the gap + switcher row are shed.
	const headerCollapsed =
		insets.top + TITLE_ROW + HEADER_PAD_BOTTOM + searchExtra;
	// Scroll distance that fully condenses the header: exactly the shed row.
	const COLLAPSE_DISTANCE = HEADER_GAP + TABS_ROW;
	// Collapse progress, 0 open → 1 condensed. `collapse` runs the native
	// driver (opacity, scale); `collapseLayout` runs the JS driver (height);
	// `frost` runs the title-bar frost. Linkage sets them straight from the
	// scroll offset; settle/reopen animations own the values while set.
	const [collapse] = useState(() => new Animated.Value(0));
	const [collapseLayout] = useState(() => new Animated.Value(0));
	const [frost] = useState(() => new Animated.Value(0));
	const reduceMotion = useReducedMotion();
	// Linkage origin: the offset the shed distance is measured from. Zero at
	// the top; moved to the reopen point wherever the header comes back, so
	// recondensing stays gradual instead of snapping. Never negative
	// (settle-to-condensed requires resting at/past the shed distance), so
	// the top always rests exactly open.
	const originRef = useRef(0);
	// Deepest offset seen while condensed; scrolling up past it reopens.
	const maxYRef = useRef(0);
	const lastYRef = useRef(0);
	// Last applied progress (drives settle decisions); in-flight animation
	// handle, which owns the values while set and suppresses linkage.
	const progressRef = useRef(0);
	const settleRef = useRef<Animated.CompositeAnimation | null>(null);
	// Mirrors the condensed state in React state so the switcher leaves the
	// accessibility tree (and stops receiving taps) once fully faded. The ref
	// gates it so scrolls only re-render on the crossing, not per frame.
	const switcherHiddenRef = useRef(false);
	// Snap the header to an endpoint: header-only, over the static feed, so
	// content never moves. Resyncs the linkage origin on completion so later
	// scrolls continue without snapping.
	const settleHeader = useCallback(
		(target: 0 | 1) => {
			settleRef.current?.stop();
			switcherHiddenRef.current = target === 1;
			setSwitcherHidden(target === 1);
			progressRef.current = target;
			const duration = reduceMotion ? 0 : HEADER_ANIM_DURATION;
			const anim = Animated.parallel([
				Animated.timing(collapse, { toValue: target, duration, useNativeDriver: true }),
				Animated.timing(collapseLayout, { toValue: target, duration, useNativeDriver: false }),
			]);
			settleRef.current = anim;
			anim.start(() => {
				settleRef.current = null;
				originRef.current = lastYRef.current - target * COLLAPSE_DISTANCE;
				maxYRef.current = lastYRef.current;
			});
		},
		[collapse, collapseLayout, reduceMotion, COLLAPSE_DISTANCE],
	);
	// Scroll-linked condense: progress is the offset past the origin clamped
	// to the shed distance, so the header meets the rising feed with no gap
	// and no jump. Scrolling up 24px past the deep point reopens the header
	// anywhere in the feed — a header-only fade over the static list, so the
	// feed still never moves.
	// Oldest lives at the top, so scrolling back to it pages older history
	// above (pinned by maintainVisibleContentPosition, no jump). The arm
	// requires leaving the top first, so launch never cascades history.
	const topArmRef = useRef(false);
	const onScroll = useCallback(
		(event: NativeSyntheticEvent<NativeScrollEvent>) => {
			const y = Math.max(0, event.nativeEvent.contentOffset.y);
			lastYRef.current = y;
			// Frost tracks the absolute offset over the full shed distance, so
			// the sky stays crisp through the first stretch of scrolling and
			// only fully frosts once the header is condensed (or reopened
			// deep, where rows sit underneath it).
			frost.setValue(Math.min(1, y / COLLAPSE_DISTANCE));
			if (y > 200) {
				topArmRef.current = true;
			}
			if (y <= 1 && topArmRef.current && feed.hasMore && !feed.isPaging) {
				topArmRef.current = false;
				feed.loadMore();
			}
			if (settleRef.current) {
				return;
			}
			const progress = Math.min(1, Math.max(0, (y - originRef.current) / COLLAPSE_DISTANCE));
			if (progress >= 1) {
				maxYRef.current = Math.max(maxYRef.current, y);
				if (maxYRef.current - y > REOPEN_DISTANCE) {
					settleHeader(0);
					return;
				}
			} else {
				maxYRef.current = y;
			}
			progressRef.current = progress;
			collapse.setValue(progress);
			collapseLayout.setValue(progress);
			const hidden = progress >= 1;
			if (hidden !== switcherHiddenRef.current) {
				switcherHiddenRef.current = hidden;
				setSwitcherHidden(hidden);
			}
		},
		[collapse, collapseLayout, frost, settleHeader, feed, COLLAPSE_DISTANCE],
	);
	// Settle to an endpoint when the scroll comes to rest mid-condense: a
	// short list (or a slow drag) can otherwise park the header half-shed,
	// with the tabs half-faded and clipped.
	const onScrollSettle = useCallback(() => {
		if (settleRef.current) {
			return;
		}
		const target = settleTargetForProgress(progressRef.current, lastYRef.current, COLLAPSE_DISTANCE);
		if (target !== null) {
			settleHeader(target);
		}
	}, [settleHeader, COLLAPSE_DISTANCE]);
	// A fresh fling cancels the settle: linkage owns the values again from
	// wherever the stopped animation left them (near-linkage by construction).
	const onCancelSettle = useCallback(() => {
		settleRef.current?.stop();
		settleRef.current = null;
	}, []);
	// The title stays put and only scales down, so the title bar keeps a stable
	// left edge while the switcher row fades.
	const titleShrinkStyle = useMemo(
		() => ({
			transform: [
				{
					scale: collapse.interpolate({
						inputRange: [0, 1],
						outputRange: [1, 0.68],
					}),
				},
			],
		}),
		[collapse],
	);
	// The Feed/Gallery switcher fades out as the header condenses — opacity
	// only. The row itself is shed by the height below and clipped by the
	// header's overflow, so it fades and leaves together with its space.
	const tabsHideStyle = useMemo(
		() => ({
			opacity: collapse.interpolate({
				inputRange: [0, 1],
				outputRange: [1, 0],
			}),
		}),
		[collapse],
	);
	// The header condenses from the expanded height to the title bar as the
	// feed scrolls underneath it. Height runs on the JS driver; it is set
	// straight from the scroll offset (see onScroll), never timed.
	const headerLayoutStyle = useMemo(
		() => ({
			height: collapseLayout.interpolate({
				inputRange: [0, 1],
				outputRange: [headerExpanded, headerCollapsed],
			}),
		}),
		[collapseLayout, headerExpanded, headerCollapsed],
	);
	// Frosted ground behind the title bar: present whenever the feed has
	// moved (even with the header reopened mid-feed), so rows sliding
	// underneath always dissolve into frost instead of ghosting through the
	// title. Transparent at the very top, where the sky shows instead.
	const headerBackgroundStyle = useMemo(
		() => ({
			opacity: frost.interpolate({
				inputRange: [0, 1],
				outputRange: [0, 1],
			}),
		}),
		[frost],
	);
	const now = useMemo(() => new Date(), []);
	const muted = useThemeColor({}, "muted");
	const background = useThemeColor({}, "background");
	const accent = useThemeColor({}, "accent");
	const border = useThemeColor({}, "border");
	const surface = useThemeColor({}, "surface");
	const onAccent = useThemeColor({}, "onAccent");
	const text = useThemeColor({}, "textPrimary");
	const { mode } = useAoiTheme();
	// On pale-tinted light glass the near-white onAccent washes out, so the
	// glyph rides the accent itself there; dark glass keeps onAccent.
	const fabIconColor = mode === "dark" ? onAccent : accent;

	useResurfaceNotification(signalMoments);

	// Search + type filter are pure client filters over the loaded feed. The
	// Feed is the source; sections are regrouped from whatever survives so
	// month headings always match the visible rows. The Gallery reads the
	// same filtered list, then keeps only real photos. Pending rows are
	// hidden while filtering (they are transient, not archive).
	const isFiltering = query.trim().length > 0 || typeFilter !== "all";
	const shownMoments = useMemo(
		() => filterFeedMoments(feed.moments, { query, type: typeFilter }),
		[feed.moments, query, typeFilter],
	);
	// Oldest-first: the oldest memory sits at the top, so months read
	// oldest-first and each month's memories run oldest-first inside it —
	// the story reads top to bottom, newest at the bottom.
	const sections = useMemo(() => groupFeedChronological(shownMoments), [shownMoments]);
	const galleryRows = useMemo(
		() => buildGalleryRows(buildGallerySections(shownMoments)),
		[shownMoments],
	);

	const rows = useMemo<FeedRow[]>(() => {
		const out: FeedRow[] = [];
		// Unsent memories have no date yet, so they pin to the top of the
		// stream as an action tray, above the oldest month.
		if (!isFiltering) {
			for (const record of feed.pending) {
				out.push({ kind: "pending", key: `pending:${record.clientId}`, record });
			}
		}
		for (const section of sections) {
			out.push({ kind: "month", key: `month:${section.monthKey}`, section });
			for (const moment of section.moments) {
				out.push({ kind: "moment", key: `moment:${moment.id}`, moment });
			}
		}
		return out;
	}, [feed.pending, sections, isFiltering]);


	// Dense 3-column grid: tiles size to the padded list, whichever is
	// narrower (the capped content column or the window).
	const galleryTileSize = useMemo(() => {
		const contentWidth = Math.min(windowWidth, ROOT_MAX_WIDTH) - Spacing[24] * 2;
		const usable = contentWidth - GALLERY_GAP * (GALLERY_COLUMNS - 1);
		return Math.max(1, Math.floor(usable / GALLERY_COLUMNS));
	}, [windowWidth]);

	const handleSelectView = useCallback(
		(next: MemoriesView) => {
			setView(next);
			setViewerPhoto(null);
			// The incoming list mounts at its own top: reopen the header the
			// way a fresh list does. Values only — the native scroll view is
			// never commanded. A settle in flight is stopped first so its
			// completion cannot resync the origin to the outgoing list.
			originRef.current = 0;
			maxYRef.current = 0;
			lastYRef.current = 0;
			progressRef.current = 0;
			settleRef.current?.stop();
			settleRef.current = null;
			collapse.setValue(0);
			collapseLayout.setValue(0);
			frost.setValue(0);
			switcherHiddenRef.current = false;
			setSwitcherHidden(false);
		},
		[collapse, collapseLayout, frost],
	);

	const handleSelectFilter = useCallback((next: FeedTypeFilter) => {
		haptics.select();
		setTypeFilter(next);
	}, []);

	// Search is an on-demand control: the archive opens clean, and closing
	// search clears the filter so the whole archive returns.
	const handleToggleSearch = useCallback(() => {
		if (isSearching) {
			setQuery("");
			setTypeFilter("all");
			setSearchFocused(false);
		} else {
			haptics.select();
		}
		setIsSearching((prev) => !prev);
	}, [isSearching]);

	const handleClearFilters = useCallback(() => {
		setQuery("");
		setTypeFilter("all");
		setSearchFocused(false);
	}, []);

	const momentsById = useMemo(() => {
		const byId = new Map<string, Moment>();
		for (const moment of shownMoments) {
			byId.set(moment.id, moment);
		}
		return byId;
	}, [shownMoments]);

	// A just-kept memory flashes a quiet confirmation once its row lands in
	// the feed. The row itself is the proof; nothing scrolls or jumps. The
	// show/hide runs on timers (never a render-time sync) so positioning the
	// notice never cascades renders.
	const keptTick = feed.keptTick;
	const keptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(() => {
		if (keptTick === 0) {
			return;
		}
		const show = setTimeout(() => {
			setKeptNotice(true);
			if (keptTimerRef.current) {
				clearTimeout(keptTimerRef.current);
			}
			keptTimerRef.current = setTimeout(() => {
				keptTimerRef.current = null;
				setKeptNotice(false);
			}, 5000);
		}, 0);
		return () => {
			clearTimeout(show);
			if (keptTimerRef.current) {
				clearTimeout(keptTimerRef.current);
				keptTimerRef.current = null;
			}
		};
	}, [keptTick]);
	useEffect(() => {
		return () => {
			if (keptTimerRef.current) {
				clearTimeout(keptTimerRef.current);
			}
		};
	}, []);
	const handleDismissKeptNotice = useCallback(() => {
		setKeptNotice(false);
	}, []);

	const handleOpenEditor = useCallback(() => {
		if (process.env.EXPO_OS === "ios") {
			void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
		}
		router.push("/(app)/moment/new");
	}, [router]);

	// Capture intents from the Us tab land here: forward once to the
	// dedicated editor and clear the param so a back-press never replays it.
	const { compose } = useLocalSearchParams<{ compose?: string | string[] }>();
	const composeValue = Array.isArray(compose) ? compose[0] : compose;
	const consumedComposeRef = useRef<string | null>(null);
	useEffect(() => {
		if (!composeValue) {
			consumedComposeRef.current = null;
			return;
		}
		if (!isFocused) {
			return;
		}
		if (consumedComposeRef.current === composeValue) {
			return;
		}
		consumedComposeRef.current = composeValue;
		router.setParams({ compose: undefined });
		router.push({
			pathname: "/(app)/moment/new" as const,
			params: { compose: composeValue },
		});
	}, [composeValue, isFocused, router]);

	const handleOpenMonth = useCallback(
		(section: FeedMonthSection) => {
			router.push(`/(app)/chapter/${section.id}`);
		},
		[router],
	);

	const handleOpenMemory = useCallback(
		(moment: Moment) => {
			router.push({
				pathname: "/(app)/moment/[id]" as const,
				params: { id: moment.id, at: moment.occurredAt },
			});
		},
		[router],
	);

	const handleOpenPhoto = useCallback(
		(photo: GalleryPhoto) => {
			const moment = momentsById.get(photo.momentId);
			const title = moment?.title?.trim();
			setViewerPhoto({
				photos: [
					{
						uri: photo.uri,
						momentId: photo.momentId,
						label: title ? `Photo: ${title}` : "Memory photo",
					},
				],
				index: 0,
			});
		},
		[momentsById],
	);

	const handleCloseViewer = useCallback(() => {
		setViewerPhoto(null);
	}, []);

	// Feed photos open the whole set fullscreen: tap a print and the viewer
	// starts on that page, swiping across the rest of the memory's photos.
	const handleOpenFeedPhoto = useCallback(
		(momentId: string, photoIndex: number) => {
			const moment = momentsById.get(momentId);
			if (!moment) {
				return;
			}
			const galleryPhotos = galleryPhotosOf(moment);
			if (galleryPhotos.length === 0) {
				return;
			}
			const title = moment.title?.trim();
			setViewerPhoto({
				photos: galleryPhotos.map((photo) => ({
					uri: photo.uri,
					momentId: photo.momentId,
					label: title || "Memory photo",
				})),
				index: Math.min(Math.max(0, photoIndex), galleryPhotos.length - 1),
			});
		},
		[momentsById],
	);

	// The viewer keeps the parent context: opening the memory is the same
	// destination a tile's memory row would take, just from full screen.
	// The memory belongs to the currently visible photo.
	const handleOpenViewerMemory = useCallback(
		(photo: ViewerPhoto) => {
			const moment = momentsById.get(photo.momentId);
			setViewerPhoto(null);
			if (moment) {
				handleOpenMemory(moment);
			}
		}, [momentsById, handleOpenMemory]);

	const handleMomentLongPress = useCallback(
		(momentId: string) => {
			const moment = momentsById.get(momentId);
			if (moment && isOwnMoment(moment)) {
				setActionMoment(moment);
			}
		},
		[momentsById],
	);

	// iOS renders own-moment actions as a native ContextMenu instead of the
	// custom ActionSheet; other platforms keep the long-press sheet.
	const useNativeMomentMenu = process.env.EXPO_OS === "ios";

	const openEditForMoment = useCallback(
		(moment: Moment) => {
			router.push({
				pathname: "/(app)/moment/edit/[id]" as const,
				params: { id: moment.id, at: moment.occurredAt },
			});
		},
		[router],
	);

	const handleMomentMenuAction = useCallback(
		(moment: Moment, actionId: string) => {
			if (actionId === "edit") {
				openEditForMoment(moment);
				return;
			}
			if (actionId === "delete") {
				setConfirmMoment(moment);
				setRemoveError("");
			}
		},
		[openEditForMoment],
	);

	const feedKeyExtractor = useCallback((item: FeedRow) => item.key, []);
	const galleryKeyExtractor = useCallback((item: GalleryRow) => item.key, []);

	const renderFeedItem = useCallback(
		({ item, index }: ListRenderItemInfo<FeedRow>) => {
			if (item.kind === "month") {
				return (
					<View style={styles.feedRow}>
						<Pressable
							accessibilityLabel={`Open ${item.section.label} chapter`}
							accessibilityRole="button"
							onPress={() => handleOpenMonth(item.section)}
							style={[styles.monthRow, index === 0 ? styles.monthRowFirst : null]}
						>
							<ThemedText type="meta" style={{ color: muted, fontWeight: "600" }}>
								{item.section.label}
							</ThemedText>
							<Ionicons color={muted} name="chevron-forward" size={14} />
						</Pressable>
					</View>
				);
			}
			if (item.kind === "pending") {
				return (
					<View
						style={[
							styles.feedRow,
							styles.entryCard,
							{ borderColor: border, backgroundColor: surface },
						]}
					>
						<PendingMemoryRow
							record={item.record}
							isSending={feed.sendingIds.includes(item.record.clientId)}
						/>
					</View>
				);
			}
		const own = isOwnMoment(item.moment);
		const card = (
			<MomentCard
				moment={item.moment}
				presentation="timeline"
				nativeActionsMenu={
					own && useNativeMomentMenu
						? {
								actions: MOMENT_MENU_ACTIONS,
								title: item.moment.title?.trim() || "This moment",
								onAction: (event) => handleMomentMenuAction(item.moment, event),
							}
						: undefined
				}
				onActions={own && !useNativeMomentMenu ? handleMomentLongPress : undefined}
				onPhotoPress={handleOpenFeedPhoto}
				onLongPress={
					own && !useNativeMomentMenu ? handleMomentLongPress : undefined
				}
			/>
		);
		return (
			<View style={styles.feedRow}>
				{own && useNativeMomentMenu ? (
					<MenuView
						actions={MOMENT_MENU_ACTIONS}
						onPressAction={({ nativeEvent: { event } }) =>
							handleMomentMenuAction(item.moment, event)
						}
						shouldOpenOnLongPress
						testID="native-moment-menu"
						title={item.moment.title?.trim() || "This moment"}
					>
						{card}
					</MenuView>
				) : (
					card
				)}
			</View>
		);
		},
		[
			handleOpenMonth,
			handleOpenFeedPhoto,
			handleMomentLongPress,
			handleMomentMenuAction,
			feed.sendingIds,
			muted,
			border,
			surface,
			useNativeMomentMenu,
		],
	);

	const renderGalleryItem = useCallback(
		({ item }: ListRenderItemInfo<GalleryRow>) => {
			if (item.kind === "month") {
				return (
					<View style={styles.galleryMonthRow}>
						<ThemedText type="meta" style={{ color: muted, fontWeight: "600" }}>
							{item.label}
						</ThemedText>
					</View>
				);
			}
			return (
				<View style={styles.galleryGridRow}>
					{item.photos.map((photo, index) => (
						<GalleryTile
							accessibilityLabel={`Open photo ${item.startIndex + index + 1} from ${item.sectionLabel}`}
							key={photo.key}
							onPress={handleOpenPhoto}
							photo={photo}
							size={galleryTileSize}
						/>
					))}
				</View>
			);
		},
		[galleryTileSize, handleOpenPhoto, muted],
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
		openEditForMoment(momentToEdit);
	}, [actionMoment, openEditForMoment]);

	const handleRequestDelete = useCallback(() => {
		setConfirmMoment(actionMoment);
		setRemoveError("");
		setActionMoment(null);
	}, [actionMoment]);

	const actionSheetActions = useMemo(
		() => [
			{ label: "Edit", onPress: handleEditMoment, icon: "create-outline" as const },
			{
				label: "Delete",
				onPress: handleRequestDelete,
				variant: "destructive" as const,
				icon: "trash-outline" as const,
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
			<View style={styles.emptyState}>
				{isFiltering ? (
					<>
						<ThemedText type="meta" style={{ color: muted }}>
							No matches
						</ThemedText>
						<ThemedText type="title">Nothing here yet</ThemedText>
						<ThemedText type="body" style={{ color: muted }}>
							Try another word, or a different filter.
						</ThemedText>
						<View style={styles.emptyCta}>
							<Button label="Clear filters" onPress={handleClearFilters} />
						</View>
					</>
				) : feed.isLoading ? (
					<>
						<ThemedText type="meta" style={{ color: muted }}>
							Memories
						</ThemedText>
						<ThemedText type="body" style={{ color: muted }}>
							Opening your memories…
						</ThemedText>
					</>
				) : feed.error ? (
					<>
						<ThemedText type="meta" style={{ color: muted }}>
							Offline
						</ThemedText>
						<ThemedText type="title">Couldn&apos;t load your story</ThemedText>
						<ThemedText type="body" style={{ color: muted }}>
							Check your connection, nothing was lost.
						</ThemedText>
						<View style={styles.emptyCta}>
							<Button label="Try again" onPress={() => feed.refresh()} />
						</View>
					</>
				) : feed.totalCount === 0 && feed.pending.length === 0 ? (
					<>
						<ThemedText type="meta" style={{ color: muted }}>
							Begin
						</ThemedText>
						<ThemedText type="title">Your first memory</ThemedText>
						<ThemedText type="body" style={{ color: muted }}>
							A photo, a few lines, or a short recording, kept just
							for the two of you.
						</ThemedText>
						<View style={styles.emptyCta}>
							<Button
								label="Keep your first memory"
								onPress={handleOpenEditor}
							/>
						</View>
					</>
				) : (
					<>
						<ThemedText type="meta" style={{ color: muted }}>
							Gallery
						</ThemedText>
						<ThemedText type="title">No photos yet</ThemedText>
						<ThemedText type="body" style={{ color: muted }}>
							Photos you keep together will collect here.
						</ThemedText>
					</>
				)}
			</View>
		),
		[muted, handleOpenEditor, handleClearFilters, feed, isFiltering],
	);


	const listFooter = useMemo(() => {
		if (!feed.hasMore) {
			return null;
		}
		// An empty stream owns the empty state; paging controls only make
		// sense once at least one row exists.
		if (feed.totalCount === 0 && feed.pending.length === 0) {
			return null;
		}
		// Infinite scroll owns paging; a quiet caption confirms the fetch
		// instead of a second manual trigger next to onEndReached.
		if (!feed.isPaging) {
			return null;
		}
		return (
			<View style={styles.loadMoreWrap}>
				<ThemedText type="caption" style={{ color: muted }}>
					Loading earlier…
				</ThemedText>
			</View>
		);
	}, [feed, muted]);


	const contentContainerStyle = useMemo(
		() => [
			styles.contentContainer,
			{
				// The header is a pinned overlay; the list runs full-screen
				// underneath it, so content starts below the open header and
				// slides under the title bar as it condenses. The pad scrolls
				// with the content, 1:1 with the header shed — no gap, no jump.
				paddingTop: headerExpanded + Spacing[4],
				paddingBottom: fabBottomOffset(insets.bottom, process.env.EXPO_OS === "ios") + Spacing[8],
			},
		],
		[insets.bottom, headerExpanded],
	);

	// FAB floats over the feed, clear of the docked system tab bar.
	const fabBottom = useMemo(
		() => fabBottomOffset(insets.bottom, process.env.EXPO_OS === "ios"),
		[insets.bottom],
	);

	const rootStyle = useMemo(
		() => [
			styles.root,
			{
				backgroundColor: background,
			},
		],
		[background],
	);

	// The memory count behind the star canvas.
	const daysTogether = useMemo(
		() => getDaysTogether(space?.relationshipStartDate ?? null, now),
		[space?.relationshipStartDate, now],
	);

	return (
		<View style={rootStyle}>
			{/* Frosted page texture + sky: the header's backdrop, pinned at the
			    top. It is never faded or removed — only the switcher section
			    above it fades. */}
			<Animated.View
				accessible={false}
				accessibilityElementsHidden
				importantForAccessibility="no-hide-descendants"
				pointerEvents="none"
				style={StyleSheet.absoluteFill}
			>
				<FrostedBackdrop />
				<MemorySky compact moments={signalMoments} daysTogether={daysTogether} startDate={space?.relationshipStartDate ?? null} focused={isFocused} />
			</Animated.View>

			<View pointerEvents="box-none" style={styles.header}>
				<Animated.View
					style={[
						styles.headerInner,
						{ paddingTop: insets.top },
						headerLayoutStyle,
					]}
				>
					{/* Frosted ground behind the title bar for the condensed
					    state: blur keeps the pinned sky visible while rows
					    sliding underneath dissolve into it. Decorative: hidden
					    from the accessibility tree. */}
					<Animated.View
						accessible={false}
						accessibilityElementsHidden
						importantForAccessibility="no-hide-descendants"
						pointerEvents="none"
						style={[StyleSheet.absoluteFill, headerBackgroundStyle]}
					>
						<BlurView
							intensity={60}
							tint={mode === "dark" ? "dark" : "light"}
							style={StyleSheet.absoluteFill}
						/>
						<View
							style={[
								StyleSheet.absoluteFill,
								{ backgroundColor: withAlpha(background, 0.45) },
							]}
						/>
					</Animated.View>
					<View style={[styles.titleRow, { height: TITLE_ROW }]}>
						<Animated.View style={[styles.titleAnchor, titleShrinkStyle]}>
							<ThemedText type="display">Memories</ThemedText>
						</Animated.View>
						<View style={styles.titleActions}>
							<IconButton
								accessibilityLabel={isSearching ? "Close search" : "Search memories"}
								label={isSearching ? "Close search" : "Search memories"}
								onPress={handleToggleSearch}
								variant="secondary"
							>
								<Ionicons color={muted} name={isSearching ? "close" : "search"} size={18} />
							</IconButton>
							<SpaceAvatarButton />
						</View>
					</View>
					<Animated.View style={[styles.tabsRow, { height: TABS_ROW }, tabsHideStyle]}>
						<View style={styles.switchWrap}>
							<SegmentedControl
								accessibilityLabel="Memories view"
								hidden={switcherHidden}
								onChange={handleSelectView}
								options={[
									{
										value: "feed",
										label: "Feed",
										accessibilityHint: "Show memories oldest first",
									},
									{
										value: "gallery",
										label: "Gallery",
										accessibilityHint: "Show memory photos in a grid",
									},
								]}
								value={view}
							/>
						</View>
					</Animated.View>
					{isSearching ? (
						<>
							<View
								style={[
									styles.searchWrap,
									{
										borderColor: searchFocused ? accent : border,
										backgroundColor: surface,
									},
								]}
							>
								<Ionicons color={searchFocused ? accent : muted} name="search" size={18} />
								<TextInput
									accessibilityLabel="Search memories"
									autoCapitalize="none"
									autoComplete="off"
									autoCorrect={false}
									onBlur={() => setSearchFocused(false)}
									onChangeText={setQuery}
									onFocus={() => setSearchFocused(true)}
									placeholder="Search memories"
									placeholderTextColor={muted}
									returnKeyType="search"
									selectionColor={accent}
									spellCheck={false}
									style={[styles.searchInput, { color: text }]}
									value={query}
								/>
								{query.length > 0 ? (
									<Pressable
										accessibilityLabel="Clear search"
										accessibilityRole="button"
										hitSlop={13}
										onPress={() => setQuery("")}
										style={styles.searchClear}
									>
										<Ionicons color={muted} name="close-circle" size={18} />
									</Pressable>
								) : null}
							</View>
							<ScrollView
								contentContainerStyle={styles.chipRow}
								horizontal
								keyboardShouldPersistTaps="handled"
								showsHorizontalScrollIndicator={false}
							>
								{FILTERS.map((filter) => {
									const on = filter.key === typeFilter;
									return (
										<Pressable
											accessibilityLabel={`${filter.label} filter`}
											accessibilityRole="button"
											accessibilityState={{ selected: on }}
											hitSlop={4}
											key={filter.key}
											onPress={() => handleSelectFilter(filter.key)}
											style={({ pressed }) => [
												styles.chip,
												{
													borderColor: on ? accent : border,
													backgroundColor: on ? withAlpha(accent, 0.16) : surface,
												},
												pressed ? styles.pressed : null,
											]}
										>
											<ThemedText type="supporting" style={{ color: on ? accent : muted }}>
												{filter.label}
											</ThemedText>
										</Pressable>
									);
								})}
							</ScrollView>
						</>
					) : null}
				</Animated.View>
			</View>

			{keptNotice ? (
				<Pressable
					accessibilityLabel="Kept in your story. Dismiss."
					accessibilityLiveRegion="polite"
					accessibilityRole="button"
					onPress={handleDismissKeptNotice}
					style={[
						styles.keptOverlay,
						{
							top: headerExpanded + Spacing[8],
							backgroundColor: surface,
							borderColor: border,
						},
					]}
				>
					<ThemedText type="caption" style={{ color: muted }}>
						Kept in your story
					</ThemedText>
				</Pressable>
			) : null}

			{/* Keyboard belongs to composer; subscribing underlying archive to global keyboard frame events clamps header-adjusted negative offsets on sheet dismissal. */}
			<View style={styles.listWrap}>
			{view === "gallery" ? (
				<FlatList
					alwaysBounceVertical={false}
					bounces={false}
					contentInsetAdjustmentBehavior="never"
					contentContainerStyle={contentContainerStyle}
					onScroll={onScroll}
					onScrollEndDrag={onScrollSettle}
					onMomentumScrollBegin={onCancelSettle}
					onMomentumScrollEnd={onScrollSettle}
					scrollEventThrottle={16}
					// Older history prepends above: hold the visible row so
					// paging never shifts what the reader is looking at.
					maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
					data={galleryRows}
					key="gallery"
					keyboardDismissMode="on-drag"
					keyExtractor={galleryKeyExtractor}
					ListEmptyComponent={emptyState}
					ListFooterComponent={listFooter}
						onEndReached={() => feed.loadMore()}
					onEndReachedThreshold={0.5}
					onRefresh={() => feed.refresh()}
					refreshing={feed.isRefreshing}
					renderItem={renderGalleryItem}
					showsVerticalScrollIndicator={false}
					style={styles.list}
				/>
			) : (
				<FlatList
					alwaysBounceVertical={false}
					bounces={false}
					contentInsetAdjustmentBehavior="never"
					contentContainerStyle={contentContainerStyle}
					onScroll={onScroll}
					onScrollEndDrag={onScrollSettle}
					onMomentumScrollBegin={onCancelSettle}
					onMomentumScrollEnd={onScrollSettle}
					scrollEventThrottle={16}
					// Older history prepends above: hold the visible row so
					// paging never shifts what the reader is looking at.
					maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
					data={rows}
					key="feed"
					keyboardDismissMode="on-drag"
					keyExtractor={feedKeyExtractor}
					ListEmptyComponent={emptyState}
					ListFooterComponent={listFooter}
					onEndReached={() => feed.loadMore()}
					onEndReachedThreshold={0.5}
					onRefresh={() => feed.refresh()}
					refreshing={feed.isRefreshing}
					renderItem={renderFeedItem}
					showsVerticalScrollIndicator={false}
					style={styles.list}
				/>
			)}
			</View>
			<Pressable
				accessibilityLabel="Add memory"
				accessibilityRole="button"
				onPress={handleOpenEditor}
				style={({ pressed }) => [
					styles.fab,
					{
						bottom: fabBottom,
						opacity: pressed ? 0.85 : 1,
					},
				]}
			>
				<GlassSurface
					effect="clear"
					style={[
						styles.fabGlass,
						// Tinted glass on iOS: a low-opacity accent wash over
						// the clear material. Android keeps the denser wash
						// its fallback surface needs to read as a button.
						{
							backgroundColor: withAlpha(
								accent,
								process.env.EXPO_OS === "ios" ? 0.25 : 0.6
							),
						},
					]}
				>
					<Ionicons color={fabIconColor} name="add" size={26} />
				</GlassSurface>
			</Pressable>

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

			<PhotoViewer
				photos={viewerPhoto?.photos ?? []}
				initialIndex={viewerPhoto?.index ?? 0}
				onClose={handleCloseViewer}
				onOpenMemory={handleOpenViewerMemory}
				visible={viewerPhoto !== null}
			/>
		</View>
	);
}

const styles = StyleSheet.create({
	root: {
		flex: 1,
		maxWidth: ROOT_MAX_WIDTH,
		width: "100%",
		alignSelf: "center",
		paddingBottom: Spacing[0],
		gap: Spacing[8],
	},
	keptNotice: {
		alignSelf: "flex-start",
		paddingHorizontal: Spacing[24],
		minHeight: 44,
		justifyContent: "center",
		paddingVertical: Spacing[8],
	},
	controlsScrim: {
		position: "absolute",
		top: -Spacing[8],
		left: -Spacing[24],
		right: -Spacing[24],
		bottom: 0,
	},
	controls: {
		gap: Spacing[12],
		paddingTop: Spacing[8],
		paddingBottom: Spacing[8],
	},
	controlsRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: Spacing[12],
	},
	switchWrap: {
		flex: 1,
	},
	searchWrap: {
		flexDirection: "row",
		alignItems: "center",
		gap: Spacing[8],
		minHeight: 44,
		paddingHorizontal: Spacing[12],
		borderRadius: Radii.card,
		borderCurve: "continuous",
		borderWidth: StyleSheet.hairlineWidth,
	},
	searchInput: {
		flex: 1,
		fontSize: 16,
		paddingVertical: Spacing[8],
	},
	searchClear: {
		alignItems: "center",
		justifyContent: "center",
		minWidth: 28,
		minHeight: 28,
	},
	chipRow: {
		gap: Spacing[8],
		paddingRight: Spacing[16],
	},
	chip: {
		flexDirection: "row",
		alignItems: "center",
		gap: Spacing[4],
		minHeight: 44,
		paddingHorizontal: Spacing[12],
		borderRadius: Radii.pill,
		borderCurve: "continuous",
		borderWidth: StyleSheet.hairlineWidth,
	},
	pressed: {
		opacity: 0.6,
	},
	list: {
		flex: 1,
	},
	listWrap: {
		flex: 1,
	},
	header: {
		position: "absolute",
		top: 0,
		left: 0,
		right: 0,
		zIndex: 10,
	},
	headerInner: {
		paddingHorizontal: Spacing[24],
		paddingBottom: Spacing[12],
		gap: Spacing[8],
		// The header height animates on collapse; clip the shed switcher row
		// instead of letting it spill below the title bar.
		overflow: "hidden",
	},
	titleRow: {
		flexDirection: "row",
		alignItems: "flex-end",
		justifyContent: "space-between",
	},
	titleActions: {
		flexDirection: "row",
		alignItems: "center",
		gap: Spacing[8],
	},
	titleAnchor: {
		// Scale shrinks toward the top-left corner, not the centre.
		transformOrigin: "top left",
	},
	tabsRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: Spacing[12],
	},
	skyLayer: {
		position: "absolute",
		top: 0,
		left: 0,
		right: 0,
	},
	keptOverlay: {
		position: "absolute",
		left: Spacing[24],
		right: Spacing[24],
		alignItems: "center",
		justifyContent: "center",
		minHeight: 44,
		zIndex: 5,
		paddingHorizontal: Spacing[16],
		paddingVertical: Spacing[8],
		borderRadius: Radii.pill,
		borderWidth: StyleSheet.hairlineWidth,
	},
	entryCard: {
		borderRadius: Radii.lg,
		borderCurve: "continuous",
		borderWidth: StyleSheet.hairlineWidth,
		padding: Spacing[16],
		marginHorizontal: Spacing[24],
		marginBottom: Spacing[16],
	},
	fab: {
		position: "absolute",
		right: Spacing[24],
		width: FAB_SIZE,
		height: FAB_SIZE,
		borderRadius: FAB_SIZE / 2,
		alignItems: "center",
		justifyContent: "center",
		boxShadow: "0 4px 12px rgba(0, 0, 0, 0.25)",
	},
	fabGlass: {
		flex: 1,
		alignSelf: "stretch",
		alignItems: "center",
		justifyContent: "center",
	},
	feedRow: {},
	monthRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: Spacing[8],
		minHeight: 44,
		paddingHorizontal: Spacing[24],
		// Air above a section header, tighter below it: 24 over, 12 under.
		// `monthRowFirst` cancels the top half for the first section, which
		// already sits below the pinned header.
		paddingTop: Spacing[24],
		paddingBottom: Spacing[12],
	},
	monthRowFirst: {
		paddingTop: Spacing[0],
	},
	galleryMonthRow: {
		paddingHorizontal: Spacing[24],
		paddingTop: Spacing[8],
		paddingBottom: Spacing[8],
	},
	galleryGridRow: {
		flexDirection: "row",
		gap: GALLERY_GAP,
		paddingHorizontal: Spacing[24],
		paddingBottom: GALLERY_GAP,
	},
	loadMoreWrap: {
		alignItems: "center",
		paddingVertical: Spacing[8],
	},
	contentContainer: {
		paddingBottom: Spacing[24],
		paddingTop: Spacing[0],
	},
	emptyState: {
		marginTop: Spacing[40],
		paddingHorizontal: Spacing[24],
		gap: Spacing[16],
	},
	emptyCta: {
		marginTop: Spacing[8],
	},
});
