import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radii } from '@/constants/theme';
import { resolveStagedUri } from '@/features/composer/staged-uri';
import type { StagedAsset } from '@/features/composer/types';
import { haptics } from '@/features/haptics/haptics';

export type DraftMediaGridProps = {
  /** Staged photo assets, in order. Audio is rendered by the caller. */
  assets: StagedAsset[];
  onRemove: (stagedId: string) => void;
};

const MAX_TILES = 4;

/**
 * Photo previews for the composer, laid out like a post's media: one photo
 * fills the frame at its own aspect, two sit side by side, three use the
 * large-left + stacked-right split, and four or more collapse to a 2×2 with
 * a "+N" overlay. Each tile carries its own remove control — no reorder
 * arrows, matching how posts present media.
 */
function clampAspect(width?: number, height?: number): number {
  if (width && height && Number.isFinite(width / height) && width / height > 0) {
    return Math.min(1.91, Math.max(0.6, width / height));
  }
  return 4 / 3;
}

type TileProps = {
  asset: StagedAsset;
  index: number;
  total: number;
  onRemove: (stagedId: string) => void;
  overlayCount?: number;
};

function Tile({ asset, index, total, onRemove, overlayCount }: TileProps) {
  return (
    <View style={styles.tile}>
      <Image
        accessibilityLabel={`Draft photo ${index + 1} of ${total}`}
        contentFit="cover"
        source={{ uri: resolveStagedUri(asset.localUri) }}
        style={styles.image}
        transition={200}
      />
      {overlayCount ? (
        <View
          accessibilityLabel={`${overlayCount} more photos`}
          accessible
          style={styles.moreOverlay}
        >
          <ThemedText type="bodyEmphasis" style={styles.moreText}>
            {`+${overlayCount}`}
          </ThemedText>
        </View>
      ) : null}
      <Pressable
        accessibilityLabel={`Remove photo ${index + 1}`}
        accessibilityRole="button"
        hitSlop={8}
        onPress={() => {
          haptics.tap();
          onRemove(asset.stagedId);
        }}
        style={styles.remove}
      >
        <Ionicons color="#FFFFFF" name="close" size={16} />
      </Pressable>
    </View>
  );
}

export function DraftMediaGrid({ assets, onRemove }: DraftMediaGridProps) {
  const shown = assets.slice(0, MAX_TILES);
  const overflow = assets.length - shown.length;

  const tile = (asset: StagedAsset, index: number) => (
    <Tile
      asset={asset}
      index={index}
      key={asset.stagedId}
      onRemove={onRemove}
      overlayCount={index === MAX_TILES - 1 && overflow > 0 ? overflow : undefined}
      total={assets.length}
    />
  );

  if (assets.length === 1) {
    return (
      <View
        style={[styles.single, { aspectRatio: clampAspect(shown[0].width, shown[0].height) }]}
      >
        {shown.map(tile)}
      </View>
    );
  }

  if (assets.length === 2) {
    return (
      <View style={styles.row}>
        {shown.map((asset, index) => (
          <View key={asset.stagedId} style={styles.two}>
            {tile(asset, index)}
          </View>
        ))}
      </View>
    );
  }

  if (assets.length === 3) {
    return (
      <View style={[styles.row, styles.three]}>
        <View style={styles.threeMain}>{tile(shown[0], 0)}</View>
        <View style={styles.threeSide}>
          <View style={styles.threeSideTile}>{tile(shown[1], 1)}</View>
          <View style={styles.threeSideTile}>{tile(shown[2], 2)}</View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.column, styles.grid]}>
      <View style={styles.gridRow}>
        {shown.slice(0, 2).map((asset, index) => (
          <View key={asset.stagedId} style={styles.gridCell}>
            {tile(asset, index)}
          </View>
        ))}
      </View>
      <View style={styles.gridRow}>
        {shown.slice(2, 4).map((asset, index) => (
          <View key={asset.stagedId} style={styles.gridCell}>
            {tile(asset, index + 2)}
          </View>
        ))}
      </View>
    </View>
  );
}

const GAP = 2;

const styles = StyleSheet.create({
  single: {
    width: '100%',
    borderRadius: Radii.lg,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    gap: GAP,
    width: '100%',
    borderRadius: Radii.lg,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  column: {
    width: '100%',
    gap: GAP,
    borderRadius: Radii.lg,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  two: {
    flex: 1,
    aspectRatio: 1,
  },
  three: {
    aspectRatio: 1.5,
  },
  threeMain: {
    flex: 1,
  },
  threeSide: {
    flex: 1,
    gap: GAP,
  },
  threeSideTile: {
    flex: 1,
  },
  grid: {
    aspectRatio: 1,
  },
  gridRow: {
    flex: 1,
    flexDirection: 'row',
    gap: GAP,
  },
  gridCell: {
    flex: 1,
  },
  tile: {
    flex: 1,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  remove: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  moreOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  moreText: {
    color: '#FFFFFF',
  },
});
