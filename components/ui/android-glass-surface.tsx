import { BlurView } from 'expo-blur';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { useThemeColor } from '@/hooks/use-theme-color';

export type AndroidGlassSurfaceProps = ViewProps & {
  effect?: 'regular' | 'clear';
};

export function AndroidGlassSurface({
  children,
  style,
  effect = 'regular',
  ...rest
}: AndroidGlassSurfaceProps) {
  const border = useThemeColor({}, 'border');
  const fallbackBackground = useThemeColor(
    effect === 'clear'
      ? {
          light: 'rgba(255, 255, 255, 0.82)',
          dark: 'rgba(31, 27, 22, 0.8)',
        }
      : {
          light: 'rgba(255, 248, 240, 0.86)',
          dark: 'rgba(42, 36, 29, 0.88)',
        },
    'surface'
  );
  const blurTint = useThemeColor(
    effect === 'clear'
      ? {
          light: 'rgba(255, 255, 255, 0.1)',
          dark: 'rgba(10, 10, 10, 0.2)',
        }
      : {
          light: 'rgba(255, 255, 255, 0.18)',
          dark: 'rgba(16, 16, 16, 0.28)',
        },
    'background'
  );
  const gloss = useThemeColor(
    {
      light: 'rgba(255, 255, 255, 0.2)',
      dark: 'rgba(255, 255, 255, 0.08)',
    },
    'surface'
  );
  const innerBorder = useThemeColor(
    {
      light: 'rgba(255, 255, 255, 0.36)',
      dark: 'rgba(255, 255, 255, 0.12)',
    },
    'border'
  );

  return (
    <View
      style={[
        styles.base,
        {
          borderColor: border,
          backgroundColor: fallbackBackground,
        },
        style,
      ]}
      {...rest}
    >
      <BlurView
        experimentalBlurMethod="dimezisBlurView"
        intensity={effect === 'clear' ? 38 : 58}
        style={StyleSheet.absoluteFill}
        tint="default"
      />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: blurTint }]} />
      <View pointerEvents="none" style={[styles.gloss, { backgroundColor: gloss }]} />
      <View pointerEvents="none" style={[styles.innerBorder, { borderColor: innerBorder }]} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 28,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  gloss: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 46,
    opacity: 0.9,
  },
  innerBorder: {
    position: 'absolute',
    left: 1,
    right: 1,
    top: 1,
    bottom: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 26,
    borderCurve: 'continuous',
  },
});
