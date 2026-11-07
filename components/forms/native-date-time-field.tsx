import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { NativeSheet } from '@/components/ui/native-sheet';

export type NativeDateTimeFieldProps = {
  /**
   * The field's name, printed above it. Omit it to let the field stand alone:
   * an unset field then reads as its `placeholder`, like a text field does.
   */
  label?: string;
  /** What an unset field says instead of a date. */
  placeholder?: string;
  /** Null renders the field unset: it asks for a date rather than claiming one. */
  value: Date | null;
  mode: 'date' | 'time' | 'datetime';
  onChange: (nextValue: Date) => void;
  accessibilityLabel?: string;
  minuteInterval?: number;
  minimumDate?: Date;
  maximumDate?: Date;
  disabled?: boolean;
  /** Compact chip variant: no label or caption, tighter padding. */
  compact?: boolean;
  /**
   * `row` is the platform's form row: label left, value right, no border.
   * `inline` is the same row under a label, wearing the text field's hairline
   * underline instead of a bordered box, so the two fields in a group match.
   */
  variant?: 'stacked' | 'row' | 'inline';
  /** Hide the confirmation button (e.g. when an external advance control is used). */
  hideDone?: boolean;
  /** Picker text color — improves contrast on dark panels (iOS only). */
  textColor?: string;
};

function formatFieldValue(value: Date, mode: 'date' | 'time' | 'datetime') {
  if (mode === 'time') {
    return value.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  if (mode === 'datetime') {
    const datePart = value.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    const timePart = value.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
    return `${datePart} · ${timePart}`;
  }

  return value.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function NativeDateTimeField({
  label,
  placeholder,
  value,
  mode,
  onChange,
  accessibilityLabel,
  minuteInterval,
  minimumDate,
  maximumDate,
  disabled,
  compact,
  variant = 'stacked',
  hideDone,
  textColor,
}: NativeDateTimeFieldProps) {
  const isIos = process.env.EXPO_OS === 'ios';
  const isAndroid = process.env.EXPO_OS === 'android';
  const border = useThemeColor({}, 'border');
  const surface2 = useThemeColor({}, 'surface2');
  const muted = useThemeColor({}, 'muted');
  const [isOpen, setIsOpen] = useState(false);

  const isRow = variant === 'row';
  const isInline = variant === 'inline';
  const [sheetOpen, setSheetOpen] = useState(false);
  const waitingForKeyboard = useRef(false);
  useEffect(() => {
    if (!isIos) return;
    const subscription = Keyboard.addListener('keyboardDidHide', () => {
      if (!waitingForKeyboard.current) return;
      waitingForKeyboard.current = false;
      setSheetOpen(true);
    });
    return () => subscription.remove();
  }, [isIos]);
  const valueLabel = useMemo(
    () => (value ? formatFieldValue(value, mode) : 'Choose'),
    [mode, value]
  );
  // The picker always needs a date to start from, even when the field is unset.
  const pickerValue = useMemo(() => value ?? new Date(), [value]);
  // The inline variant shares a row with another field, so the long date does
  // not fit beside the chevron: the same day in the short form, chosen by hand
  // in the picker that opens from it.
  const inlineLabel = useMemo(
    () =>
      value
        ? value.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : placeholder ?? 'Choose',
    [value, placeholder]
  );
  // Android has no combined datetime picker — fall back to date-only there.
  const pickerMode = isAndroid && mode === 'datetime' ? 'date' : mode;
  const pickerDisplay = useMemo(() => (isIos ? 'spinner' : 'default'), [isIos]);

  const handlePickerChange = useCallback(
    (event: DateTimePickerEvent, selectedDate?: Date) => {
      if (isAndroid) {
        setIsOpen(false);
      }

      if (event.type === 'dismissed' || !selectedDate) {
        return;
      }

      onChange(selectedDate);
    },
    [isAndroid, onChange]
  );

  return (
    <View style={styles.container}>
      {!isRow && !compact && label ? (
        isInline ? (
          <ThemedText type="label">{label}</ThemedText>
        ) : (
          <ThemedText type="meta" style={{ color: muted }}>
            {label}
          </ThemedText>
        )
      ) : null}
      <Pressable
        accessibilityLabel={accessibilityLabel ?? (label ? `Choose ${label.toLowerCase()}` : 'Choose a date')}
        accessibilityRole="button"
        accessibilityState={{ disabled: Boolean(disabled), expanded: isIos ? sheetOpen : isOpen }}
        disabled={disabled}
        onPress={() => {
          if (isIos) {
            // Avoid running the form's keyboard resize and sheet presentation together.
            if (Keyboard.isVisible()) {
              waitingForKeyboard.current = true;
              Keyboard.dismiss();
            } else {
              setSheetOpen(true);
            }
          } else {
            Keyboard.dismiss();
            setIsOpen((current) => !current);
          }
        }}
        style={[
          isRow ? styles.rowButton : isInline ? styles.inlineButton : styles.valueButton,
          isInline ? { borderBottomColor: border } : undefined,
          isRow || isInline
            ? undefined
            : {
                borderColor: border,
                backgroundColor: surface2,
              },
          compact ? styles.valueButtonCompact : undefined,
          disabled ? styles.disabled : undefined,
        ]}
      >
        {isRow || isInline ? (
          <>
            {isRow ? (
              <ThemedText type="body" style={{ color: muted }}>
                {label ?? ''}
              </ThemedText>
            ) : (
              // Unset reads as an ask, not as a value: the field says what it
              // needs rather than showing today's date as if it were chosen.
              <ThemedText type="subheading" style={value ? undefined : { color: muted }}>
                {inlineLabel}
              </ThemedText>
            )}
            <View style={styles.rowSpacer} />
            {isRow ? (
              <ThemedText type="body">{valueLabel}</ThemedText>
            ) : null}
            <Ionicons
              color={muted}
              name={(isIos ? sheetOpen : isOpen) ? 'chevron-up' : 'chevron-down'}
              size={14}
            />
          </>
        ) : (
          <>
            <ThemedText type="body">{valueLabel}</ThemedText>
            {!compact ? (
              <ThemedText type="caption" style={{ color: muted }}>
                {isOpen ? 'Tap to close' : 'Tap to change'}
              </ThemedText>
            ) : null}
          </>
        )}
      </Pressable>

      {isIos ? <NativeSheet onClose={() => setSheetOpen(false)} visible={sheetOpen}>
        <View style={{ gap: Spacing[12], paddingBottom: Spacing[16], paddingHorizontal: Spacing[16] }}>
          <DateTimePicker
            style={styles.iosPicker}
            display={pickerDisplay}
            maximumDate={maximumDate}
            minimumDate={minimumDate}
            minuteInterval={minuteInterval}
            mode={pickerMode}
            onChange={handlePickerChange}
            textColor={textColor}
            value={pickerValue}
          />
          {hideDone ? null : (
            <Button label="Done" onPress={() => setSheetOpen(false)} />
          )}
        </View>
      </NativeSheet> : null}

      {isOpen && !isIos ? (
          <DateTimePicker
            display={pickerDisplay}
            maximumDate={maximumDate}
            minimumDate={minimumDate}
            minuteInterval={minuteInterval}
            mode={pickerMode}
            onChange={handlePickerChange}
            value={pickerValue}
          />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  iosPicker: {
    height: 216,
  },
  container: {
    gap: Spacing[8],
  },
  rowButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[8],
  },
  /** The text field's underline, so a date sits in a row of paper fields. */
  inlineButton: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[8],
    minHeight: 56,
    paddingVertical: Spacing[8],
  },
  rowSpacer: {
    flex: 1,
  },
  valueButton: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: Spacing[12],
    paddingVertical: Spacing[12],
    justifyContent: 'center',
    gap: Spacing[4],
  },
  valueButtonCompact: {
    minHeight: 44,
    borderRadius: 10,
    paddingVertical: Spacing[8],
  },
  disabled: {
    opacity: 0.55,
  },
});
