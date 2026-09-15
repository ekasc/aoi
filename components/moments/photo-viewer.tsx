import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
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
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { resolveStagedUri } from '@/features/composer/staged-uri';
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
 * Full-screen photo viewer over the current screen: contain-fit expo-image
 * on a horizontally paged swipe, a Close control, a page counter for sets,
 * and an Open-memory link that returns to the parent memory of the visible
 * photo. Nothing else.
 *
 * The surface is opaque (theme background, no `transparent`) because
 * `presentationStyle="fullScreen"` and `transparent` are an invalid pair on
 * iOS. Motion is system-gated: the modal fade and the image transition
 * collapse to none under reduced motion. Paging itself is user-driven, so
 * it stays under reduced motion too.
 */
export function PhotoViewer({
  visible,
  photos,
  initialIndex = 0,
  onClose,
  onOpenMemory,
}: PhotoViewerProps) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const background = useThemeColor({}, 'background');
  const textPrimary = useThemeColor({}, 'textPrimary');
  const muted = useThemeColor({}, 'muted');
  const reduceMotion = useReducedMotion();
  const [page, setPage] = useState(0);

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

  const renderPhoto = useCallback(
    ({ item }: ListRenderItemInfo<ViewerPhoto>) => (
      // Concrete window height: percentage heights collapse inside the
      // horizontal scroll content container, leaving a blank viewer.
      <View style={[styles.page, { width: windowWidth, height: windowHeight }]}>
        <Image
          accessibilityLabel={item.label}
          contentFit="contain"
          source={{ uri: resolveStagedUri(item.uri) }}
          style={styles.image}
          transition={reduceMotion ? 0 : 200}
        />
      </View>
    ),
    [windowWidth, windowHeight, reduceMotion],
  );

  if (!visible || total === 0) {
    return null;
  }

  return (
    <Modal
      animationType={reduceMotion ? 'none' : 'fade'}
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      statusBarTranslucent
      visible
    >
      <View accessibilityViewIsModal style={[styles.root, { backgroundColor: background }]}>
        <FlatList
          data={photos}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={Math.min(initialIndex, total - 1)}
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
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
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
  image: {
    width: '100%',
    height: '100%',
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
