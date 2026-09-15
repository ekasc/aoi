import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
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
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ZoomablePhoto } from '@/components/moments/zoomable-photo';

import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { haptics } from '@/features/haptics/haptics';
import { useThemeColor } from '@/hooks/use-theme-color';

export type ViewerPhoto = {
  /** Raw photo URI; staged paths resolve here at the media boundary. */
  uri: string;
  /** Announced label for this photo. */
  label: string;
  /** Owning memory id — the parent context for Open memory. */
  momentId: string;
};

export type PhotoViewerProps = {
  visible: boolean;
  photos: ViewerPhoto[];
  /** Page the viewer opens on; swiping moves freely after. */
  initialIndex?: number;
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
export function PhotoViewer({
  visible,
  photos,
  initialIndex = 0,
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
      animationType={reduceMotion ? 'none' : 'fade'}
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
  onClose,
  onOpenMemory,
}: {
  photos: ViewerPhoto[];
  initialIndex: number;
  onClose: () => void;
  onOpenMemory: (photo: ViewerPhoto) => void;
}) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const background = useThemeColor({}, 'background');
  const textPrimary = useThemeColor({}, 'textPrimary');
  const muted = useThemeColor({}, 'muted');
  const [page, setPage] = useState(initialIndex);
  // An enlarged photo locks horizontal paging so its pan owns both axes.
  // The lock arrives when a pinch begins and lifts when the photo is back at
  // rest, so paging can never start against a zoomed photo.
  const [pagerLocked, setPagerLocked] = useState(false);
  // Dismiss-drag fade for the viewer ground, written straight from the
  // photo gestures (UI thread, no bridge hop).
  const dismiss = useSharedValue(0);
  // Shared values are stable for the life of the component; the fade writer
  // needs no dependencies (mutating one inside its own callback while also
  // listing it is what the lint rule forbids).
  const handleDismissProgress = useCallback(
    (progress: number, animated: boolean) => {
      'worklet';
      dismiss.value = animated ? withTiming(progress) : progress;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const total = photos.length;
  const current = photos[Math.min(page, total - 1)];

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

  const renderPhoto = useCallback(
    ({ item }: ListRenderItemInfo<ViewerPhoto>) => (
      // Concrete window height: percentage heights collapse inside the
      // horizontal scroll content container, leaving a blank viewer.
      <View style={[styles.page, { width: windowWidth, height: windowHeight }]}>
        <ZoomablePhoto
          uri={item.uri}
          label={item.label}
          onDismiss={onClose}
          onDismissProgress={handleDismissProgress}
          onPagerLockChange={handlePagerLockChange}
        />
      </View>
    ),
    [windowWidth, windowHeight, handleDismissProgress, handlePagerLockChange, onClose],
  );

  // The modal is transparent, so a dismiss drag fades this scrim to reveal
  // the screen behind it. Fading a scrim (over the live screen) instead of
  // the modal's own content is what keeps the gesture from flashing white:
  // a full-screen modal's own backing is the system background.
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: 1 - dismiss.value * 0.75,
  }));
  // Controls leave with the drag; they never sit over the revealed screen.
  const chromeStyle = useAnimatedStyle(() => ({
    opacity: 1 - dismiss.value,
  }));

  return (
    <View accessibilityViewIsModal style={styles.inner}>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: background }, scrimStyle]}
      />
      <FlatList
        data={photos}
        horizontal
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
        renderItem={renderPhoto}
        style={styles.list}
      />
      <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, chromeStyle]}>
        <View style={[styles.top, { paddingTop: insets.top + Spacing[8] }]}>
          <IconButton
            accessibilityLabel="Close photo"
            label="Close photo"
            onPress={onClose}
            variant="secondary"
          >
            <Ionicons color={textPrimary} name="close" size={20} />
          </IconButton>
        </View>
        <View style={[styles.bottom, { paddingBottom: insets.bottom + Spacing[16] }]}>
          {total > 1 ? (
            <ThemedText type="caption" style={{ color: muted }}>
              Photo {Math.min(page, total - 1) + 1} of {total}
            </ThemedText>
          ) : null}
          <Button label="Open memory" onPress={handleOpenMemory} variant="secondary" />
        </View>
      </Animated.View>
    </View>
  );
}

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
