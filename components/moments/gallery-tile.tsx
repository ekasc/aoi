import { Image } from 'expo-image';
import { memo, useCallback, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { PhotoOrigin } from '@/components/moments/zoomable-photo';
import { Radii } from '@/constants/theme';
import { resolveStagedUri } from '@/features/composer/staged-uri';
import type { GalleryPhoto } from '@/features/moments/gallery';
import { useThemeColor } from '@/hooks/use-theme-color';

/** Corner radius of one tile, so the viewer morphs out of the same shape. */
const TILE_RADIUS = Radii.sm;

export type GalleryTileProps = {
  photo: GalleryPhoto;
  /** Square edge in points; the grid owns the math. */
  size: number;
  accessibilityLabel: string;
  /** The tap reports its own window frame so the viewer can morph from it. */
  onPress: (photo: GalleryPhoto, origin?: PhotoOrigin) => void;
};

/**
 * One dense gallery tile: a square, cover-cropped photo inside the same
 * press target that opens the full-screen viewer. Photos only — a video or
 * voice note takes a full-width line of the album instead, because both
 * need a transport rather than a frame.
 *
 * The tile's radius is the viewer's starting radius, so the morph leaves
 * from the shape the reader actually touched.
 */
function GalleryTileComponent({ photo, size, accessibilityLabel, onPress }: GalleryTileProps) {
  const border = useThemeColor({}, 'border');
  const backgroundSubtle = useThemeColor({}, 'backgroundSubtle');
  const nodeRef = useRef<View>(null);

  const handlePress = useCallback(() => {
    const node = nodeRef.current;
    if (!node || typeof node.measureInWindow !== 'function') {
      // Nothing to measure (mocked trees, races): open without a morph.
      onPress(photo);
      return;
    }
    node.measureInWindow((x, y, width, height) => {
      onPress(photo, { x, y, width, height, radius: TILE_RADIUS });
    });
  }, [onPress, photo]);

  return (
    <Pressable
      accessibilityHint="Opens full screen"
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={handlePress}
      ref={nodeRef}
      style={({ pressed }) => [
        styles.tile,
        { width: size, height: size, borderColor: border, backgroundColor: backgroundSubtle },
        pressed ? styles.pressed : null,
      ]}
    >
      <Image
        accessible={false}
        contentFit="cover"
        // A recycled row must not show the previous photo while the next one
        // decodes: the key tells expo-image this is a different image.
        recyclingKey={photo.key}
        source={{ uri: resolveStagedUri(photo.uri) }}
        style={styles.image}
        transition={200}
      />
    </Pressable>
  );
}

export const GalleryTile = memo(GalleryTileComponent);

const styles = StyleSheet.create({
  tile: {
    borderRadius: TILE_RADIUS,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  pressed: {
    opacity: 0.85,
  },
});
