import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';

export type NativeDateTimeFieldProps = {
  label: string;
  value: Date;
  mode: 'date' | 'time';
  onChange: (nextValue: Date) => void;
  accessibilityLabel?: string;
  minuteInterval?: number;
  minimumDate?: Date;
  maximumDate?: Date;
  disabled?: boolean;
};

function formatFieldValue(value: Date, mode: 'date' | 'time') {
  if (mode === 'time') {
    return value.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
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
}: NativeDateTimeFieldProps) {
  const isIos = process.env.EXPO_OS === 'ios';
  const isAndroid = process.env.EXPO_OS === 'android';
  const border = useThemeColor({}, 'border');
  const surface2 = useThemeColor({}, 'surface2');
  const muted = useThemeColor({}, 'muted');
  const [isOpen, setIsOpen] = useState(false);

  const valueLabel = useMemo(() => formatFieldValue(value, mode), [mode, value]);
  const pickerDisplay = useMemo(() => {
    if (!isIos) {
      return 'default' as const;
    }

    return 'spinner' as const;
  }, [isIos]);

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
      <ThemedText type="meta" style={{ color: muted }}>
        {label}
      </ThemedText>
      <Pressable
        accessibilityLabel={accessibilityLabel ?? `Choose ${label.toLowerCase()}`}
        accessibilityRole="button"
        disabled={disabled}
        onPress={() => setIsOpen(true)}
        style={[
          styles.valueButton,
          {
            borderColor: border,
            backgroundColor: surface2,
          },
          disabled ? styles.disabled : undefined,
        ]}
      >
        <ThemedText type="body">{valueLabel}</ThemedText>
        <ThemedText type="caption" style={{ color: muted }}>
          Tap to change
        </ThemedText>
      </Pressable>

      {isOpen ? (
        isIos ? (
          <View style={[styles.pickerCard, { borderColor: border, backgroundColor: surface2 }]}>
            <DateTimePicker
              display={pickerDisplay}
              maximumDate={maximumDate}
              minimumDate={minimumDate}
              minuteInterval={minuteInterval}
              mode={mode}
              onChange={handlePickerChange}
              value={value}
            />
            <Button
              label="Done"
              onPress={() => setIsOpen(false)}
              size="sm"
              variant="secondary"
            />
          </View>
        ) : (
          <DateTimePicker
            display={pickerDisplay}
            maximumDate={maximumDate}
            minimumDate={minimumDate}
            minuteInterval={minuteInterval}
            mode={mode}
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
  valueButton: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: Spacing[12],
    paddingVertical: Spacing[12],
    justifyContent: 'center',
    gap: Spacing[4],
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
