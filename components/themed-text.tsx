import { StyleSheet, Text, type TextProps } from 'react-native';

import { Typography } from '@/constants/typography';
import { useThemeColor } from '@/hooks/use-theme-color';

export type ThemedTextProps = TextProps & {
  lightColor?: string;
  darkColor?: string;
  type?: 'display' | 'title' | 'body' | 'caption' | 'meta' | 'link';
};

export function ThemedText({
  style,
  lightColor,
  darkColor,
  type = 'body',
  ...rest
}: ThemedTextProps) {
  const textColor = useThemeColor(
    { light: lightColor, dark: darkColor },
    type === 'meta' ? 'muted' : type === 'link' ? 'accent' : 'text'
  );

  return (
    <Text
      style={[
        styles.base,
        type === 'display' ? styles.display : undefined,
        type === 'title' ? styles.title : undefined,
        type === 'body' ? styles.body : undefined,
        type === 'caption' ? styles.caption : undefined,
        type === 'meta' ? styles.meta : undefined,
        type === 'link' ? styles.link : undefined,
        { color: textColor },
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    includeFontPadding: false,
  },
  display: Typography.display,
  title: Typography.title,
  body: Typography.body,
  caption: Typography.caption,
  meta: {
    ...Typography.meta,
    textTransform: 'uppercase',
  },
  link: {
    ...Typography.link,
    textDecorationLine: 'underline',
    textDecorationStyle: 'solid',
  },
});
