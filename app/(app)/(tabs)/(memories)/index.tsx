import { FrostedBackdrop } from '@/components/ui/frosted-backdrop';
import { Ionicons } from "@expo/vector-icons";
import { MenuView, type MenuAction } from "@expo/ui/community/menu";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Animated, {
	FadeIn,
	LayoutAnimationConfig,
	FadeOut,
	ReduceMotion,
	useAnimatedStyle,
	useSharedValue,
} from 'react-native-reanimated';
import {
	AppState,
	FlatList,
	Pressable,
	StyleSheet,
	useWindowDimensions,
	View,
	type LayoutChangeEvent,
	type ListRenderItemInfo,
	type NativeScrollEvent,
	type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MemorySky, compactSkyHeightForWindow, fabBottomOffset } from "@/components/home/memory-sky";
import { useSkyEntry } from '@/components/home/sky-entry-provider';
import { SkyWelcome } from '@/components/home/sky-welcome';
import { GalleryMonthHeader } from "@/components/moments/gallery-month-header";
import {
	GalleryPhotoTile,
	GalleryVideoTile,
	GalleryVoiceTile,
} from "@/components/moments/gallery-tile";
import { MomentCard } from "@/components/moments/moment-card";
import { FirstPageDedication } from '@/components/moments/first-page-dedication';
import { PhotoViewer, type ViewerPhoto } from "@/components/moments/photo-viewer";
import type { PhotoOrigin } from "@/components/moments/zoomable-photo";
import { PendingMemoryRow } from "@/components/moments/pending-memory-row";
import { ThemedText } from "@/components/themed-text";
import { ActionSheet } from "@/components/ui/action-sheet";
import { GlassSurface } from "@/components/ui/glass-surface";
import { Pressed } from "@/components/ui/pressed";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Elevation, Motion, Radii, Spacing, shadow, withAlpha } from "@/constants/theme";
import { getDaysTogether } from "@/features/time-together/time-together";
import { useMoments } from "@/features/moments/moments-context";
import { useStoryFeed } from "@/features/moments/use-story-feed";
import { deriveFirstPage } from '@/features/moments/first-page';
import { useFirstPage } from '@/features/moments/use-first-page';
import { useSession } from '@/features/session/session-context';
import { haptics } from '@/features/haptics/haptics';
import {
	GALLERY_COLUMNS,
	buildGalleryRows,
	buildGallerySections,
	galleryPhotosOf,
	galleryTileLabel,
	type GalleryItem,
	type GalleryRow,
} from "@/features/moments/gallery";
import {
	feedRowIndexForMomentId,
	firstUnreadPartnerId,
	galleryRowIndexForMomentId,
	loadSeenCursor,
	newestOccurredAt,
	saveSeenCursor,
	scrollListToIndexOrEnd,
} from "@/features/moments/seen-cursor";
import {
	groupFeedChronological,
	type FeedMonthSection,
} from "@/features/moments/story-feed";
import { isOwnMoment } from "@/features/moments/ownership";
import { useResurfaceNotification } from "@/features/moments/use-resurface-notification";
import type { Moment } from "@/features/moments/types";
import type { PendingRecord } from "@/features/composer/types";
import { useSpace } from "@/features/space/space-context";
import { useAoiTheme } from "@/features/theme/theme-context";
import { useThemeColor } from "@/hooks/use-theme-color";
import {
	relationshipCopy,
} from "@/features/relationship/relationship-age";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { useRelationshipAge } from "@/features/relationship/use-relationship-age";

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

/**
 * Distance the reader travels away from the top before the top edge is
 * allowed to page again. Shortened to the list's actual scroll range, so a
 * feed with less range than this can still arm.
 */
const TOP_ARM_DISTANCE = 200;

/** How long the "Kept in your story" confirmation stays up. */
const KEPT_NOTICE_DURATION_MS = 5000;

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
 * memories pin to the top of the Feed. The fixed header carries the title
 * and the Feed/Gallery switcher side by side; Space lives in the tab bar.
 * The compact sky stays pinned behind the header, same as Plans.
 */
export default function MemoriesScreen() {
  const { entry, progress: foregroundProgress, arrival, reveal, enter } = useSkyEntry();
  const outgoingStyle = useAnimatedStyle(() => ({ opacity: 1 - (arrival?.value ?? 1) }));
  const arrivalStyle = useAnimatedStyle(() => ({ opacity: foregroundProgress?.value ?? 1 }));
  const invitationStyle = useAnimatedStyle(() => ({
    opacity: 1 - (foregroundProgress?.value ?? 0),
  }));
	const router = useRouter();
	const isFocused = useIsFocused();
	const insets = useSafeAreaInsets();
	const { width: windowWidth, height: windowHeight } = useWindowDimensions();
	const skyRevealHeight = compactSkyHeightForWindow(windowHeight);
	const skyRevealStyle = useAnimatedStyle(() => ({
		transform: [{ translateY: -skyRevealHeight * (1 - (foregroundProgress?.value ?? 1)) }],
	}));
	// `?view=gallery` opens the wall directly (and lets the dev preview route
	// land on it). Read once, as the initial state: arriving must not re-run
	// the switcher's scroll reset mid-session.
	const { compose, view: viewParam } = useLocalSearchParams<{
		compose?: string | string[];
		view?: string | string[];
	}>();
	const feed = useStoryFeed();
	const { moments: signalMoments, removeMoment } = useMoments();
	const { space } = useSpace();
	const { user } = useSession();
	const { ready: firstPageReady, dismissed: firstPageDismissed, dismiss: dismissFirstPage,
		remember: rememberFirstPage, error: firstPageError, retry: retryFirstPage } = useFirstPage(user?.id ?? null, space?.id);
	const firstPage = useMemo(() => deriveFirstPage({ space, viewerId: user?.id ?? null, moments: feed.moments,
		pendingCount: feed.pending.length, ready: firstPageReady && !feed.isLoading && !feed.error, dismissed: firstPageDismissed }),
		[space, user?.id, feed.moments, feed.pending.length, firstPageReady, firstPageDismissed, feed.isLoading, feed.error]);
	useEffect(() => {
		if (firstPageReady && !firstPageDismissed && !feed.isLoading && !feed.error && feed.moments.some((moment) => isOwnMoment(moment) || moment.authorId === user?.id)) {
			void dismissFirstPage();
		}
	}, [firstPageReady, firstPageDismissed, dismissFirstPage, feed.isLoading, feed.error, feed.moments, user?.id]);
	const relationshipAge = useRelationshipAge(space?.relationshipStartDate);
	const sharingInvite = space != null && !space.partnerJoined;
	const { copied: copiedInvite, copy: copyInvite } = useCopyToClipboard();
	const handleShareInvite = useCallback(() => {
		copyInvite(space?.inviteCode ?? '');
	}, [copyInvite, space?.inviteCode]);

	const adaptiveCopy = useMemo(
		() => relationshipCopy(relationshipAge.tone),
		[relationshipAge.tone],
	);
	const [now, setNow] = useState(() => new Date());
	useEffect(() => {
		const subscription = AppState.addEventListener("change", (state) => {
			if (state === "active") setNow(new Date());
		});
		return () => subscription.remove();
	}, []);
	const [actionMoment, setActionMoment] = useState<Moment | null>(null);
	const [confirmMoment, setConfirmMoment] = useState<Moment | null>(null);
	const [isRemoving, setIsRemoving] = useState(false);
	const [removeError, setRemoveError] = useState("");
	const [keptNotice, setKeptNotice] = useState(false);
	const [view, setView] = useState<MemoriesView>(() =>
		(Array.isArray(viewParam) ? viewParam[0] : viewParam) === "gallery"
			? "gallery"
			: "feed",
	);
	const [viewerPhoto, setViewerPhoto] = useState<{
		photos: ViewerPhoto[];
		index: number;
		/** Window frame of the tile that opened this session (morph origin). */
		origin?: PhotoOrigin;
	} | null>(null);

	// Pinned overlay header: a single fixed row — the title on the left, the
	// Feed/Gallery switcher on the right. The feed scrolls underneath it; the
	// sky stays pinned behind it throughout. The switcher lives in the title
	// row so it is always reachable, and Space lives in the tab bar.
	const TITLE_ROW = 56;
	const HEADER_PAD_BOTTOM = Spacing[12];
	const headerHeight = insets.top + TITLE_ROW + HEADER_PAD_BOTTOM;
	// Absolute scroll distance over which the title-bar frost fades in, so
	// rows sliding underneath dissolve into frost instead of ghosting through
	// the title. Transparent at the very top, where the sky shows instead.
	const FROST_DISTANCE = 60;
	// `frost` runs the title-bar frost. This used to be a React Native
	// Animated.Value written with setValue from onScroll, which put a
	// 60fps JS-thread update and a style interpolation on the app's main
	// screen. As a shared value the scroll handler and the style both run on
	// the UI thread and React never hears about scrolling.
	const frost = useSharedValue(0);
	// Oldest lives at the top, so scrolling back to it pages older history
	// above (pinned by maintainVisibleContentPosition, no jump). This arm is
	// the only automatic, scroll-driven paging trigger: older pages land at
	// the top, so a bottom-edge trigger would fetch the wrong edge — and on a
	// feed shorter than the viewport it would fire during layout and chew
	// through history the reader never asked for. The header carries a manual
	// control for the gestures a short feed cannot make (see listHeader). The
	// arm requires leaving the top first, so launch never cascades history —
	// and it is measured against the range the list actually has (see
	// onScroll), so a short feed still arms.
	const topArmRef = useRef(false);
	// The feed reads oldest-first and older history prepends above, so the
	// present lives at the END of the list. Without landing there, the reader
	// arrives at the oldest memory they have and scrolls forward through their
	// own past to reach today — the archive running one way and the reader the
	// other. Both lists land on the newest, until the reader takes over.
	const feedListRef = useRef<FlatList<FeedRow> | null>(null);
	const galleryListRef = useRef<FlatList<GalleryRow> | null>(null);
	const readerScrolledRef = useRef(false);
	// Where a fresh screen lands: the first unread partner post, so the
	// reader moves forward through everything new — or the newest post when
	// caught up. Undefined until the stored cursor loads; rows stay gated
	// until then so nothing paints, slices, or jumps on a guess.
	const [seenCursor, setSeenCursor] = useState<string | null | undefined>(undefined);
	const seenStoredRef = useRef<string | null>(null);
	// Placement is observed, never assumed: set once a landing jump is seen
	// deep in a list (or the list proves too short to jump), and never again
	// for this space. Until then the unread target owns a sliced prefix.
	const [placed, setPlaced] = useState(false);

	// A new space decides and places fresh: the resolve below resets both,
	// so a stale cursor or placement never leaks across accounts.
	const placementSpaceRef = useRef<string | null>(null);
	useEffect(() => {
		let live = true;
		void loadSeenCursor(space?.id).then((cursor) => {
			if (!live) {
				return;
			}
			if (placementSpaceRef.current !== (space?.id ?? null)) {
				placementSpaceRef.current = space?.id ?? null;
				setPlaced(false);
			}
			seenStoredRef.current = cursor;
			setSeenCursor(cursor);
		});
		return () => {
			live = false;
		};
	}, [space?.id]);
	// Each presentation keeps its own scroll position: switching tabs never
	// moves, mounts, or jumps a list, so there is no flash.
	// The landing jump (top to newest on first content) would flash if
	// painted: each list stays invisible until it is already where it
	// belongs — jumped deep, or too short to jump at all. One way only;
	// later data never re-hides a placed list.
	const [readyView, setReadyView] = useState({ feed: false, gallery: false });
	useEffect(() => {
		if (firstPage.kind === 'welcome' && !entry && isFocused && view === 'feed' && readyView.feed) {
			void rememberFirstPage();
		}
	}, [firstPage.kind, entry, isFocused, view, readyView.feed, rememberFirstPage]);
	const viewportH = useRef({ feed: 0, gallery: 0 });
	const contentH = useRef({ feed: 0, gallery: 0 });
	const markReady = useCallback((presented: MemoriesView) => {
		setReadyView((ready) => (ready[presented] ? ready : { ...ready, [presented]: true }));
	}, []);
	const handleScrollBeginDrag = useCallback(() => {
		// A real drag: the reader owns the position from here.
		readerScrolledRef.current = true;
	}, []);
	// Both presentations write the same two values: the frost ramp (UI
	// thread) and the paging arm (JS, because it decides to fetch). Only the
	// visible list ever scrolls, so there is nothing to arbitrate.
	const trackScroll = useCallback(
		(event: NativeSyntheticEvent<NativeScrollEvent>) => {
			const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
			const y = Math.max(0, contentOffset.y);
			// Frost tracks the absolute offset over a short ramp, so the sky
			// stays crisp through the first stretch of scrolling and rows
			// sliding underneath the fixed header dissolve into frost. A
			// plain assignment on a shared value: the header style is a
			// UI-thread `useAnimatedStyle`, so the interpolation and the
			// opacity write both happen off the JS thread now.
			frost.value = Math.min(1, y / FROST_DISTANCE);
			// The arm is a distance travelled away from the top, but a feed
			// that cannot travel the whole way (a short archive) must still
			// be able to reach older history: the distance shrinks to the
			// range the list has. A list with no range at all never scrolls,
			// so its header owns an explicit control instead (see listHeader).
			const range = Math.max(0, contentSize.height - layoutMeasurement.height);
			if (y >= Math.min(TOP_ARM_DISTANCE, range) && y > 0) {
				topArmRef.current = true;
			}
			if (y <= 1 && topArmRef.current && feed.hasMore && !feed.isPaging) {
				topArmRef.current = false;
				feed.loadMore();
			}
		},
		[feed, frost],
	);
	// A scroll from deep in a list proves that list has landed: reveal it
	// and place it. Each list reports for itself, so one list's scroll can
	// never ready, place, or move the other.
	const handleFeedScroll = useCallback(
		(event: NativeSyntheticEvent<NativeScrollEvent>) => {
			const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
			const y = Math.max(0, contentOffset.y);
			if (y > 40) {
				markReady('feed');
				setPlaced(true);
			}
			// Reading through the bottom marks the archive seen, up to its
			// newest moment. Writes only ever move forward, and only on
			// genuine advance, so resting at the bottom is free.
			if (
				y + layoutMeasurement.height >= contentSize.height - layoutMeasurement.height
			) {
				const newest = newestOccurredAt(feed.moments);
				if (newest && (!seenStoredRef.current || newest > seenStoredRef.current)) {
					seenStoredRef.current = newest;
					void saveSeenCursor(space?.id, newest);
				}
			}
			trackScroll(event);
		},
		[markReady, trackScroll, feed.moments, space?.id],
	);
	const handleGalleryScroll = useCallback(
		(event: NativeSyntheticEvent<NativeScrollEvent>) => {
			const y = Math.max(0, event.nativeEvent.contentOffset.y);
			if (y > 40) {
				markReady('gallery');
				setPlaced(true);
			}
			trackScroll(event);
		},
		[markReady, trackScroll],
	);
	// Frosted ground behind the title bar: present whenever the feed has
	// moved (even with the header reopened mid-feed), so rows sliding
	// underneath always dissolve into frost instead of ghosting through the
	// title. Transparent at the very top, where the sky shows instead.
	const headerBackgroundStyle = useAnimatedStyle(() => ({ opacity: frost.value }));
	const muted = useThemeColor({}, "muted");
	const background = useThemeColor({}, "background");
	const accent = useThemeColor({}, "accent");
	const accentInk = useThemeColor({}, "accentInk");
	const border = useThemeColor({}, "border");
	const surface = useThemeColor({}, "surface");
	const onAccent = useThemeColor({}, "onAccent");
	const danger = useThemeColor({}, "danger");
	const shadowColor = useThemeColor({}, "shadow");
	const { mode } = useAoiTheme();
	// On pale-tinted light glass the near-white onAccent washes out, so the
	// glyph rides the accent itself there; dark glass keeps onAccent.
	const fabIconColor = mode === "dark" ? onAccent : accentInk;

	useResurfaceNotification(signalMoments);

	// The feed is the source, unfiltered: sections are regrouped from the
	// loaded moments so month headings always match the visible rows. The
	// Gallery reads the same list, then keeps only real photos.
	const shownMoments = feed.moments;
	// Oldest-first: the oldest memory sits at the top, so months read
	// oldest-first and each month's memories run oldest-first inside it —
	// the story reads top to bottom, newest at the bottom.
	const sections = useMemo(() => groupFeedChronological(shownMoments), [shownMoments]);
	const gallerySections = useMemo(
		() => buildGallerySections(shownMoments),
		[shownMoments],
	);

	const galleryRows = useMemo(
		() => buildGalleryRows(gallerySections),
		[gallerySections],
	);

	// The album the full-screen viewer pages through: every tile the wall
	// shows, in the order the wall shows them, whatever kind each one is. The
	// Gallery is the only surface that opens this set — the Feed keeps its own
	// per-memory set, so nothing here changes what a feed photo does.
	const galleryAlbum = useMemo<ViewerPhoto[]>(
		() =>
			gallerySections.flatMap((section) =>
				section.items.map((item) => {
					const context = `${section.label}`;
					return {
						kind: item.kind,
						uri: item.uri,
						momentId: item.momentId,
						posterUri: item.posterUri,
						seed: item.key,
						label: galleryTileLabel(item, context),
					};
				}),
			),
		[gallerySections],
	);

	const rows = useMemo<FeedRow[]>(() => {
		const out: FeedRow[] = [];
		// Unsent memories have no date yet, so they pin to the top of the
		// stream as an action tray, above the oldest month.
		for (const record of feed.pending) {
			out.push({ kind: "pending", key: `pending:${record.clientId}`, record });
		}
		for (const section of sections) {
			out.push({ kind: "month", key: `month:${section.monthKey}`, section });
			for (const moment of section.moments) {
				out.push({ kind: "moment", key: `moment:${moment.id}`, moment });
			}
		}
		return out;
	}, [feed.pending, sections]);

	// The unread target, decided from the archive: the first unread partner
	// post to read forward from, or null for the newest when caught up.
	// Undefined until the cursor loads.
	const unreadTargetId = useMemo<string | null | undefined>(() => {
		if (seenCursor === undefined) {
			return undefined;
		}
		if (seenCursor === null) {
			return null;
		}
		return firstUnreadPartnerId(feed.moments, seenCursor);
	}, [seenCursor, feed.moments]);

	// What each list actually renders. Before the cursor loads, nothing: a
	// guess here paints, slices, or jumps on stale state. With an unread
	// target decided and nothing placed yet, each list shows only through
	// that row — the landing puts it at the end, exactly, with no measuring.
	const displayRows = useMemo(() => {
		if (seenCursor === undefined) {
			return [];
		}
		if (placed || !unreadTargetId) {
			return rows;
		}
		const index = feedRowIndexForMomentId(rows, unreadTargetId);
		return index < 0 ? rows : rows.slice(0, index + 1);
	}, [seenCursor, placed, unreadTargetId, rows]);

	const displayGalleryRows = useMemo(() => {
		if (seenCursor === undefined) {
			return [];
		}
		if (placed || !unreadTargetId) {
			return galleryRows;
		}
		const index = galleryRowIndexForMomentId(galleryRows, unreadTargetId);
		return index < 0 ? galleryRows : galleryRows.slice(0, index + 1);
	}, [seenCursor, placed, unreadTargetId, galleryRows]);

	// Places a fresh list exactly once: the unread target when there is one,
	// the newest otherwise. Later content changes never re-place — pagination
	// prepends and refreshes all leave the position to the reader.
	const landForContent = useCallback(
		(presented: MemoriesView) => {
			if (
				placed ||
			readerScrolledRef.current ||
			feed.moments.length === 0 ||
			seenCursor === undefined
			) {
				return;
			}
			const ref = presented === 'feed' ? feedListRef : galleryListRef;
			if (seenCursor === null) {
				// First run: the archive as found is already seen.
				const newest = newestOccurredAt(feed.moments);
				if (newest) {
					seenStoredRef.current = newest;
				void saveSeenCursor(space?.id, newest);
				}
			}
			if (unreadTargetId) {
				const index =
					presented === 'feed'
						? feedRowIndexForMomentId(rows, unreadTargetId)
						: galleryRowIndexForMomentId(galleryRows, unreadTargetId);
				scrollListToIndexOrEnd(ref.current, index);
			} else {
				try {
					ref.current?.scrollToEnd({ animated: false });
				} catch {
					// A list that cannot scroll keeps its opening frame.
				}
			}
		},
		[
				placed,
				feed.moments,
				seenCursor,
				unreadTargetId,
				rows,
				galleryRows,
				space?.id,
			],
	);

	const handleFeedContentSizeChange = useCallback(
		(_width: number, height: number) => {
			contentH.current.feed = height;
			landForContent('feed');
			if (height <= viewportH.current.feed) {
				markReady('feed');
				setPlaced(true);
			}
		},
		[landForContent, markReady],
	);
	const handleGalleryContentSizeChange = useCallback(
		(_width: number, height: number) => {
			contentH.current.gallery = height;
			landForContent('gallery');
			if (height <= viewportH.current.gallery) {
				markReady('gallery');
				setPlaced(true);
			}
		},
		[landForContent, markReady],
	);
	const handleFeedLayout = useCallback(
		(event: LayoutChangeEvent) => {
			viewportH.current.feed = event.nativeEvent.layout.height;
		},
		[],
	);
	const handleGalleryLayout = useCallback(
		(event: LayoutChangeEvent) => {
			viewportH.current.gallery = event.nativeEvent.layout.height;
		},
		[],
	);

	// Dense grid, edge to edge: tiles size to the list itself, whichever is
	// narrower (the capped content column or the window), and only the 2pt
	// gutters come out of that width. A row fills that width whatever it
	// holds: a month with one photo drew a third of a row and left the rest
	// blank, which reads as a tile that failed to arrive, not as a grid.
	const contentWidth = useMemo(
		() => Math.min(windowWidth, ROOT_MAX_WIDTH),
		[windowWidth],
	);
	const galleryTileSizeFor = useCallback(
		(count: number) => {
			const columns = Math.max(1, Math.min(count, GALLERY_COLUMNS));
			const usable = contentWidth - GALLERY_GAP * (columns - 1);
			return Math.max(1, Math.floor(usable / columns));
		},
		[contentWidth],
	);

	const handleSelectView = useCallback(
		(next: MemoriesView) => {
			if (next === view) {
				return;
			}
			setView(next);
			setViewerPhoto(null);
			// Both lists stay mounted at their own offsets, so the switch
			// moves nothing: no mount, no jump to newest, no flash — and the
			// header is fixed, so there is nothing to restore. The paging arm
			// is disarmed: without a landing jump, a stale arm must not spend
			// itself on a page the reader never asked for.
			topArmRef.current = false;
		},
		[view],
	);

	const momentsById = useMemo(() => {
		const byId = new Map<string, Moment>();
		for (const moment of shownMoments) {
			byId.set(moment.id, moment);
		}
		return byId;
	}, [shownMoments]);

	// A just-kept memory flashes a quiet confirmation once its row lands in
	// the feed. The row itself is the proof; nothing scrolls or jumps. One
	// timer owns the whole lifetime — shown on the next tick (so positioning
	// the notice never syncs state during a commit) and hidden when it
	// expires — and React clears it on unmount like any other effect cleanup.
	const keptTick = feed.keptTick;
	const keptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(() => {
		if (keptTick === 0) {
			return;
		}
		const show = setTimeout(() => {
			setKeptNotice(true);
			keptTimerRef.current = setTimeout(() => {
				keptTimerRef.current = null;
				setKeptNotice(false);
			}, KEPT_NOTICE_DURATION_MS);
		}, 0);
		return () => {
			clearTimeout(show);
			if (keptTimerRef.current) {
				clearTimeout(keptTimerRef.current);
				keptTimerRef.current = null;
			}
		};
	}, [keptTick]);
	const handleDismissKeptNotice = useCallback(() => {
		if (keptTimerRef.current) {
			clearTimeout(keptTimerRef.current);
			keptTimerRef.current = null;
		}
		setKeptNotice(false);
	}, []);

	const handleOpenEditor = useCallback(() => {
		if (process.env.EXPO_OS === "ios") {
			void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
		}
		router.push("/(app)/moment/new");
	}, [router]);
	const handleLeaveSomething = useCallback(() => {
		haptics.tap();
		router.push({ pathname: '/(app)/moment/new', params: { dedication: 'partner' } });
	}, [router]);
	const handleSkipFirstPage = useCallback(() => { void dismissFirstPage(); }, [dismissFirstPage]);

	// Capture intents from the Us tab land here: forward once to the
	// dedicated editor and clear the param so a back-press never replays it.
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
		// Only the id is needed, so the Feed's month sections and the Gallery's
		// dividers open the same chapter without one borrowing the other's type.
		(section: { id: string }) => {
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

	const handleCloseViewer = useCallback(() => {
		setViewerPhoto(null);
	}, []);

	// Feed photos open the whole set fullscreen: tap a print and the viewer
	// starts on that page, swiping across the rest of the memory's photos.
	const handleOpenFeedPhoto = useCallback(
		(momentId: string, photoIndex: number, origin?: PhotoOrigin) => {
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
				origin,
			});
		},
		[momentsById],
	);

	// A wall tile opens the album at the tile the reader touched, and swiping
	// moves to the next piece of media — photo, clip or voice note alike. The
	// index comes from the item's stable key, so a tap on any tile lands on
	// that tile even after the wall has paged older history in behind it.
	const handleOpenGalleryItem = useCallback(
		(item: GalleryItem, origin?: PhotoOrigin) => {
			const tappedIndex = galleryAlbum.findIndex(
				(candidate) => candidate.seed === item.key,
			);
			if (tappedIndex < 0) {
				return;
			}
			setViewerPhoto({ photos: galleryAlbum, index: tappedIndex, origin });
		},
		[galleryAlbum],
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
				// An Undated section is not a month: there is no chapter behind it,
				// so it reads as a heading instead of a link that cannot resolve.
				const openable = item.section.monthKey !== "undated";
				return (
					<View>
						{openable ? (
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
						) : (
							<ThemedText type="meta" style={{ color: muted, fontWeight: "600" }}>
								{item.section.label}
							</ThemedText>
						)}
					</View>
				);
			}
			if (item.kind === "pending") {
				return (
					<View
						style={[
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
				actionsInset={FAB_SIZE}
				moment={item.moment}
				presentation="timeline"
				// The ellipsis is the explicit route to a moment's actions and
				// is offered on every platform: it used to exist only where the
				// long-press was not already opening a native menu, which left
				// iOS rows with no visible affordance at all. Here the long-press
				// and the ellipsis do different things, so neither is redundant.
				onActions={own ? handleMomentLongPress : undefined}
				onPhotoPress={handleOpenFeedPhoto}
				onLongPress={
					own && !useNativeMomentMenu ? handleMomentLongPress : undefined
				}
			/>
		);
		return (
			<View>
				{firstPage.kind === 'welcome' && firstPage.momentId === item.moment.id ? (
					<ThemedText type="subheading" style={styles.welcomeLine}>
						{firstPage.authorName} left something here for you.
					</ThemedText>
				) : null}
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
				{firstPage.kind === 'welcome' && firstPage.momentId === item.moment.id ? (
					<View style={styles.welcomeActions}>
						<Button label="Leave something back" variant="ghost" onPress={handleLeaveSomething} />
						<Button label="Not now" variant="ghost" onPress={handleSkipFirstPage} />
					</View>
				) : null}
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
			firstPage, handleLeaveSomething, handleSkipFirstPage,
		],
	);

	const renderGalleryItem = useCallback(
		({ item, index }: ListRenderItemInfo<GalleryRow>) => {
			if (item.kind === "month") {
				return (
					<GalleryMonthHeader
						first={index === 0}
						onOpen={handleOpenMonth}
						section={item.section}
					/>
				);
			}
			// One tile in a row has the row to itself, and a full-width square
			// would crop it to a block: it draws as a 16:9 banner instead.
			const rowSize = galleryTileSizeFor(item.items.length);
			const rowHeight =
				item.items.length === 1 ? Math.round(rowSize * (9 / 16)) : undefined;
			return (
				<View style={styles.galleryGridRow}>
					{item.items.map((tile, column) => {
						const position = `${item.itemStartIndex + column + 1} of ${item.itemTotal}`;
						const context = `${position} from ${item.sectionLabel}`;
						const name = galleryTileLabel(tile, context);
						if (tile.kind === "voice") {
							return (
								<GalleryVoiceTile
									accessibilityLabel={`Open voice note ${context}`}
									item={tile}
									key={tile.key}
									onPress={handleOpenGalleryItem}
									height={rowHeight}
									size={rowSize}
								/>
							);
						}
						if (tile.kind === "video") {
							return (
								<GalleryVideoTile
									accessibilityLabel={`Open video ${name}`}
									item={tile}
									key={tile.key}
									onPress={handleOpenGalleryItem}
									height={rowHeight}
									size={rowSize}
								/>
							);
						}
						return (
							<GalleryPhotoTile
								accessibilityLabel={`Open photo ${context}`}
								item={tile}
								key={tile.key}
								onPress={handleOpenGalleryItem}
								height={rowHeight}
								size={rowSize}
							/>
						);
					})}
				</View>
			);
		},
		[galleryTileSizeFor, handleOpenGalleryItem, handleOpenMonth],
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
			// The faces of the empty list are async states, so the switch
			// between them is announced instead of silently swapping text.
			<View accessibilityLiveRegion="polite" style={styles.emptyState}>
				{feed.isLoading || (user && !firstPageReady && !firstPageError) ? (
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
					firstPage.kind === 'dedication' ? (
						<FirstPageDedication partnerName={firstPage.partnerName} waiting={firstPage.waiting}
							onCompose={handleLeaveSomething} onSkip={handleSkipFirstPage} />
					) : (
						<>
							<ThemedText type="meta" style={{ color: muted }}>
								Begin
							</ThemedText>
							<ThemedText type="title">{adaptiveCopy.memoryTitle}</ThemedText>
							<ThemedText type="body" style={{ color: muted }}>
								{adaptiveCopy.memoryBody}
							</ThemedText>
							<View style={styles.emptyCta}>
								<Button
									label={adaptiveCopy.memoryButton}
									onPress={handleOpenEditor}
								/>
							</View>
						</>
					)
				) : (
					<>
						<ThemedText type="meta" style={{ color: muted }}>
							Gallery
						</ThemedText>
						<ThemedText type="title">No media yet</ThemedText>
						<ThemedText type="body" style={{ color: muted }}>
							Photos, videos and voice notes you keep together
							collect here.
						</ThemedText>
					</>
				)}
			</View>
		),
		[muted, handleOpenEditor, feed, adaptiveCopy, firstPage, handleLeaveSomething, handleSkipFirstPage, user, firstPageReady, firstPageError],
	);
	const firstPageFooter = sharingInvite || firstPageError ? (
		<View style={styles.firstPageFooter}>
			{sharingInvite ? (
				<>
					<ThemedText type="caption" style={{ color: muted }}>
						{space?.partnerName?.trim() || 'Your partner'} hasn&apos;t joined yet.
					</ThemedText>
					<Button label={copiedInvite ? 'Code copied' : 'Copy invite code'} disabled={!space?.inviteCode} variant="ghost" onPress={handleShareInvite} />
					{copiedInvite ? <ThemedText type="caption" accessibilityLiveRegion="polite" style={{ color: muted }}>Send it to them however you like.</ThemedText> : null}
				</>
			) : null}
			{firstPageError ? (
				<>
					<ThemedText type="caption" accessibilityRole="alert">{firstPageError}</ThemedText>
					<Button label="Try again" variant="ghost" onPress={firstPageReady ? handleSkipFirstPage : retryFirstPage} />
				</>
			) : null}
		</View>
	) : null;


	// Older history prepends above the current rows, so the fetch control
	// belongs at the TOP of the list. One slot, two shapes: the in-flight
	// caption, and — whenever the archive has more to give and nothing is in
	// flight — a control the reader can ask directly. The top edge still pages
	// on its own for a scrollable feed (see onScroll), but a feed that fits its
	// viewport never scrolls, so it has no top-edge gesture to make: this control
	// is how its older history stays reachable. Nothing here pages unasked.
	const listHeader = useMemo(() => {
		if (!feed.hasMore) {
			return null;
		}
		// An empty stream owns the empty state; paging controls only make
		// sense once at least one row exists.
		if (feed.totalCount === 0 && feed.pending.length === 0) {
			return null;
		}
		if (feed.isPaging) {
			return (
				<View accessibilityLiveRegion="polite" style={styles.loadMoreWrap}>
					<ThemedText type="caption" style={{ color: muted }}>
						Loading earlier…
					</ThemedText>
				</View>
			);
		}
		// A page that failed keeps its cursor, so the same control asks for the
		// same page again — but it says so instead of looking like a page that
		// simply has not arrived.
		if (feed.pagingError) {
			return (
				<View accessibilityLiveRegion="polite" style={styles.loadMoreWrap}>
					<Pressable
						accessibilityHint="Loads memories from before the ones on screen"
						accessibilityLabel="Couldn't load earlier memories. Try again"
						accessibilityRole="button"
						onPress={feed.loadMore}
						style={styles.loadEarlier}
					>
						<ThemedText type="caption" style={{ color: danger }}>
									Couldn&apos;t load earlier memories. Try again
						</ThemedText>
					</Pressable>
				</View>
			);
		}
		return (
			<View style={styles.loadMoreWrap}>
				<Pressable
					accessibilityHint="Loads memories from before the ones on screen"
					accessibilityLabel="Load earlier memories"
					accessibilityRole="button"
					onPress={feed.loadMore}
					style={styles.loadEarlier}
				>
					<ThemedText type="caption" style={{ color: accentInk }}>
						Load earlier memories
					</ThemedText>
				</Pressable>
			</View>
		);
	}, [feed, muted, accentInk, danger]);


	const contentContainerStyle = useMemo(
		() => [
			styles.contentContainer,
			{
				// The header is a pinned overlay; the list runs full-screen
				// underneath it, so content starts below the fixed header and
				// slides under the title bar as it scrolls. The pad scrolls
				// with the content — no gap, no jump.
				// The end clears the floating FAB with room to spare, so the
				// newest memory never parks underneath it.
				paddingTop: headerHeight + Spacing[4],
				paddingBottom: fabBottomOffset(insets.bottom, process.env.EXPO_OS === "ios") + FAB_SIZE + Spacing[24],
			},
		],
		[insets.bottom, headerHeight],
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
			    top. It is never faded or removed. */}
            <Animated.View
				accessible={false}
				accessibilityElementsHidden
				importantForAccessibility="no-hide-descendants"
				pointerEvents="none"
				style={StyleSheet.absoluteFill}
			>
				<FrostedBackdrop />
                <View style={[styles.skyRevealClip, { height: skyRevealHeight }]}>
                <Animated.View style={[StyleSheet.absoluteFill, skyRevealStyle]} testID="sky-top-down-reveal">
                <MemorySky compact moments={signalMoments} daysTogether={daysTogether} startDate={space?.relationshipStartDate ?? null} focused={isFocused && !entry} onSceneLayout={entry?.kind === 'arriving' ? reveal : undefined} />
                </Animated.View>
                </View>
            </Animated.View>

            {entry ? (
              <Animated.View pointerEvents={entry.kind === 'welcome' ? 'auto' : 'none'}
                accessibilityElementsHidden={entry.kind !== 'welcome'} aria-hidden={entry.kind !== 'welcome'}
                importantForAccessibility={entry.kind === 'welcome' ? 'auto' : 'no-hide-descendants'}
                style={[StyleSheet.absoluteFill, invitationStyle]} testID="sky-welcome">
                <SkyWelcome details={entry.details} onEnter={enter} />
              </Animated.View>
            ) : null}

            {entry?.kind === 'arriving' ? (
              <Animated.View pointerEvents="none" accessible={false} accessibilityElementsHidden aria-hidden
                importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill, outgoingStyle]} testID="outgoing-setup-form">
                <LayoutAnimationConfig skipEntering skipExiting>
                  {entry.source}
                </LayoutAnimationConfig>
              </Animated.View>
            ) : null}

            {!entry || entry.kind === 'fading' ? <Animated.View pointerEvents={entry ? 'none' : 'auto'} accessibilityElementsHidden={!!entry}
              aria-hidden={!!entry} importantForAccessibility={entry ? 'no-hide-descendants' : 'auto'} style={[{ flex: 1 }, arrivalStyle]}>
            <View pointerEvents="box-none" style={styles.header}>
				<View
					style={[
						styles.headerInner,
						{ paddingTop: insets.top, height: headerHeight },
					]}
				>
					{/* Frosted ground behind the title bar: blur keeps the pinned
					    sky visible while rows sliding underneath dissolve into
					    it. Decorative: hidden from the accessibility tree. */}
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
						<ThemedText type="title">Memories</ThemedText>
						<View style={styles.viewSwitch}>
							<SegmentedControl
								accessibilityLabel="Memories view"
								onChange={handleSelectView}
								size="compact"
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
					</View>
				</View>
			</View>

			{keptNotice ? (
				// Arrives and leaves. It is dismissible, so without an exit it
				// used to vanish out from under the finger the reader had just
				// tapped. Leaving is quicker than arriving: the screen is
				// getting on with it, not asking for another look.
				<Animated.View
					entering={FadeIn.duration(Motion.fast).reduceMotion(ReduceMotion.System)}
					exiting={FadeOut.duration(Motion.exit).reduceMotion(ReduceMotion.System)}
					pointerEvents="box-none"
					style={styles.keptLayer}
				>
				<Pressable
					accessibilityLabel={`${sharingInvite ? `Here for ${space?.partnerName || 'them'} when they arrive` : 'Kept in your story'}. Dismiss.`}
					accessibilityLiveRegion="polite"
					accessibilityRole="button"
					onPress={handleDismissKeptNotice}
					style={[
						styles.keptOverlay,
						{
							top: headerHeight + Spacing[8],
							backgroundColor: surface,
							borderColor: border,
						},
					]}
				>
					<ThemedText type="caption" style={{ color: muted }}>
						{sharingInvite ? `Here for ${space?.partnerName || 'them'} when they arrive.` : 'Kept in your story'}
					</ThemedText>
				</Pressable>
				</Animated.View>
			) : null}

			{/* Keyboard belongs to composer; subscribing underlying archive to global keyboard frame events clamps header-adjusted negative offsets on sheet dismissal. */}
			{/* Both presentations stay mounted at their own offsets, stacked
			    with only the live one visible, audible, and touchable: switching
			    tabs reveals instead of rebuilding, so there is no mount, no
			    jump to newest, and no flash. */}
			<View style={styles.listWrap}>
				<View
					accessibilityElementsHidden={view !== 'gallery'}
					aria-hidden={view !== 'gallery'}
					importantForAccessibility={view === 'gallery' ? 'auto' : 'no-hide-descendants'}
					pointerEvents={view === 'gallery' ? 'auto' : 'none'}
					style={[
						styles.listLayer,
						view !== 'gallery' && styles.listHidden,
						!readyView.gallery && styles.listPending,
					]}
					testID="gallery-layer"
				>
				<FlatList
					alwaysBounceVertical={false}
					bounces={false}
					contentInsetAdjustmentBehavior="never"
					contentContainerStyle={contentContainerStyle}
					onScroll={handleGalleryScroll}
					// The header is a pinned overlay, so the list's own
					// contentInset is zero and the spinner would draw at
					// y=0, underneath it.
					progressViewOffset={headerHeight}
					scrollEventThrottle={16}
					// Older history prepends above: hold the visible row so
					// paging never shifts what the reader is looking at.
					maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
					data={displayGalleryRows}
					onContentSizeChange={handleGalleryContentSizeChange}
					onLayout={handleGalleryLayout}
					onScrollBeginDrag={handleScrollBeginDrag}
					ref={galleryListRef}
					key="gallery"
					keyboardDismissMode="on-drag"
					keyExtractor={galleryKeyExtractor}
					ListEmptyComponent={seenCursor === undefined ? null : emptyState}
					ListFooterComponent={firstPageFooter}
					ListHeaderComponent={listHeader}
					onRefresh={() => feed.refresh()}
					refreshing={feed.isRefreshing}
					renderItem={renderGalleryItem}
					showsVerticalScrollIndicator={false}
					style={styles.list}
				/>
				</View>
				<View
					accessibilityElementsHidden={view !== 'feed'}
					aria-hidden={view !== 'feed'}
					importantForAccessibility={view === 'feed' ? 'auto' : 'no-hide-descendants'}
					pointerEvents={view === 'feed' ? 'auto' : 'none'}
					style={[
						styles.listLayer,
						view !== 'feed' && styles.listHidden,
						!readyView.feed && styles.listPending,
					]}
					testID="feed-layer"
				>
				<FlatList
					alwaysBounceVertical={false}
					bounces={false}
					contentInsetAdjustmentBehavior="never"
					contentContainerStyle={contentContainerStyle}
					onScroll={handleFeedScroll}
					progressViewOffset={headerHeight}
					scrollEventThrottle={16}
					// Older history prepends above: hold the visible row so
					// paging never shifts what the reader is looking at.
					maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
					data={displayRows}
					onContentSizeChange={handleFeedContentSizeChange}
					onLayout={handleFeedLayout}
					onScrollBeginDrag={handleScrollBeginDrag}
					ref={feedListRef}
					key="feed"
					keyboardDismissMode="on-drag"
					keyExtractor={feedKeyExtractor}
					ListEmptyComponent={seenCursor === undefined ? null : emptyState}
					ListFooterComponent={firstPageFooter}
					ListHeaderComponent={listHeader}
					onRefresh={() => feed.refresh()}
					refreshing={feed.isRefreshing}
					renderItem={renderFeedItem}
					showsVerticalScrollIndicator={false}
					style={styles.list}
				/>
				</View>
			</View>
			<Pressable
				accessibilityLabel="Add memory"
				accessibilityRole="button"
				onPress={handleOpenEditor}
				style={({ pressed }) => [
					styles.fab,
					{
						bottom: fabBottom,
						boxShadow: shadow(Elevation.floating, shadowColor),
					},
					pressed ? Pressed.onMedia : undefined,
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

            </Animated.View> : null}
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
				origin={viewerPhoto?.origin}
				onClose={handleCloseViewer}
				onOpenMemory={handleOpenViewerMemory}
				visible={viewerPhoto !== null}
			/>
		</View>
	);
}

const styles = StyleSheet.create({
	firstPageFooter: { paddingHorizontal: Spacing[24], paddingVertical: Spacing[16], alignItems: 'flex-start' },
	welcomeLine: { paddingHorizontal: Spacing[24], paddingTop: Spacing[24], paddingBottom: Spacing[12] },
	welcomeActions: { paddingHorizontal: Spacing[16], paddingBottom: Spacing[24], alignItems: 'flex-start' },
	skyRevealClip: {
		position: 'absolute',
		top: 0,
		left: 0,
		right: 0,
		overflow: 'hidden',
	},
	root: {
		flex: 1,
		maxWidth: ROOT_MAX_WIDTH,
		width: "100%",
		alignSelf: "center",
		paddingBottom: Spacing[0],
		gap: Spacing[8],
	},
	list: {
		flex: 1,
	},
	listWrap: {
		flex: 1,
	},
	// Both presentations fill the same box, stacked: the live one shows,
	// the idle one holds its scroll position invisibly underneath.
	listLayer: {
		position: 'absolute',
		top: 0,
		left: 0,
		right: 0,
		bottom: 0,
	},
	listHidden: {
		opacity: 0,
	},
	// A list that has not landed yet stays invisible: the alternative is a
	// frame of the top of the archive before the jump to newest.
	listPending: {
		opacity: 0,
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
	},
	titleRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: Spacing[12],
	},
	// The Feed/Gallery switcher rides the title row: flexible so it squeezes
	// on narrow phones, capped so it never crowds the title on wide ones.
	viewSwitch: {
		flex: 1,
		maxWidth: 200,
	},
	keptLayer: {
		position: "absolute",
		left: 0,
		right: 0,
		top: 0,
		zIndex: 5,
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
	},
	fabGlass: {
		flex: 1,
		alignSelf: "stretch",
		alignItems: "center",
		justifyContent: "center",
	},
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
	galleryGridRow: {
		flexDirection: "row",
		gap: GALLERY_GAP,
		paddingBottom: GALLERY_GAP,
	},
	loadMoreWrap: {
		alignItems: "center",
		paddingVertical: Spacing[8],
	},
	loadEarlier: {
		alignItems: "center",
		justifyContent: "center",
		minHeight: 44,
		paddingHorizontal: Spacing[24],
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
