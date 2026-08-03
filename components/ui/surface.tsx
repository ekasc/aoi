import { Platform, StyleSheet, View, type ViewProps } from 'react-native';

import { Radii, Spacing } from '@/constants/theme';
import { GlassSurface } from '@/components/ui/glass-surface';
import { useThemeColor } from '@/hooks/use-theme-color';

export type SurfaceProps = ViewProps & {
  variant?: 'page' | 'card' | 'raised' | 'glass';
};

export function Surface({ style, variant = 'card', ...rest }: SurfaceProps) {
  const shadowColor = useThemeColor({}, 'shadow');
  const surface = useThemeColor({}, 'surface');
  const surface2 = useThemeColor({}, 'surface2');
  const pageBackground = useThemeColor({}, 'background');
  const border = useThemeColor({}, 'border');

  if (variant === 'page') {
    return <View style={[styles.page, { backgroundColor: pageBackground }]} {...rest} />;
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
      />
    );
  }

  const isRaised = variant === 'raised';

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: isRaised ? surface2 : surface,
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
    />
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  card: {
    borderRadius: Radii.lg,
    padding: Spacing[16],
  },
  raised: {
    ...Platform.select({
      ios: {
        shadowOpacity: 0.18,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 12 },
      },
      android: {
        elevation: 2,
      },
      default: {
        shadowOpacity: 0.18,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 12 },
      },
    }),
  },
});
