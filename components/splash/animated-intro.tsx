import { Canvas } from '@shopify/react-native-skia';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import { SkiaReady } from '@/components/landing/skia-ready';
import { SplashMaterial } from '@/components/splash/splash-material';
import { useSplashProgress } from '@/components/splash/use-splash-progress';
import type { BeachThemeColors, BeachThemeId } from '@/constants/theme-presets';

export type SplashMotif = 'constellation' | 'shell' | 'sunset' | 'tide' | 'keepsake';

export const SPLASH_MOTIFS = {
  'after-hours': 'constellation',
  beach: 'shell',
} satisfies Record<BeachThemeId, SplashMotif>;

type AnimatedIntroProps = {
  themeId: BeachThemeId;
  colors: BeachThemeColors;
  progress?: SharedValue<number>;
};

export function AnimatedIntro({ themeId, colors, progress }: AnimatedIntroProps) {
  return (
    <View
      pointerEvents="none"
      accessible={false}
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}
    >
      <SkiaReady>
        {(ready) => ready ? <Atmosphere themeId={themeId} colors={colors} progress={progress} /> : null}
      </SkiaReady>
    </View>
  );
}

function Atmosphere({ themeId, colors, progress: controlled }: AnimatedIntroProps) {
  const { width, height } = useWindowDimensions();
  const progress = useSplashProgress(controlled);
  return (
    <Canvas style={{ width, height }}>
      <SplashMaterial colors={colors} motif={SPLASH_MOTIFS[themeId]} width={width} height={height} progress={progress} />
    </Canvas>
  );
}
