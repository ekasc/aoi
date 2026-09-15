import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo, useCallback, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AudioWaveform } from '@/components/media/audio-waveform';
import type { PhotoOrigin } from '@/components/moments/zoomable-photo';
import { resolveStagedUri } from '@/features/composer/staged-uri';
import type { GalleryItem } from '@/features/moments/gallery';
import { useThemeColor } from '@/hooks/use-theme-color';

/**
 * The wall's tiles are square and chrome-free: no radius, no hairline, no
 * byline. That is the whole point of a grid next to a feed — the feed
 * explains each memory, the grid just shows them, edge to edge, the way a
 * camera roll or a profile grid does.
 *
 * Every tile opens the same full-screen viewer, whatever it holds: photos
 * zoom and page, a clip plays, a voice note gets its sound print. Nothing
 * plays inside a tile, so a wall of clips is never a wall of noise.
 *
 * The corner radius still has to be declared, because the viewer morphs out
 * of the tile the reader touched and starts from that shape.
 */
export const GALLERY_TILE_RADIUS = 0;

export type GalleryTileProps = {
  item: GalleryItem;
  /** Square edge in points; the grid owns the math. */
  size: number;
  /** Announced name for the tap. */
  accessibilityLabel: string;
  /** The tap reports its own window frame so the viewer can morph from it. */
  onPress: (item: GalleryItem, origin?: PhotoOrigin) => void;
};

/** Reports where the tile was, so a viewer session grows out of it. */
function useMeasuredTilePress({ item, onPress }: Pick<GalleryTileProps, 'item' | 'onPress'>) {
  const nodeRef = useRef<View>(null);
  const handlePress = useCallback(() => {
    const node = nodeRef.current;
    if (!node || typeof node.measureInWindow !== 'function') {
      // Nothing to measure (mocked trees, races): open without a morph.
      onPress(item);
      return;
    }
    node.measureInWindow((x, y, width, height) => {
      onPress(item, { x, y, width, height, radius: GALLERY_TILE_RADIUS });
    });
  }, [item, onPress]);
  return { nodeRef, handlePress };
}

function tileFrame(size: number) {
  return { height: size, width: size };
}

// ── Photo ───────────────────────────────────────────────────────────────

function GalleryPhotoTileComponent({
  item,
  size,
  accessibilityLabel,
  onPress,
}: GalleryTileProps) {
  const backgroundSubtle = useThemeColor({}, 'backgroundSubtle');
  const { nodeRef, handlePress } = useMeasuredTilePress({ item, onPress });

  return (
    <Pressable
      accessibilityHint="Opens full screen"
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={handlePress}
      ref={nodeRef}
      style={({ pressed }) => [
        styles.tile,
        tileFrame(size),
        { backgroundColor: backgroundSubtle },
        pressed ? styles.pressed : null,
      ]}
    >
      <Image
        accessible={false}
        contentFit="cover"
        // A recycled row must not show the previous photo while the next one
        // decodes: the key tells expo-image this is a different image.
        recyclingKey={item.key}
        source={{ uri: resolveStagedUri(item.uri) }}
        style={styles.fill}
        transition={160}
      />
    </Pressable>
  );
}

export const GalleryPhotoTile = memo(GalleryPhotoTileComponent);

// ── Video ───────────────────────────────────────────────────────────────

/**
 * A video print: its still, with a play badge saying there is a clip behind
 * it. The clip itself belongs to the viewer, where it gets the whole screen
 * and its own transport.
 */
function GalleryVideoTileComponent({
  item,
  size,
  accessibilityLabel,
  onPress,
}: GalleryTileProps) {
  const backgroundSubtle = useThemeColor({}, 'backgroundSubtle');
  const { nodeRef, handlePress } = useMeasuredTilePress({ item, onPress });

  return (
    <Pressable
      accessibilityHint="Opens full screen"
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={handlePress}
      ref={nodeRef}
      style={({ pressed }) => [
        styles.tile,
        tileFrame(size),
        { backgroundColor: backgroundSubtle },
        pressed ? styles.pressed : null,
      ]}
    >
      {item.posterUri ? (
        <Image
          accessible={false}
          contentFit="cover"
          recyclingKey={item.key}
          source={{ uri: resolveStagedUri(item.posterUri) }}
          style={styles.fill}
          transition={160}
        />
      ) : null}
      <View pointerEvents="none" style={styles.videoBadge}>
        <Ionicons color="#FFFFFF" name="play" size={13} style={styles.videoGlyph} />
      </View>
    </Pressable>
  );
}

export const GalleryVideoTile = memo(GalleryVideoTileComponent);

// ── Voice ───────────────────────────────────────────────────────────────

/** Bars a tile can hold without the print turning into noise. */
const TILE_WAVE_BARS = 13;

/**
 * A voice note's print: no still to show, so it gets a quiet ground and the
 * note's own waveform shape. It does not play here — tapping opens the
 * viewer, where the wave moves with the recording.
 */
function GalleryVoiceTileComponent({
  item,
  size,
  accessibilityLabel,
  onPress,
}: GalleryTileProps) {
  const accent = useThemeColor({}, 'accent');
  const muted = useThemeColor({}, 'muted');
  const surface2 = useThemeColor({}, 'surface2');
  const { nodeRef, handlePress } = useMeasuredTilePress({ item, onPress });

  return (
    <Pressable
      accessibilityHint="Opens full screen"
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={handlePress}
      ref={nodeRef}
      style={({ pressed }) => [
        styles.tile,
        tileFrame(size),
        { backgroundColor: surface2 },
        pressed ? styles.pressed : null,
      ]}
    >
      <View pointerEvents="none" style={styles.waveWrap}>
        <AudioWaveform
          animate={false}
          count={TILE_WAVE_BARS}
          height={Math.round(size * 0.3)}
          playedColor={accent}
          playing={false}
          // The tile is a print of the whole note, not a playhead.
          progress={1}
          restColor={muted}
          seed={item.key}
        />
      </View>
    </Pressable>
  );
}

export const GalleryVoiceTile = memo(GalleryVoiceTileComponent);

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    width: '100%',
  },
  pressed: {
    opacity: 0.8,
  },
  videoBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.38)',
    borderRadius: 999,
    bottom: 6,
    height: 20,
    justifyContent: 'center',
    left: 6,
    position: 'absolute',
    width: 20,
  },
  videoGlyph: {
    marginLeft: 1.5,
  },
  waveWrap: {
    width: '62%',
  },
});
