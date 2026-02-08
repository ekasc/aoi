import { StyleSheet, View, type ViewProps } from 'react-native';

import { useThemeColor } from '@/hooks/use-theme-color';

export type DividerProps = ViewProps & {
  inset?: number;
};

export function Divider({ style, inset = 0, ...rest }: DividerProps) {
  const border = useThemeColor({}, 'border');

  return (
    <View
      style={[
        styles.base,
        { backgroundColor: border, marginLeft: inset },
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    width: '100%',
    height: StyleSheet.hairlineWidth,
  },
});
