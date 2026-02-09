import type { BeachThemeColors } from '@/constants/theme-presets';
import { useAoiTheme } from '@/features/theme/theme-context';

type ThemeColorToken = keyof BeachThemeColors;

export function useThemeColor(
  props: { light?: string; dark?: string },
  colorName: ThemeColorToken
) {
  const { mode, colors } = useAoiTheme();
  const colorFromProps = props[mode];

  if (colorFromProps) {
    return colorFromProps;
  }

  return colors[colorName];
}
