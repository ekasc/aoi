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
  /**
   * The refusal, if there is one.
   *
   * Showing it must cost no layout, so pair it with `reservesMessage` on any
   * field that reports one at some point.
   */
  error?: string;
  /**
   * Reserve the message line from the first frame. A field that reserves it is
   * the same height whether or not the message is showing, so the refusal
   * cannot push the rows below it down. Leave it off for a field that never
   * reports one: the line is always mounted, and a field with nothing to say
   * should not carry a permanent blank one.
   */
  reservesMessage?: boolean;

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
  reservesMessage = false,
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
  // Only an `error` flags the field, because only an error carries the reason.
  const flagged = Boolean(error);
  const underlineColor = flagged ? destructive : focused ? borderStrong : border;
  // A field reserves the line once it has something to say, and keeps it: the
  // reservation is what makes showing the message cost no layout.
  const reservesMessageLine = reservesMessage || error !== undefined;

  return (
    <View style={isRow ? styles.rowContainer : styles.container}>
      {isRow ? (
        // In a row the message cannot sit beside the field: the label and the
        // value already fill the width. It gets its own line underneath.
        <View style={styles.rowField}>
          {label ? (
            <ThemedText type="supporting" style={isDisabled ? styles.disabled : undefined}>
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
              styles.inputRow,
              isDisabled ? styles.disabled : undefined,
              containerStyle,
            ]}
            {...rest}
          />
        </View>
      ) : (
        <>
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
              focused && !flagged ? styles.inputFocused : undefined,
              isDisabled ? styles.disabled : undefined,
              containerStyle,
            ]}
            {...rest}
          />
        </>
      )}
      {/*
        The message is always mounted, and always occupies its line, whether or
        not there is anything to say. Mounting it on demand grew the field by a
        line at the exact moment the reader was looking at it, pushing the rows
        below and the submit button down: a validation message must not move the
        form. The text is faded rather than added, so the space is already there
        when the words arrive.

        Live rather than assertive: it appears as a result of what the reader
        just typed or tapped, and an assertive announcement would interrupt them
        mid-sentence. `alert` still names it as an error to VoiceOver, which is
        what a validation failure is. Kept mounted so the live region is
        registered before the text changes into it.
      */}
      {/*
        Mounted whenever the field can report something, and occupying its line
        from the first frame: mounting it on demand grew the field by a line at
        the exact moment the reader was looking at it, pushing the rows below
        and the submit button down. A validation message must not move the form.
        The words fade in; the space was always there.
      */}
      {reservesMessageLine ? (
        error ? (
          <ThemedText
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
            testID="field-message"
            type="caption"
            style={[styles.message, { color: destructive }]}
          >
            {error}
          </ThemedText>
        ) : (
          // The reservation itself: present and one line tall, carrying no
          // words and no accessibility role, because there is nothing to say
          // and nothing for a screen reader to be told. It fades in later rather
          // than mounting, so the form never moves.
          <View style={styles.message} testID="field-message" />
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing[4],
  },
  /**
   * One line, always, so a scaled font still gets its own and nothing below it
   * moves. The messages are short by design for the same reason: a second line
   * would shift the form on exactly the screens it is trying to help.
   */
  message: {
    // The reservation and the message share one style so the line is the same
    // height in both states. `minHeight` rather than `height` so a scaled font
    // still gets its own line.
    minHeight: Typography.caption.lineHeight,
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
    gap: Spacing[4],
  },
  rowField: {
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
