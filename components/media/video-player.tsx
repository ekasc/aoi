import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { MediaFrame } from '@/components/ui/media-frame';
import { resolveStagedUri } from '@/features/composer/staged-uri';

export type VideoPlayerProps = {
  uri: string;
  /** Pre-play still. Falls back to a plain ground when absent. */
  posterUri?: string | null;
  /** Announced on the play control and by screen readers. */
  label?: string;
  /** Frame ratio: the timeline passes a 4:3 frame, article/detail 16:9. */
  aspectRatio?: number;
};

/**
 * Only mounted after the poster is tapped. Creating the player is what
 * loads (and buffers) the clip, so the feed never spins up a native player
 * per row — the poster is just an image until the reader asks to watch.
 */
function VideoSurface({ uri, label }: { uri: string; label: string }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
    instance.play();
  });

  return (
    <VideoView
      accessibilityLabel={label}
      contentFit="contain"
      nativeControls
      player={player}
      style={styles.fill}
    />
  );
}

/**
 * Minimal video surface for dev-preview memories: a poster with a play
 * control that swaps to expo-video on tap. Native controls then own
 * playback (play/pause, scrub, fullscreen) — no duplicated transport UI.
 */
export function VideoPlayer({
  uri,
  posterUri,
  label = 'Video memory',
  aspectRatio = 16 / 9,
}: VideoPlayerProps) {
  const [started, setStarted] = useState(false);
  const handlePlay = useCallback(() => setStarted(true), []);

  const surface = started ? (
    <VideoSurface label={label} uri={uri} />
  ) : (
    <Pressable
      accessibilityLabel={`Play video: ${label}`}
      accessibilityRole="button"
      onPress={handlePlay}
      style={styles.fill}
    >
      {posterUri ? (
        <Image
          accessible={false}
          contentFit="cover"
          source={{ uri: resolveStagedUri(posterUri) }}
          style={styles.fill}
          transition={200}
        />
      ) : (
        <View style={[styles.fill, styles.placeholder]} />
      )}
      <View pointerEvents="none" style={styles.overlay}>
        <View style={styles.playButton}>
          <Ionicons color="#FFFFFF" name="play" size={28} style={styles.playIcon} />
        </View>
      </View>
    </Pressable>
  );

  return <MediaFrame aspectRatio={aspectRatio}>{surface}</MediaFrame>;
}

const styles = StyleSheet.create({
  fill: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    backgroundColor: 'rgba(128, 128, 128, 0.2)',
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButton: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  playIcon: {
    marginLeft: 4,
  },
});
