import { Image } from 'expo-image';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { WindowRain } from '@/components/landing/window-rain';

const WINDOW_SOURCE = require('@/assets/images/midnight-window.jpg');
const SCRIM_SOURCE = require('@/assets/images/midnight-scrim.png');

export const MIDNIGHT_TINT_STANDARD = 'rgba(46, 20, 36, 0.22)';
export const MIDNIGHT_TINT_COMPACT = 'rgba(18, 13, 19, 0.65)';
export const MIDNIGHT_COMPACT_HEIGHT = 700;

export function midnightTintForHeight(height: number): string {
  return height < MIDNIGHT_COMPACT_HEIGHT ? MIDNIGHT_TINT_COMPACT : MIDNIGHT_TINT_STANDARD;
}

export function MidnightBackdrop({ focused = true }: { focused?: boolean } = {}) {
  const { height } = useWindowDimensions();
  return (
    <View style={styles.root} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Image
        accessible={false}
        source={WINDOW_SOURCE}
        contentFit="cover"
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.tint, { backgroundColor: midnightTintForHeight(height) }]} />
      {/* Subtle window rain: the only motion on this screen. The photo above stays still. */}
      <WindowRain focused={focused} />
      <Image
        accessible={false}
        source={SCRIM_SOURCE}
        contentFit="fill"
        style={styles.scrim}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  tint: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(46, 20, 36, 0.22)',
  },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '80%',
    width: '100%',
  },
});
