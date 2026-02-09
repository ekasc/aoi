import { Platform, StyleSheet, View, type ViewProps } from 'react-native';

import { Radii } from '@/constants/theme';
import { GlassSurface } from '@/components/ui/glass-surface';
import { useThemeColor } from '@/hooks/use-theme-color';

export type SurfaceProps = ViewProps & {
  variant?: 'page' | 'card' | 'raised';
};

export function Surface({ style, variant = 'card', ...rest }: SurfaceProps) {
  const pageBackground = useThemeColor({}, 'background');
  const shadowColor = useThemeColor({}, 'shadow');

  if (variant === 'page') {
    return <View style={[styles.page, { backgroundColor: pageBackground }, style]} {...rest} />;
  }

  return (
    <GlassSurface
      effect="regular"
      style={[
        styles.card,
        variant === 'raised'
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
    padding: 16,
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
