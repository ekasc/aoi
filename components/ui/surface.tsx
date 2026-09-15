import { Platform, StyleSheet, View, type ViewProps } from 'react-native';

import { Radii, Spacing, withAlpha } from '@/constants/theme';
import { GlassSurface } from '@/components/ui/glass-surface';
import { useThemeColor } from '@/hooks/use-theme-color';

export type SurfaceProps = ViewProps & {
  variant?: 'page' | 'card' | 'raised' | 'glass';
};

export function Surface({ children, style, variant = 'card', ...rest }: SurfaceProps) {
  const shadowColor = useThemeColor({}, 'shadow');
  const surface = useThemeColor({}, 'surface');
  const surface2 = useThemeColor({}, 'surface2');
  const pageBackground = useThemeColor({}, 'background');
  const border = useThemeColor({}, 'border');

  if (variant === 'page') {
    return <View style={[styles.page, { backgroundColor: pageBackground }]} {...rest}>{children}</View>;
  }

  if (variant === 'glass') {
    return (
      <GlassSurface
        effect="regular"
        style={[
          styles.card,
          styles.raised,
          Platform.select({
            ios: { shadowColor },
            android: {},
            default: { shadowColor },
          }),
          style,
        ]}
        {...rest}
      >{children}</GlassSurface>
    );
  }

  const isRaised = variant === 'raised';

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: withAlpha(isRaised ? surface2 : surface, 0.3),
          borderColor: border,
          borderWidth: StyleSheet.hairlineWidth,
        },
        isRaised
          ? [
              styles.raised,
              Platform.select({
                ios: { shadowColor },
                android: {},
                default: { shadowColor },
              }),
            ]
          : undefined,
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  card: {
    borderCurve: 'continuous',
    borderRadius: Radii.md,
    padding: Spacing[16],
  },
  raised: {
    ...Platform.select({
      ios: {
        shadowOpacity: 0.08,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
      },
      android: {},
      default: {
        shadowOpacity: 0.08,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
      },
    }),
  },
});
