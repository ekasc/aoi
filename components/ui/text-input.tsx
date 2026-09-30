import { useState } from 'react';
import {
  StyleSheet,
  TextInput as RNTextInput,
  View,
  type TextInputProps as RNTextInputProps,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { Typography } from '@/constants/typography';
import { useAoiTheme } from '@/features/theme/theme-context';
import { useThemeColor } from '@/hooks/use-theme-color';

export type PaperTextInputProps = Omit<RNTextInputProps, 'style'> & {
  label?: string;
  error?: string;
  containerStyle?: RNTextInputProps['style'];
  /** `sky` dresses the field for the night backdrop. See Button. */
  tone?: 'paper' | 'sky';
  /**
   * `row` is the platform's own form row: label on the left, value on the
   * right, and no underline. The underline is Material's text field, which is
   * the right affordance on Android and reads as a ported control on iOS. It
   * mirrors the same prop on NativeDateTimeField so the two fields in a group
   * can match.
   */
  variant?: 'stacked' | 'row';
};

/**
 * Paper-integrated text input: transparent on the paper surface with a
 * single hairline underline rather than a dashboard form box.
 * Keeps a 48pt minimum touch area; Dynamic Type stays enabled and the
 * container grows instead of clipping scaled fonts.
 */
export function PaperTextInput({
  label,
  error,
  containerStyle,
  tone = 'paper',
  variant = 'stacked',
  editable = true,
  onFocus,
  onBlur,
  accessibilityLabel,
  ...rest
}: PaperTextInputProps) {
  const [focused, setFocused] = useState(false);
  const isRow = variant === 'row';
  const onSky = tone === 'sky';
  // Only read for the sky: half the palette is not needed to dress a field
  // that is standing on paper.
  const { selectedTheme } = useAoiTheme();
  const half = onSky ? selectedTheme.dark : null;
  const themedTextPrimary = useThemeColor({}, 'textPrimary');
  const themedTextMuted = useThemeColor({}, 'textMuted');
  const themedBorder = useThemeColor({}, 'border');
  const themedBorderStrong = useThemeColor({}, 'borderStrong');
  const themedDestructive = useThemeColor({}, 'destructive');
  const textPrimary = half ? half.textPrimary : themedTextPrimary;
  const textMuted = half ? half.textMuted : themedTextMuted;
  const border = half ? half.borderStrong : themedBorder;
  const borderStrong = half ? half.textMuted : themedBorderStrong;
  const destructive = half ? half.destructive : themedDestructive;

  const isDisabled = editable === false;
  const underlineColor = error ? destructive : focused ? borderStrong : border;

  return (
    <View style={isRow ? styles.rowContainer : styles.container}>
      {label ? (
        <ThemedText
          type="supporting"
          accessibilityRole={isRow ? undefined : 'header'}
          style={isDisabled ? styles.disabled : undefined}
        >
          {label}
        </ThemedText>
      ) : null}
      <RNTextInput
        accessibilityLabel={accessibilityLabel ?? label}
        editable={editable}
        placeholderTextColor={textMuted}
        selectionColor={borderStrong}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[
          styles.input,
          { color: textPrimary, borderBottomColor: underlineColor },
          isRow ? styles.inputRow : undefined,
          focused && !error && !isRow ? styles.inputFocused : undefined,
          isDisabled ? styles.disabled : undefined,
          containerStyle,
        ]}
        {...rest}
      />
      {error ? (
        <ThemedText accessibilityRole="alert" type="caption" style={{ color: destructive }}>
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing[4],
  },
  input: {
    minHeight: 48,
    paddingVertical: Spacing[8],
    ...Typography.body,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  inputFocused: {
    borderBottomWidth: 1.5,
  },
  /** The platform's form row: label left, value right, no underline. */
  rowContainer: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing[12],
    minHeight: 48,
  },
  inputRow: {
    borderBottomWidth: 0,
    flex: 1,
    minHeight: 44,
    textAlign: 'right',
  },
  disabled: {
    opacity: 0.55,
  },
});
