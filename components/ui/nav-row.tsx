import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useThemeColor } from '@/hooks/use-theme-color';

/**
 * A navigational row: a leading slot, a label, and a trailing slot (a chevron
 * by default). This is the app's one grouped-list row shape — shared so the
 * screens that use it cannot drift apart.
 */
export function NavRow({
  label,
  onPress,
  accessibilityLabel,
  leading,
  trailing,
  accent = false,
  divider = false,
}: {
  label: string;
  onPress: () => void;
  /** Override the spoken name when the visible label is not the whole story. */
  accessibilityLabel?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  accent?: boolean;
  /** A hairline above the row, so a flush group reads as one list. */
  divider?: boolean;
}) {
  const border = useThemeColor({}, 'border');
  const muted = useThemeColor({}, 'muted');
  const accentInk = useThemeColor({}, 'accentInk');

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.navRow,
        divider ? { borderTopWidth: StyleSheet.hairlineWidth, borderColor: border } : null,
        pressed ? styles.pressed : null,
      ]}
    >
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <ThemedText
        numberOfLines={1}
        type="body"
        style={[styles.label, accent ? { color: accentInk } : null]}
      >
        {label}
      </ThemedText>
      <View style={styles.trailing}>
        {trailing}
        <Ionicons color={accent ? accentInk : muted} name="chevron-forward" size={18} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  navRow: {
    alignItems: 'center',
    borderRadius: 12,
    borderCurve: 'continuous',
    flexDirection: 'row',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 16,
  },
  leading: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    flex: 1,
  },
  trailing: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  pressed: {
    opacity: 0.6,
  },
});
