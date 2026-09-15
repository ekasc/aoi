import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  StyleSheet,
  useWindowDimensions,
  View,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  OPEN_EASING,
  OPEN_MORPH_DELAY,
  OPEN_MORPH_DURATION,
  ZoomablePhoto,
  backdropFor,
  type PhotoOrigin,
  type ViewerHome,
  type ViewerMorph,
} from '@/components/moments/zoomable-photo';

import { ViewerVideoPage, ViewerVoicePage } from '@/components/moments/viewer-media-page';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { haptics } from '@/features/haptics/haptics';
import { useThemeColor } from '@/hooks/use-theme-color';

export type ViewerPageKind = 'photo' | 'video' | 'voice';

/** How long a page that has no thumbnail to morph into takes to arrive. */
const FADE_DURATION = 180;

export type ViewerPhoto = {
  /**
   * What this page holds. The Feed only ever pages photos (it shows video
   * and voice in place, on the card); the Gallery's album pages all three.
   * Optional so every existing caller stays a photo page.
   */
  kind?: ViewerPageKind;
  /** Raw media URI; staged paths resolve here at the media boundary. */
  uri: string;
  /** Announced label for this page. */
  label: string;
  /** Owning memory id — the parent context for Open memory. */
  momentId: string;
  /** Video still, used while the clip's page is off-screen. */
  posterUri?: string | null;
  /** Shape seed for a voice note's sound print. Defaults to the URI. */
  seed?: string;
};

export type PhotoViewerProps = {
  visible: boolean;
  photos: ViewerPhoto[];
  /** Page the viewer opens on; swiping moves freely after. */
  initialIndex?: number;
  /**
   * Window frame of the thumbnail this session was tapped on: the session
   * grows out of it and every dismiss morphs back into it. Optional — without
   * one the viewer simply presents and fades.
   */
  origin?: PhotoOrigin;
  onClose: () => void;
  /** Opens the owning memory of the currently visible photo. */
  onOpenMemory: (photo: ViewerPhoto) => void;
};

/**
 * Full-screen photo viewer over the current screen: a swipeable set of
 * zoomable photos, a Close control, a page counter for sets, and an
 * Open-memory link that returns to the parent memory of the visible photo.
 * Nothing else.
 *
 * The modal is transparent with `overFullScreen` (the one pairing iOS
 * accepts) and draws its own scrim, so a dismiss drag fades the scrim and
 * reveals the screen behind instead of flashing the system background.
 * Motion is system-gated: the modal fade and the image transition collapse
 * to none under reduced motion. Paging and gestures stay, since the finger
 * drives them.
 */
/**
 * Puts the pager on the session's page and keeps it there.
 *
 * `initialScrollIndex` alone is not enough: the list mounts inside a Modal,
 * which on some platforms lays out a frame after the scroll would have been
 * applied, so the scroll no-ops and the viewer opens on the first page while
 * the counter names the tapped one. Re-asserting the position once the list
 * has laid out costs nothing when the first attempt worked.
 */
function useCanonicalPage(
  listRef: React.RefObject<FlatList<ViewerPhoto> | null>,
  index: number,
) {
  const scrollToPage = useCallback(() => {
    if (index <= 0) {
      return;
    }
    // getItemLayout makes this exact; the guard is for a list that has not
    // measured yet, where FlatList would otherwise throw.
    try {
      listRef.current?.scrollToIndex({ animated: false, index });
    } catch {
      // A pager that cannot scroll yet keeps the opening frame; the reader
      // can still swipe, and nothing about the session depends on this.
    }
  }, [index, listRef]);
  return scrollToPage;
}

export function PhotoViewer({
  visible,
  photos,
  initialIndex = 0,
  origin,
  onClose,
  onOpenMemory,
}: PhotoViewerProps) {
  const reduceMotion = useReducedMotion();
  const total = photos.length;
  // One canonical opening index. The list's scroll position, the counter,
  // and the Open-memory target all read it, so they cannot disagree: an
  // empty set or an out-of-range tap clamps once, here.
  const safeInitialIndex = Math.max(0, Math.min(initialIndex, Math.max(total - 1, 0)));
  // The session's identity is part of the key: a set that changes under an
  // open viewer mounts a fresh session at the canonical index instead of
  // keeping a scroll position that no longer matches the counter. The key
  // fingerprints the photos themselves — a length is not a set, and a
  // hand-rolled join can collide when a URI contains the separator — and
  // never includes `page`, so swiping inside a session neither remounts
  // nor snaps back.
  const sessionKey = `${JSON.stringify(
    photos.map((photo) => [photo.momentId, photo.uri]),
  )}:${safeInitialIndex}`;

  if (!visible || total === 0) {
    return null;
  }

  return (
    <Modal
      // Never fade the Modal itself: the overlay's own zoom IS the
      // presentation, and two animations on the same open read as a flicker.
      animationType="none"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible
    >
      <GestureHandlerRootView accessibilityViewIsModal style={styles.root}>
        <ViewerSession
          key={sessionKey}
          photos={photos}
          initialIndex={safeInitialIndex}
          origin={origin}
          onClose={onClose}
          onOpenMemory={onOpenMemory}
        />
      </GestureHandlerRootView>
    </Modal>
  );
}

/**
 * One viewing session. Mounted fresh per session key, so page, paging
 * lock, and dismiss fade all start at rest without any reset logic: a
 * drag-to-dismiss can't leave the next opening faded, and closing via X
 * while zoomed can't leave paging locked.
 */
function ViewerSession({
  photos,
  initialIndex,
  origin,
  onClose,
  onOpenMemory,
}: {
  photos: ViewerPhoto[];
  initialIndex: number;
  origin?: PhotoOrigin;
  onClose: () => void;
  onOpenMemory: (photo: ViewerPhoto) => void;
}) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const background = useThemeColor({}, 'background');
  const textPrimary = useThemeColor({}, 'textPrimary');
  const muted = useThemeColor({}, 'muted');
  const [page, setPage] = useState(initialIndex);
  const listRef = useRef<FlatList<ViewerPhoto>>(null);
  const scrollToInitialPage = useCanonicalPage(listRef, initialIndex);
  // An enlarged photo locks horizontal paging so its pan owns both axes. The
  // lock arrives when a pinch begins and lifts when the photo is back at
  // rest, so paging can never start against a zoomed photo.
  const [pagerLocked, setPagerLocked] = useState(false);
  // The Close control asks the visible photo to play the dismiss morph.
  const [closing, setClosing] = useState(false);
  // Once a dismiss is under way the viewer stops taking touches: the photo is
  // only finishing its landing, and the reader may already want the feed.
  const [handingBack, setHandingBack] = useState(false);
  // The whole transition lives here as ONE progress value (plus a little
  // finger attachment), so the open, the drag and the close are the same
  // animation at different points rather than three that have to agree.
  const t = useSharedValue(1);
  const residualX = useSharedValue(0);
  const residualY = useSharedValue(0);
  const sourceWidth = useSharedValue(0);
  const sourceHeight = useSharedValue(0);
  const overlay = useSharedValue(0);
  const morph = useMemo<ViewerMorph>(
    () => ({ t, residualX, residualY, sourceWidth, sourceHeight, overlay }),
    [overlay, residualX, residualY, sourceHeight, sourceWidth, t],
  );
  // Home: the thumbnail this session came from, in window coordinates.
  const homeX = useSharedValue(origin?.x ?? 0);
  const homeY = useSharedValue(origin?.y ?? 0);
  const homeWidth = useSharedValue(origin?.width ?? 0);
  const homeHeight = useSharedValue(origin?.height ?? 0);
  const homeRadius = useSharedValue(origin?.radius ?? 0);
  const homeValid = useSharedValue(!!origin);
  const home = useMemo<ViewerHome>(
    () => ({
      x: homeX,
      y: homeY,
      width: homeWidth,
      height: homeHeight,
      radius: homeRadius,
      valid: homeValid,
    }),
    [homeHeight, homeRadius, homeValid, homeWidth, homeX, homeY],
  );
  useEffect(() => {
    homeX.value = origin?.x ?? 0;
    homeY.value = origin?.y ?? 0;
    homeWidth.value = origin?.width ?? 0;
    homeHeight.value = origin?.height ?? 0;
    homeRadius.value = origin?.radius ?? 0;
    homeValid.value = !!origin;
  }, [homeHeight, homeRadius, homeValid, homeWidth, homeX, homeY, origin]);

  // The overlay presents once the viewer has laid out AND the visible photo's
  // clip box has laid out, so the zoom starts from real geometry rather than
  // geometry React has not committed yet (which is what put an earlier
  // attempt off-centre). A timer is the failsafe: a gate that never opens
  // leaves an invisible Modal eating every touch, which reads as a frozen app,
  // so the overlay appears anyway and the zoom is simply skipped.
  const [laidOut, setLaidOut] = useState(false);
  // Two flags on purpose. The failsafe opens the OVERLAY so it can never
  // swallow touches, but the zoom must not run on geometry nobody reported:
  // keying both off one flag would let the failsafe morph against a guess.
  const [geometryReady, setGeometryReady] = useState(false);
  const [overlayFailsafe, setOverlayFailsafe] = useState(false);
  const handleRootLayout = useCallback(() => {
    setLaidOut(true);
  }, []);
  useEffect(() => {
    const task = setTimeout(() => setOverlayFailsafe(true), 400);
    return () => clearTimeout(task);
  }, []);
  const handleImageReady = useCallback(() => {
    setGeometryReady(true);
  }, []);
  const handleDismissStart = useCallback(() => {
    setHandingBack(true);
  }, []);
  // Only a photo has a clip box to wait for: a video or a voice page has no
  // geometry to morph out of, and gating its presentation on one would hold
  // the page behind the failsafe for no reason.
  const openingIsPhoto = (photos[initialIndex]?.kind ?? 'photo') === 'photo';
  const presented = laidOut && (!openingIsPhoto || geometryReady || overlayFailsafe);

  useLayoutEffect(() => {
    if (!presented) {
      return;
    }
    if (!origin || reduceMotion || !geometryReady) {
      // Nothing to morph out of: the page arrives on its own fade.
      t.value = 0;
      residualX.value = 0;
      residualY.value = 0;
      overlay.value = withTiming(1, { duration: FADE_DURATION, easing: OPEN_EASING });
      return;
    }
    overlay.value = 1;
    // From the thumbnail to fit the screen. The delay lets the first frame
    // land before the animation starts, so nothing jumps on the way in.
    t.value = 1;
    residualX.value = 0;
    residualY.value = 0;
    t.value = withDelay(
      OPEN_MORPH_DELAY,
      withTiming(0, { duration: OPEN_MORPH_DURATION, easing: OPEN_EASING }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presented, geometryReady, openingIsPhoto, origin, reduceMotion]);

  const total = photos.length;
  const current = photos[Math.min(page, total - 1)];
  const currentIsPhoto = (current?.kind ?? 'photo') === 'photo';

  const handleClose = useCallback(() => {
    if (closing) {
      return;
    }
    // A clip or a voice note has no thumbnail of its own to land on, so its
    // close is immediate rather than a morph that would have nothing to do.
    // Photos keep the morph they had, and hand back when it lands.
    if (!currentIsPhoto || (!origin && reduceMotion)) {
      onClose();
      return;
    }
    // Morph first, close when the photo has reached the thumbnail.
    setClosing(true);
  }, [closing, currentIsPhoto, onClose, origin, reduceMotion]);

  const handleOpenMemory = useCallback(() => {
    if (!current) {
      return;
    }
    haptics.select();
    onOpenMemory(current);
  }, [current, onOpenMemory]);

  const handleMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!windowWidth) {
        return;
      }
      const next = Math.round(event.nativeEvent.contentOffset.x / windowWidth);
      setPage(Math.min(total - 1, Math.max(0, next)));
    },
    [total, windowWidth],
  );

  const handlePagerLockChange = useCallback((locked: boolean) => {
    setPagerLocked(locked);
  }, []);

  const renderPage = useCallback(
    ({ item, index }: ListRenderItemInfo<ViewerPhoto>) => {
      // Concrete window height: percentage heights collapse inside the
      // horizontal scroll content container, leaving a blank viewer.
      const frame = [styles.page, { width: windowWidth, height: windowHeight }];
      if (item.kind === 'video') {
        return (
          <View style={frame}>
            <ViewerVideoPage
              active={index === page}
              height={windowHeight}
              label={item.label}
              posterUri={item.posterUri}
              uri={item.uri}
              width={windowWidth}
            />
          </View>
        );
      }
      if (item.kind === 'voice') {
        return (
          <View style={frame}>
            <ViewerVoicePage
              active={index === page}
              height={windowHeight}
              label={item.label}
              seed={item.seed ?? item.uri}
              uri={item.uri}
              width={windowWidth}
            />
          </View>
        );
      }
      return (
        <View style={frame}>
          <ZoomablePhoto
            active={index === page}
            home={home}
            label={item.label}
            morph={morph}
            // Only the visible photo morphs out: the pages either side stay
            // put while the viewer closes over them.
            morphOut={closing && index === page}
            onDismiss={onClose}
            onDismissStart={handleDismissStart}
            onImageReady={index === page ? handleImageReady : undefined}
            onPagerLockChange={handlePagerLockChange}
            uri={item.uri}
          />
        </View>
      );
    },
    [
      windowWidth,
      windowHeight,
      morph,
      home,
      closing,
      page,
      handleDismissStart,
      handleImageReady,
      handlePagerLockChange,
      onClose,
    ],
  );

  // The modal is transparent, so a dismiss drag fades this scrim to reveal
  // the screen behind it. Fading a scrim (over the live screen) instead of
  // the modal's own content is what keeps the gesture from flashing white:
  // a full-screen modal's own backing is the system background.
  // The viewer ground IS the scrim (the modal is transparent over the live
  // screen), so it fades with the drag and comes back with the spring.
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: overlay.value * backdropFor(t.value),
  }));
  // Controls leave with the drag; they never sit over the revealed screen.
  const chromeStyle = useAnimatedStyle(() => ({
    opacity: overlay.value * backdropFor(t.value),
  }));

  return (
    <View
      accessibilityViewIsModal
      // Until it presents, the modal must not eat touches: a transparent
      // overlay that cannot be dismissed would freeze the screen behind it.
      pointerEvents={presented && !handingBack ? 'auto' : 'none'}
      onLayout={handleRootLayout}
      style={styles.inner}
    >
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: background }, scrimStyle]}
      />
      <FlatList
        data={photos}
        horizontal
        onLayout={scrollToInitialPage}
        ref={listRef}
        pagingEnabled
        scrollEnabled={!pagerLocked}
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={initialIndex}
        getItemLayout={(_data, index) => ({
          length: windowWidth,
          offset: windowWidth * index,
          index,
        })}
        keyExtractor={(item, index) => `${item.uri}:${index}`}
        onMomentumScrollEnd={handleMomentumEnd}
        renderItem={renderPage}
        style={styles.list}
      />
      <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, chromeStyle]}>
        <View style={[styles.top, { paddingTop: insets.top + Spacing[8] }]}>
          <IconButton
            accessibilityLabel="Close photo"
            label="Close photo"
            onPress={handleClose}
            variant="secondary"
          >
            <Ionicons color={textPrimary} name="close" size={20} />
          </IconButton>
        </View>
        <View style={[styles.bottom, { paddingBottom: insets.bottom + Spacing[16] }]}>
          {total > 1 ? (
            <ThemedText type="caption" style={{ color: muted }}>
              {PAGE_NOUNS[current?.kind ?? 'photo']} {Math.min(page, total - 1) + 1} of{' '}
              {total}
            </ThemedText>
          ) : null}
          <Button label="Open memory" onPress={handleOpenMemory} variant="secondary" />
        </View>
      </Animated.View>
    </View>
  );
}

/** What the counter calls the page the reader is on. */
const PAGE_NOUNS: Record<ViewerPageKind, string> = {
  photo: 'Photo',
  video: 'Video',
  voice: 'Voice note',
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  inner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    flex: 1,
  },
  page: {
    justifyContent: 'center',
  },
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'flex-end',
    paddingHorizontal: Spacing[24],
  },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingHorizontal: Spacing[24],
  },
});
