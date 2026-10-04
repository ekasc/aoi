import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { clampSkyHistoryIndex, SKY_HISTORY_PLUS, type SkyHistoryMonth } from '@/features/home/sky-history';
import { useThemeColor } from '@/hooks/use-theme-color';

type Props = {
  months: SkyHistoryMonth[];
  index: number;
  ageLabel: string;
  isPlus: boolean;
  onChange: (index: number) => void;
  onLockedPress: () => void;
};

export function SkyHistoryControl({ months, index, ageLabel, isPlus, onChange, onLockedPress }: Props) {
  const muted = useThemeColor({}, 'textSecondary');
  const accent = useThemeColor({}, 'accentInk');
  const border = useThemeColor({}, 'border');
  const [width, setWidth] = useState(0);
  const lastEmitted = useRef(index);
  const lastIndex = Math.max(0, months.length - 1);
  const selected = months[index];
  const selectAt = useCallback((x: number) => {
    if (width <= 0 || !Number.isFinite(x)) return;
    const next = clampSkyHistoryIndex(x / width * lastIndex, months.length);
    if (next !== lastEmitted.current) {
      lastEmitted.current = next;
      onChange(next);
    }
  }, [lastIndex, months.length, onChange, width]);
  const onLayout = useCallback((event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width), []);

  if (!isPlus) return <Button label={`${SKY_HISTORY_PLUS.title} · Plus`} variant="ghost" onPress={onLockedPress} />;
  if (!selected) return null;

  return <View>
    <View accessible accessibilityRole="adjustable" accessibilityLabel="Sky history"
      accessibilityHint="Swipe up or down to change the date. Earlier and Later buttons are also available."
      accessibilityValue={{ min: 0, max: lastIndex, now: index, text: `${selected.label}, ${ageLabel}` }}
      aria-valuemin={0} aria-valuemax={lastIndex} aria-valuenow={index} aria-valuetext={`${selected.label}, ${ageLabel}`}
      accessibilityActions={[{ name: 'increment', label: 'Later date' }, { name: 'decrement', label: 'Earlier date' }]}
      onAccessibilityAction={({ nativeEvent }) => {
        if (nativeEvent.actionName === 'increment') onChange(clampSkyHistoryIndex(index + 1, months.length));
        if (nativeEvent.actionName === 'decrement') onChange(clampSkyHistoryIndex(index - 1, months.length));
      }}
      onLayout={onLayout} onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true}
      onResponderGrant={({ nativeEvent }) => { lastEmitted.current = index; selectAt(nativeEvent.locationX); }}
      onResponderMove={({ nativeEvent }) => selectAt(nativeEvent.locationX)} style={styles.trackHit}>
      <View pointerEvents="none" style={[styles.track, { backgroundColor: border }]} />
      <View pointerEvents="none" style={[styles.thumb, { backgroundColor: accent, left: lastIndex ? index / lastIndex * Math.max(0, width - 14) : Math.max(0, width - 14) }]} />
    </View>
    <ThemedText type="caption" accessibilityLiveRegion="polite" style={{ color: muted }}>{selected.label} · {ageLabel}</ThemedText>
    <View style={styles.buttons}>
      <Button label="Earlier" accessibilityLabel="Earlier date" variant="ghost" disabled={index === 0} onPress={() => onChange(index - 1)} />
      {!selected.isToday ? <Button label="Today" variant="ghost" onPress={() => onChange(lastIndex)} /> : null}
      <Button label="Later" accessibilityLabel="Later date" variant="ghost" disabled={index === lastIndex} onPress={() => onChange(index + 1)} />
    </View>
  </View>;
}

const styles = StyleSheet.create({
  trackHit: { height: 44, justifyContent: 'center' },
  track: { height: 2, borderRadius: 1 },
  thumb: { position: 'absolute', width: 14, height: 14, borderRadius: 7 },
  buttons: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing[8] },
});
