import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import type { BeachThemeColors } from '@/constants/theme-presets';

/**
 * A keepsake share card: the month (or year) as a bound-book cover,
 * rendered for sending outward. Private creation, public artifact — the
 * card carries only what the sharer chose to show: title, count, range,
 * one photo, and the theme it was kept in. Never names, never bodies.
 *
 * Theme adaptation is structural, not decorative: every surface, ink, and
 * rule reads from the passed `colors`, so the same month renders as wine
 * dusk under After Hours and bright water under Beach. Callers pass the
 * palette explicitly so previews and tests can render any theme without
 * switching the provider.
 */
export type KeepsakeCardData = {
  title: string;
  subtitle: string;
  /** Human range, e.g. "Aug 1 – Aug 31, 2026". */
  dateRange: string;
  coverPhotoUri: string | null;
};

export function KeepsakeCard({
  card,
  colors,
  themeName,
}: {
  card: KeepsakeCardData;
  colors: BeachThemeColors;
  themeName: string;
}) {
  return (
    <View
      accessible
      accessibilityLabel={`Keepsake card: ${card.title}, ${card.subtitle}, ${card.dateRange}`}
      accessibilityRole="image"
      style={[styles.frame, { backgroundColor: colors.background, borderColor: colors.border }]}
    >
      <ThemedText type="meta" style={[styles.eyebrow, { color: colors.accent }]}>
        {card.dateRange}
      </ThemedText>
      <ThemedText type="display" numberOfLines={2} style={[styles.title, { color: colors.text }]}>
        {card.title}
      </ThemedText>
      <ThemedText type="body" style={[styles.subtitle, { color: colors.muted }]}>
        {card.subtitle}
      </ThemedText>
      {card.coverPhotoUri ? (
        <Image
          accessible={false}
          contentFit="cover"
          source={{ uri: card.coverPhotoUri }}
          style={[styles.photo, { borderColor: colors.border }]}
        />
      ) : null}
      <View style={[styles.rule, { backgroundColor: colors.accent }]} />
      <ThemedText type="meta" style={[styles.wordmark, { color: colors.muted }]}>
        kept in aoi · {themeName}
      </ThemedText>
    </View>
  );
}

/** "Aug 1 – Aug 31, 2026" from range endpoints; single-day ranges collapse. */
export function formatKeepsakeRange(fromMs: number, toMs: number): string {
  const from = new Date(fromMs);
  const to = new Date(toMs);
  const day = (date: Date) =>
    date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const year = to.toLocaleDateString('en-US', { year: 'numeric' });
  if (day(from) === day(to)) {
    return `${day(from)}, ${year}`;
  }
  return `${day(from)} – ${day(to)}, ${year}`;
}

const styles = StyleSheet.create({
  // 4:5 portrait, Instagram-friendly; width comes from the container so one
  // component serves the sheet preview and the full-resolution capture.
  frame: {
    aspectRatio: 4 / 5,
    width: '100%',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 24,
    overflow: 'hidden',
    padding: 32,
    gap: 12,
  },
  eyebrow: {
    fontWeight: '600',
  },
  title: {
    fontSize: 44,
    lineHeight: 50,
  },
  subtitle: {
    fontSize: 18,
    lineHeight: 26,
  },
  photo: {
    flex: 1,
    width: '100%',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    marginTop: 8,
  },
  rule: {
    height: 3,
    width: 56,
    borderRadius: 2,
  },
  wordmark: {
    fontWeight: '600',
  },
});
