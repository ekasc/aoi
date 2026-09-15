import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import {
  buildMorphGeometry,
  shellRadiusFor,
  type ViewerHome,
  type ViewerMorph,
} from '@/components/moments/zoomable-photo';

export type MorphShellProps = {
  morph: ViewerMorph;
  home: ViewerHome;
  /** The static tile box, for layout: shared values cannot size a layout. */
  tile: { width: number; height: number; radius: number };
  frame: { width: number; height: number };
  /** The media's own pixels. Nothing is drawn until they are known. */
  sourceWidth: number;
  sourceHeight: number;
  children: ReactNode;
};

/**
 * The photo viewer's morph, for content that is not a photo.
 *
 * A clip's page shows a still, and the tile shows that same still cropped, so
 * the two can be the same shape the way a photo and its thumbnail are: a box
 * with the tile's aspect, sized to contain the still, with a crop layer that
 * turns the still into the tile's crop as the pull completes. No fade, no
 * cross-fade, no separate look to hand off to.
 *
 * This mirrors the shell inside ZoomablePhoto rather than sharing it, because
 * that one is wired to pinch zoom and paging locks. The geometry helpers are
 * the photo path's own, so the two move together.
 */
export function MorphShell({
  morph,
  home,
  tile,
  frame,
  sourceWidth,
  sourceHeight,
  children,
}: MorphShellProps) {
  const geometry = useMemo(
    () =>
      sourceWidth > 0 && sourceHeight > 0
        ? buildMorphGeometry(
            sourceWidth,
            sourceHeight,
            frame.width,
            frame.height,
            tile.width,
            tile.height,
          )
        : null,
    [frame.height, frame.width, sourceHeight, sourceWidth, tile.height, tile.width],
  );

  const shellStyle = useAnimatedStyle(
    () => {
      const t = morph.t.value;
      const hasHome = home.valid.value;
      const baseWidth = geometry?.baseWidth ?? frame.width;
      const baseHeight = geometry?.baseHeight ?? frame.height;
      const cover = hasHome
        ? Math.max(home.width.value / baseWidth, home.height.value / baseHeight)
        : 1;
      const scale = 1 + (Math.min(cover, 1) - 1) * t;
      const centreX = frame.width / 2;
      const centreY = frame.height / 2;
      const targetCentreX = hasHome ? home.x.value + home.width.value / 2 : centreX;
      const targetCentreY = hasHome ? home.y.value + home.height.value / 2 : centreY;
      return {
        transform: [
          { translateX: morph.residualX.value },
          { translateY: morph.residualY.value },
          { translateX: (targetCentreX - centreX) * t },
          { translateY: (targetCentreY - centreY) * t },
          { scale },
        ],
        borderRadius: shellRadiusFor(t, home.radius.value, scale),
      };
    },
    [frame, geometry, home, morph],
  );

  const cropStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + ((geometry?.coverScale ?? 1) - 1) * morph.t.value }],
  }));

  return (
    <View style={styles.center}>
      <Animated.View
        style={[
          {
            height: geometry?.baseHeight ?? frame.height,
            width: geometry?.baseWidth ?? frame.width,
          },
          styles.shell,
          shellStyle,
        ]}
      >
        {/*
          Rendered before the media reports its size: the box is the frame
          until then, so the page is never blank and never unpressable. The
          crop layer is a no-op while the geometry is unknown.
        */}
        <Animated.View style={[styles.fill, cropStyle]}>{children}</Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  shell: {
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    width: '100%',
  },
});
