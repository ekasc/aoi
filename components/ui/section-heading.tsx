import { StyleSheet, View, type ViewProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

export type SectionHeadingProps = ViewProps & {
  kicker?: string;
  title: string;
};

/**
 * Editorial section heading: an optional quiet kicker over a title.
 * Hierarchy comes from type and space, not from chrome.
 */
export function SectionHeading({ kicker, title, style, ...rest }: SectionHeadingProps) {
  return (
    <View style={[styles.container, style]} {...rest}>
      {kicker ? <ThemedText type="meta">{kicker}</ThemedText> : null}
      <ThemedText type="title">{title}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing[4],
  },
});
