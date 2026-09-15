import { useState } from 'react';
import {
  StyleSheet,
  TextInput as RNTextInput,
  View,
  type TextInputProps as RNTextInputProps,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';

export type PaperTextInputProps = Omit<RNTextInputProps, 'style'> & {
  label?: string;
  error?: string;
  containerStyle?: RNTextInputProps['style'];
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
  editable = true,
  onFocus,
  onBlur,
  accessibilityLabel,
  ...rest
}: PaperTextInputProps) {
  const [focused, setFocused] = useState(false);
  const textPrimary = useThemeColor({}, 'textPrimary');
  const textMuted = useThemeColor({}, 'textMuted');
  const border = useThemeColor({}, 'border');
  const borderStrong = useThemeColor({}, 'borderStrong');
  const destructive = useThemeColor({}, 'destructive');

  const isDisabled = editable === false;
  const underlineColor = error ? destructive : focused ? borderStrong : border;

  return (
    <View style={styles.container}>
      {label ? (
        <ThemedText
          type="supporting"
          accessibilityRole="header"
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
          focused && !error ? styles.inputFocused : undefined,
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
    fontSize: 16,
    lineHeight: 24,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  inputFocused: {
    borderBottomWidth: 1.5,
  },
  disabled: {
    opacity: 0.55,
  },
});
