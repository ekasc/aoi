import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo, useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { VideoSurface } from '@/components/media/video-player';
import type { PhotoOrigin } from '@/components/moments/zoomable-photo';
import { useVoicePlayback } from '@/hooks/use-voice-playback';
import { resolveStagedUri } from '@/features/composer/staged-uri';
import type { GalleryItem, GalleryPhoto } from '@/features/moments/gallery';
import { useThemeColor } from '@/hooks/use-theme-color';

/**
 * The wall's tiles are square and chrome-free: no radius, no hairline, no
 * byline. That is the whole point of a grid next to a feed — the feed
 * explains each memory, the grid just shows them, edge to edge, the way a
 * camera roll or a profile grid does.
 *
 * The corner radius still has to be declared, because the viewer morphs out
 * of the tile the reader touched and starts from that shape.
 */
export const GALLERY_TILE_RADIUS = 0;

/** A square tile's frame, shared by all three kinds. */
function tileFrame(size: number) {
  return { width: size, height: size };
}

// ── Photo ───────────────────────────────────────────────────────────────

export type GalleryPhotoTileProps = {
  /** The wall only ever hands this tile a photo. */
  item: GalleryPhoto;
  /** Square edge in points; the grid owns the math. */
  size: number;
  /** Announced name for the tap. */
  accessibilityLabel: string;
  /** The tap reports its own window frame so the viewer can morph from it. */
  onPress: (item: GalleryPhoto, origin?: PhotoOrigin) => void;
};

function GalleryPhotoTileComponent({
  item,
  size,
  accessibilityLabel,
  onPress,
}: GalleryPhotoTileProps) {
  const backgroundSubtle = useThemeColor({}, 'backgroundSubtle');
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
        style={styles.image}
        transition={160}
      />
    </Pressable>
  );
}

export const GalleryPhotoTile = memo(GalleryPhotoTileComponent);

// ── Video ───────────────────────────────────────────────────────────────

export type GalleryVideoTileProps = {
  item: GalleryItem;
  /** Square edge in points; the grid owns the math. */
  size: number;
  /** Named on the play control, so a wall of clips is never anonymous. */
  label: string;
};

/**
 * A video print: its still stands in until the reader asks to watch, then
 * the clip plays in place with native controls (play, scrub, fullscreen).
 * Nothing is created or buffered for a clip nobody started.
 */
function GalleryVideoTileComponent({ item, size, label }: GalleryVideoTileProps) {
  const [started, setStarted] = useState(false);
  const backgroundSubtle = useThemeColor({}, 'backgroundSubtle');
  const handlePlay = useCallback(() => setStarted(true), []);

  if (started) {
    return (
      <View style={[styles.tile, tileFrame(size), { backgroundColor: backgroundSubtle }]}>
        <VideoSurface contentFit="cover" label={label} uri={item.uri} />
      </View>
    );
  }

  return (
    <Pressable
      accessibilityHint="Plays in place"
      accessibilityLabel={`Play video: ${label}`}
      accessibilityRole="button"
      onPress={handlePlay}
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
          style={styles.image}
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

/** Relative bar heights, so a voice note reads as a small sound print. */
const VOICE_BARS = [0.32, 0.62, 0.44, 0.78, 0.52, 0.36];

export type GalleryVoiceTileProps = {
  item: GalleryItem;
  size: number;
  /** Named on the play control: whose voice, and when. */
  label: string;
};

/**
 * A voice print: no poster to show, so it gets a quiet ground and a
 * waveform that fills left to right with the recording. Tapping it plays
 * in place — playback never navigates, the same rule the feed keeps.
 */
function GalleryVoiceTileComponent({ item, size, label }: GalleryVoiceTileProps) {
  const accent = useThemeColor({}, 'accent');
  const surface2 = useThemeColor({}, 'surface2');
  const muted = useThemeColor({}, 'muted');
  const { isPlaying, progress, toggle } = useVoicePlayback(item.uri);

  return (
    <Pressable
      accessibilityHint="Plays in place"
      accessibilityLabel={`${isPlaying ? 'Pause' : 'Play'} voice note: ${label}`}
      accessibilityRole="button"
      onPress={toggle}
      style={({ pressed }) => [
        styles.tile,
        tileFrame(size),
        { backgroundColor: surface2 },
        pressed ? styles.pressed : null,
      ]}
    >
      <View
        pointerEvents="none"
        style={[
          styles.waveform,
          // Sized in points, never in percentages: percentage padding
          // resolves against the parent and pushed the tile past its square.
          { height: size * 0.32, width: Math.round(size * 0.62) },
        ]}
      >
        {VOICE_BARS.map((height, index) => (
          <View
            key={height + String(index)}
            style={[
              styles.bar,
              {
                backgroundColor: (index + 1) / VOICE_BARS.length <= progress ? accent : muted,
                height: `${Math.round(height * 100)}%`,
                opacity: (index + 1) / VOICE_BARS.length <= progress ? 1 : 0.45,
              },
            ]}
          />
        ))}
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

  image: {
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
  waveform: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 3,
    width: '100%',
  },
  bar: {
    borderRadius: 999,
    flex: 1,
  },
});
