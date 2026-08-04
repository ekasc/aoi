import { Pressable, StyleSheet, View } from 'react-native';
import type { Letter } from '@aoi/shared';

import { ThemedText } from '@/components/themed-text';
import { Surface } from '@/components/ui/surface';
import { Radii, Spacing } from '@/constants/theme';
import { FontFamilies } from '@/constants/typography';
import {
  formatOpenedDayLabel,
  formatOpensInLabel,
  isLetterReadyToOpen,
} from '@/features/letters/letter-time';
import { useThemeColor } from '@/hooks/use-theme-color';

export type LetterCardProps = {
  letter: Letter;
  /** The shelf passes a ticking `now` so readiness flips live. */
  now?: Date;
  onPress?: (letter: Letter) => void;
};

/**
 * One letter on the shelf. Sealed letters are quiet closed cards — the body
 * is never rendered (it is not even present in an unopened letter, for the
 * author too). Opened letters show their words in the display serif with who
 * wrote them and when they were opened.
 */
export function LetterCard({ letter, now, onPress }: LetterCardProps) {
  const accent = useThemeColor({}, 'accent');
  const partnerAccent = useThemeColor({}, 'partnerAccent');
  const muted = useThemeColor({}, 'muted');

  const authorColor = letter.authorRole === 'you' ? accent : partnerAccent;

  if (letter.isOpened) {
    return (
      <Surface style={styles.openedCard}>
        <View style={styles.metaRow}>
          <View style={[styles.authorDot, { backgroundColor: authorColor }]} />
          <ThemedText type="meta" style={{ color: muted }}>
            {letter.authorName}
            {letter.openedAt
              ? ` · Opened ${formatOpenedDayLabel(letter.openedAt)}`
              : ''}
          </ThemedText>
        </View>
        {letter.caption ? (
          <ThemedText type="caption" style={{ color: muted }}>
            {letter.caption}
          </ThemedText>
        ) : null}
        {/* The only place an unsealed body ever appears. */}
        <ThemedText selectable style={styles.openedBody}>
          {letter.body ?? ''}
        </ThemedText>
      </Surface>
    );
  }

  const ready = isLetterReadyToOpen(letter, now ?? new Date());
  const heading = letter.caption ?? 'An unopened letter';
  const statusLabel = ready ? 'Ready to open' : formatOpensInLabel(letter.sealedUntil, now ?? new Date());

  return (
    <Pressable
      accessibilityLabel={`Letter: ${heading}. ${statusLabel}.`}
      accessibilityRole="button"
      onPress={onPress ? () => onPress(letter) : undefined}
    >
      {({ pressed }) => (
        <Surface
          style={[
            styles.sealedCard,
            {
              borderColor: ready ? accent : undefined,
              opacity: pressed ? 0.92 : 1,
            },
          ]}
        >
          <View style={styles.metaRow}>
            <View style={[styles.authorDot, { backgroundColor: authorColor }]} />
            <ThemedText
              numberOfLines={2}
              style={letter.caption ? styles.sealedHeadingFlex : { color: muted }}
              type="body"
            >
              {heading}
            </ThemedText>
          </View>
          <ThemedText type="meta" style={{ color: ready ? accent : muted }}>
            {`Sealed by ${letter.authorName} · ${statusLabel}`}
          </ThemedText>
        </Surface>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sealedCard: {
    gap: Spacing[8],
  },
  openedCard: {
    gap: Spacing[12],
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing[8],
  },
  authorDot: {
    borderRadius: Radii.pill,
    height: 8,
    width: 8,
  },
  sealedHeadingFlex: {
    flex: 1,
  },
  // The display serif carries the opened words — a letter should read like a
  // letter, smaller than a headline but unmistakably ceremonial.
  openedBody: {
    fontFamily: FontFamilies.display,
    fontSize: 20,
    letterSpacing: -0.2,
    lineHeight: 30,
  },
});
