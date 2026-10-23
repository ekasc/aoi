import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';
import {
  FlatList,
  StyleSheet,
  useWindowDimensions,
  View,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  runOnJS,
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

import {
  useMediaCloseAnimation,
  useMediaDismiss,
} from '@/components/moments/viewer-media-dismiss';
import { ViewerVideoPage, ViewerVoicePage } from '@/components/moments/viewer-media-page';
import { ViewerPresentation } from '@/components/moments/viewer-presentation';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { haptics } from '@/features/haptics/haptics';
import { useThemeColor } from '@/hooks/use-theme-color';

export type ViewerPageKind = 'photo' | 'video' | 'voice';

/** How long a page that has no thumbnail to morph into takes to arrive. */
const FADE_DURATION = 180;
const INTERRUPTED_RETURN_FADE = 64;

export type PhotoViewerHandle = {
  interruptReturn: () => void;
};

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
  /** Owning memory, when this photo comes from Memories rather than the local sky. */
  momentId?: string;
  /** Video still, used while the clip's page is off-screen. */
  posterUri?: string | null;
  /** Shape seed for a voice note's sound print. Defaults to the URI. */
  seed?: string;
};

export type PhotoViewerProps = {
  ref?: Ref<PhotoViewerHandle>;
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
  onOpenMemory?: (photo: ViewerPhoto) => void;
};

/**
 * Full-screen photo viewer over the current screen: a swipeable set of
 * zoomable photos, a Close control, a page counter for sets, and an
 * Open-memory link that returns to the parent memory of the visible photo.
 * Nothing else.
 *
 * On iOS the viewer stays in the app's window, so its return animation can
 * finish without a presented modal blocking the screen underneath.
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
  ref,
  visible,
  photos,
  initialIndex = 0,
  origin,
  onClose,
  onOpenMemory,
}: PhotoViewerProps) {
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
    <ViewerSession
      key={sessionKey}
      viewerRef={ref}
      photos={photos}
      initialIndex={safeInitialIndex}
      origin={origin}
      onClose={onClose}
      onOpenMemory={onOpenMemory}
    />
  );
}

/**
 * One viewing session. Mounted fresh per session key, so page, paging
 * lock, and dismiss fade all start at rest without any reset logic: a
 * drag-to-dismiss can't leave the next opening faded, and closing via X
 * while zoomed can't leave paging locked.
 */
function ViewerSession({
  viewerRef,
  photos,
  initialIndex,
  origin,
  onClose,
  onOpenMemory,
}: {
  viewerRef?: Ref<PhotoViewerHandle>;
  photos: ViewerPhoto[];
  initialIndex: number;
  origin?: PhotoOrigin;
  onClose: () => void;
  onOpenMemory?: (photo: ViewerPhoto) => void;
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
    homeX.set(origin?.x ?? 0);
    homeY.set(origin?.y ?? 0);
    homeWidth.set(origin?.width ?? 0);
    homeHeight.set(origin?.height ?? 0);
    homeRadius.set(origin?.radius ?? 0);
    homeValid.set(!!origin);
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
  const returnInterrupted = useRef(false);
  const interruptReturn = useCallback(() => {
    if (!handingBack || returnInterrupted.current) return;
    returnInterrupted.current = true;
    // A scrolling thumbnail is no longer at the saved destination. Stop the
    // return and hand its image back to the live list rather than chase it.
    cancelAnimation(t);
    cancelAnimation(residualX);
    cancelAnimation(residualY);
    if (reduceMotion) {
      onClose();
      return;
    }
    overlay.set(withTiming(0, { duration: INTERRUPTED_RETURN_FADE }, (finished) => {
      'worklet';
      if (finished) runOnJS(onClose)();
    }));
  }, [handingBack, onClose, overlay, reduceMotion, residualX, residualY, t]);
  useImperativeHandle(viewerRef, () => ({ interruptReturn }), [interruptReturn]);
  // Only a photo has a clip box to wait for: a video or a voice page has no
  // geometry to morph out of, and gating its presentation on one would hold
  // the page behind the failsafe for no reason.
  const openingIsPhoto = (photos[initialIndex]?.kind ?? 'photo') === 'photo';
  const presented = laidOut && (!openingIsPhoto || geometryReady || overlayFailsafe);
  const openingStarted = useRef(false);

  useLayoutEffect(() => {
    if (!presented || openingStarted.current) {
      return;
    }
    openingStarted.current = true;
    if (!origin || reduceMotion || !geometryReady) {
      // Nothing to morph out of: the page arrives on its own fade.
      t.set(0);
      residualX.set(0);
      residualY.set(0);
      overlay.set(withTiming(1, { duration: FADE_DURATION, easing: OPEN_EASING }));
      return;
    }
    overlay.set(1);
    // From the thumbnail to fit the screen. The delay lets the first frame
    // land before the animation starts, so nothing jumps on the way in.
    t.set(1);
    residualX.set(0);
    residualY.set(0);
    t.set(withDelay(
      OPEN_MORPH_DELAY,
      withTiming(0, { duration: OPEN_MORPH_DURATION, easing: OPEN_EASING }),
    ));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presented, geometryReady, openingIsPhoto, origin, reduceMotion]);

  const total = photos.length;
  const current = photos[Math.min(page, total - 1)];
  const currentIsPhoto = (current?.kind ?? 'photo') === 'photo';

  // A clip or a voice note has no thumbnail to land in, so it leaves the way
  // the hand would take it: shrinking away from wherever it was let go.
  const closeMediaPage = useMediaCloseAnimation({
    morph,
    onClose,
    onDismissStart: handleDismissStart,
  });
  const mediaDismiss = useMediaDismiss({
    active: true,
    morph,
    onClose,
    onDismissStart: handleDismissStart,
  });

  const handleClose = useCallback(() => {
    if (closing || handingBack) {
      return;
    }
    if (!currentIsPhoto) {
      closeMediaPage();
      return;
    }
    if (!origin) {
      handleDismissStart();
      if (reduceMotion) {
        onClose();
      } else {
        // No thumbnail to land in: retain the current fit and zoom while fading.
        // Reanimated shared values are mutable animation state, not React state.
        // eslint-disable-next-line react-hooks/immutability
        overlay.set(withTiming(0, { duration: FADE_DURATION }, (finished) => {
          'worklet';
          if (finished) runOnJS(onClose)();
        }));
      }
      return;
    }
    // Morph first, close when the photo has reached the thumbnail.
    setClosing(true);
  }, [closing, handingBack, closeMediaPage, currentIsPhoto, handleDismissStart, onClose, origin, overlay, reduceMotion]);

  const handleOpenMemory = useCallback(() => {
    if (!current?.momentId) {
      return;
    }
    haptics.select();
    onOpenMemory?.(current);
  }, [current, onOpenMemory]);

  const handlePageScroll = useCallback(
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
      if (item.kind === 'video' || item.kind === 'voice') {
        const body = (
          <View style={frame}>
            <View style={StyleSheet.absoluteFill}>
              {item.kind === 'video' ? (
                <ViewerVideoPage
                  active={index === page}
                  height={windowHeight}
                  home={home}
                  label={item.label}
                  morph={morph}
                  origin={origin}
                  posterUri={item.posterUri}
                  uri={item.uri}
                  width={windowWidth}
                />
              ) : (
                <ViewerVoicePage
                  active={index === page}
                  height={windowHeight}
                  home={home}
                  label={item.label}
                  morph={morph}
                  seed={item.seed ?? item.uri}
                  uri={item.uri}
                  width={windowWidth}
                />
              )}
            </View>
          </View>
        );
        // The pull-to-close belongs to the page the reader is on: the pager
        // mounts its neighbours, and a gesture on an off-screen page is a
        // gesture nobody can make.
        return index === page ? (
          <GestureDetector gesture={mediaDismiss.gesture}>{body}</GestureDetector>
        ) : (
          body
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
      mediaDismiss.gesture,
      onClose,
      origin,
      windowHeight,
      windowWidth,
    ],
  );

  // The modal is transparent, so a dismiss drag fades this scrim to reveal
  // the screen behind it. Fading a scrim (over the live screen) instead of
  // the modal's own content is what keeps the gesture from flashing white:
  // a full-screen modal's own backing is the system background.
  // The viewer ground IS the scrim (the modal is transparent over the live
  // screen), so it fades with the drag and comes back with the spring.
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: overlay.get() * backdropFor(t.get()),
  }));
  // Controls leave with the drag; they never sit over the revealed screen.
  const chromeStyle = useAnimatedStyle(() => ({
    opacity: overlay.get() * backdropFor(t.get()),
  }));

  return (
    <ViewerPresentation interactive={presented && !handingBack} onRequestClose={handleClose}>
    <View
      accessibilityViewIsModal={presented && !handingBack}
      // The return animation stays mounted after the overlay gives input back.
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
        onScroll={handlePageScroll}
        onMomentumScrollEnd={handlePageScroll}
        scrollEventThrottle={32}
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
          {/*
            Photos keep the way into their memory. The media pages do not: a
            clip or a voice note is opened to be watched or heard, and the
            wall's tile leads back to the memory anyway.
          */}
          {currentIsPhoto && current?.momentId && onOpenMemory ? (
            <Button label="Open memory" onPress={handleOpenMemory} variant="secondary" />
          ) : null}
        </View>
      </Animated.View>
    </View>
    </ViewerPresentation>
  );
}

/** What the counter calls the page the reader is on. */
const PAGE_NOUNS: Record<ViewerPageKind, string> = {
  photo: 'Photo',
  video: 'Video',
  voice: 'Voice note',
};

const styles = StyleSheet.create({
  inner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    flex: 1,
    width: '100%',
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
