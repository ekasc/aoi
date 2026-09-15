import { StyleSheet, View, type ViewProps } from 'react-native';

import { Radii } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';

export type MediaFrameProps = ViewProps & {
  /** Defaults to a 4:3 photographic frame. */
  aspectRatio?: number;
};

/**
 * Quiet photographic frame: hairline border, media-appropriate radius,
 * paper-subtle ground while content loads. No shadows, no chrome.
 */
export function MediaFrame({ children, style, aspectRatio = 4 / 3, ...rest }: MediaFrameProps) {
  const border = useThemeColor({}, 'border');
  const backgroundSubtle = useThemeColor({}, 'backgroundSubtle');

  return (
    <View
      style={[
        styles.frame,
        { aspectRatio, borderColor: border, backgroundColor: backgroundSubtle },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.md,
    borderCurve: 'continuous',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
