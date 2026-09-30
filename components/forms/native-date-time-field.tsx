import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { MotiView } from 'moti';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Motion, Spacing } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { NativeSheet } from '@/components/ui/native-sheet';

export type NativeDateTimeFieldProps = {
  label: string;
  value: Date;
  mode: 'date' | 'time' | 'datetime';
  onChange: (nextValue: Date) => void;
  accessibilityLabel?: string;
  minuteInterval?: number;
  minimumDate?: Date;
  maximumDate?: Date;
  disabled?: boolean;
  /** Compact chip variant: no label or caption, tighter padding. */
  compact?: boolean;
  /** Apple-style grouped row: label left, value right, tap to expand. */
  variant?: 'stacked' | 'row';
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
  // iOS presents its picker in a sheet rather than in the page: a picker card
  // rendered in place grows the field and pushes everything below it down, and
  // on a form that is the difference between choosing a date and losing your
  // place. Android's picker is already a dialog and needs no sheet.
  const [sheetOpen, setSheetOpen] = useState(false);
  const valueLabel = useMemo(() => formatFieldValue(value, mode), [mode, value]);
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
      {!isRow && !compact ? (
        <ThemedText type="meta" style={{ color: muted }}>
          {label}
        </ThemedText>
      ) : null}
      <Pressable
        accessibilityLabel={accessibilityLabel ?? `Choose ${label.toLowerCase()}`}
        accessibilityRole="button"
        disabled={disabled}
        onPress={() =>
          isIos ? setSheetOpen(true) : setIsOpen((current) => !current)
        }
        style={[
          isRow ? styles.rowButton : styles.valueButton,
          isRow
            ? undefined
            : {
                borderColor: border,
                backgroundColor: surface2,
              },
          compact ? styles.valueButtonCompact : undefined,
          disabled ? styles.disabled : undefined,
        ]}
      >
        {isRow ? (
          <>
            <ThemedText type="body" style={{ color: muted }}>
              {label}
            </ThemedText>
            <View style={styles.rowSpacer} />
            <ThemedText type="body">{valueLabel}</ThemedText>
            <Ionicons
              color={muted}
              name={isOpen ? 'chevron-up' : 'chevron-down'}
              size={14}
            />
          </>
        ) : (
          <>
            <ThemedText type="body">{valueLabel}</ThemedText>
            {!compact ? (
              <ThemedText type="caption" style={{ color: muted }}>
                Tap to change
              </ThemedText>
            ) : null}
          </>
        )}
      </Pressable>

      {/* The platform's own sheet, so the OS owns the presentation, the motion
          and the dismissal, and the page underneath never moves. */}
      <NativeSheet onClose={() => setSheetOpen(false)} visible={sheetOpen}>
        <View style={{ gap: Spacing[12], paddingBottom: Spacing[16], paddingHorizontal: Spacing[16] }}>
          <DateTimePicker
            display={pickerDisplay}
            maximumDate={maximumDate}
            minimumDate={minimumDate}
            minuteInterval={minuteInterval}
            mode={pickerMode}
            onChange={handlePickerChange}
            textColor={textColor}
            value={value}
          />
          {hideDone ? null : (
            <Button label="Done" onPress={() => setSheetOpen(false)} />
          )}
        </View>
      </NativeSheet>

      {isOpen && !isIos ? (
        isIos ? (
          <MotiView
            from={{ opacity: 0, translateY: 6 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ duration: Motion.fast }}
            style={[styles.pickerCard, { borderColor: border, backgroundColor: surface2 }]}
          >
            <DateTimePicker
              display={pickerDisplay}
              maximumDate={maximumDate}
              minimumDate={minimumDate}
              minuteInterval={minuteInterval}
              mode={pickerMode}
              onChange={handlePickerChange}
              textColor={textColor}
              value={value}
            />
            {hideDone ? null : (
              <Button
                label="Done"
                onPress={() => setIsOpen(false)}
                size="sm"
                variant="secondary"
              />
            )}
          </MotiView>
        ) : (
          <DateTimePicker
            display={pickerDisplay}
            maximumDate={maximumDate}
            minimumDate={minimumDate}
            minuteInterval={minuteInterval}
            mode={pickerMode}
            onChange={handlePickerChange}
            value={value}
          />
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing[8],
  },
  rowButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[8],
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
  pickerCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: Spacing[8],
    paddingVertical: Spacing[8],
    gap: Spacing[8],
  },
  disabled: {
    opacity: 0.55,
  },
});
