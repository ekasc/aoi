import { ScrollView, StyleSheet, View, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';

export type ScreenProps = ViewProps & {
  /** Horizontal page gutter. Defaults to the editorial 16pt gutter. */
  gutter?: number;
  /**
   * Render content in a scroll view. Defaults to false: screens are
   * fixed by default and only opt into scrolling when they show a list
   * or long navigating content.
   */
  scroll?: boolean;
};

/**
 * Editorial page shell: paper background, safe-area top/bottom, a 16pt
 * horizontal gutter, and 24pt section rhythm. Sections are separated by
 * spacing — not by nested cards.
 */
export function Screen({ children, style, gutter = Spacing[16], scroll = false, ...rest }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const background = useThemeColor({}, 'background');

  const padding = {
    paddingTop: insets.top + Spacing[16],
    paddingBottom: insets.bottom + Spacing[24],
    paddingHorizontal: gutter,
  };

  if (!scroll) {
    return (
      <View style={[{ flex: 1, backgroundColor: background }, padding, styles.fixed, style]} {...rest}>
        {children}
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: background }}
      contentContainerStyle={[styles.content, padding, style]}
      {...rest}
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing[24],
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  fixed: {
    gap: Spacing[24],
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
});
