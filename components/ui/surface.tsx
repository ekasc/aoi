import { Platform, StyleSheet, View, type ViewProps } from 'react-native';

import { Radii } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';

export type SurfaceProps = ViewProps & {
  variant?: 'page' | 'card' | 'raised';
};

export function Surface({ style, variant = 'card', ...rest }: SurfaceProps) {
  const pageBackground = useThemeColor({}, 'background');
  const cardBackground = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');
  const shadowColor = useThemeColor({}, 'shadow');
  const background = variant === 'page' ? pageBackground : cardBackground;

  return (
    <View
      style={[
        styles.base,
        { backgroundColor: background, borderColor: border },
        variant === 'page' ? styles.page : undefined,
        variant === 'card' ? styles.card : undefined,
        variant === 'raised'
          ? [
              styles.card,
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
  base: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  page: {
    borderWidth: 0,
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
