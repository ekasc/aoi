import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn,
  ReduceMotion,
  useReducedMotion,
} from 'react-native-reanimated';
import type { Letter } from '@aoi/shared';

import { ThemedText } from '@/components/themed-text';
import { Surface } from '@/components/ui/surface';
import { Radii, Spacing, withAlpha } from '@/constants/theme';
import {
  formatOpenedDayLabel,
  formatOpensInLabel,
  isLetterReadyToOpen,
} from '@/features/letters/letter-time';
import { useThemeColor } from '@/hooks/use-theme-color';

// Ready edge: single warning pulse on mount, opacity only, runs once.
// Entering only; ReduceMotion.System skips it. No loop, no particles.
const READY_PULSE = FadeIn.duration(350).reduceMotion(ReduceMotion.System);

export type LetterCardProps = {
  letter: Letter;
  /** The shelf passes a ticking `now` so readiness flips live. */
  now?: Date;
  onPress?: (letter: Letter) => void;
};

/**
 * One letter on the shelf as a restrained layered envelope. Ivory paper
 * (theme surface) sits on the wine shelf (theme background) with tactile
 * depth from the raised surface and a hairline fold — no glass, no
 * diagonals. Sealed and opened letters are both quiet closed metadata —
 * never the body. The body appears only in the dedicated reader after a
 * successful server open result. States stay distinguishable by the existing
 * text: sealed waits ("Opens in…"), ready invites ("Ready to open"), opened
 * recalls ("Opened …").
 */
export function LetterCard({ letter, now, onPress }: LetterCardProps) {
  const accent = useThemeColor({}, 'accent');
  const warning = useThemeColor({}, 'warning');
  const partnerAccent = useThemeColor({}, 'partnerAccent');
  const secondary = useThemeColor({}, 'textSecondary');
  const surface = useThemeColor({}, 'surface');
  const surface2 = useThemeColor({}, 'surface2');
  const border = useThemeColor({}, 'border');
  const reduceMotion = useReducedMotion();

  const authorColor = letter.authorRole === 'you' ? accent : partnerAccent;

  if (letter.isOpened) {
    const heading = letter.caption ?? 'An opened letter';
    const openedSuffix = letter.openedAt
      ? ` · Opened ${formatOpenedDayLabel(letter.openedAt)}`
      : '';
    const label = `Letter: ${heading}. ${letter.authorName}${openedSuffix}.`;
    const content = (
      <>
        <View style={styles.metaRow}>
          <View style={[styles.authorDot, { backgroundColor: authorColor }]} />
          <ThemedText type="caption" style={{ color: secondary }}>
            {letter.authorName}
            {openedSuffix}
          </ThemedText>
        </View>
        <ThemedText
          numberOfLines={2}
          style={letter.caption ? styles.sealedHeadingFlex : { color: secondary }}
          type="bodyEmphasis"
        >
          {heading}
        </ThemedText>
      </>
    );

    if (!onPress) {
      return (
        <Surface variant="raised" style={styles.openedCard}>
          <View
            testID="letter-open-slot"
            style={[
              styles.openSlot,
              { backgroundColor: surface2, borderBottomColor: border },
            ]}
          />
          {content}
        </Surface>
      );
    }

    return (
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        hitSlop={Spacing[8]}
        onPress={() => onPress(letter)}
        style={styles.hitTarget}
      >
        {({ pressed }) => (
          <Surface
            variant="raised"
            style={[
              styles.openedCard,
              { backgroundColor: surface, borderColor: border },
              pressed && !reduceMotion ? styles.pressedScale : undefined,
            ]}
          >
            <View
              testID="letter-open-slot"
              style={[
                styles.openSlot,
                { backgroundColor: surface2, borderBottomColor: border },
              ]}
            />
            {content}
          </Surface>
        )}
      </Pressable>
    );
  }

  const ready = isLetterReadyToOpen(letter, now ?? new Date());
  const heading = letter.caption ?? 'An unopened letter';
  const statusLabel = ready ? 'Ready to open' : formatOpensInLabel(letter.sealedUntil, now ?? new Date());

  return (
    <Pressable
      accessibilityLabel={`Letter: ${heading}. ${statusLabel}.`}
      accessibilityRole="button"
      hitSlop={Spacing[8]}
      onPress={onPress ? () => onPress(letter) : undefined}
      style={styles.hitTarget}
    >
      {({ pressed }) => (
        <Surface
          variant="raised"
          style={[
            styles.sealedCard,
            {
              backgroundColor: surface2,
              borderColor: ready ? warning : border,
            },
            pressed && !reduceMotion ? styles.pressedScale : undefined,
          ]}
        >
          <View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.paperPeek, { backgroundColor: withAlpha(surface2, 0.6), borderColor: border }]}
          />
          <View
            testID="letter-flap"
            style={[
              styles.flap,
              { backgroundColor: withAlpha(surface, 0.3), borderBottomColor: border },
            ]}
          />
          {/* Ready state: a warning edge along the sealed top. */}
          {ready ? (
            <Animated.View
              entering={READY_PULSE}
              testID="letter-ready-edge"
              style={[styles.readyEdge, { backgroundColor: warning }]}
            />
          ) : null}
          <View style={styles.metaRow}>
            <View style={[styles.authorDot, { backgroundColor: authorColor }]} />
            <ThemedText
              numberOfLines={2}
              style={letter.caption ? styles.sealedHeadingFlex : { color: secondary }}
              type="bodyEmphasis"
            >
              {heading}
            </ThemedText>
          </View>
          <View style={styles.sealedMeta}>
            <ThemedText type="caption" style={{ color: secondary }}>
              {`Sealed by ${letter.authorName}`}
            </ThemedText>
            <ThemedText type="caption" style={{ color: ready ? warning : secondary }}>
              {statusLabel}
            </ThemedText>
          </View>
        </Surface>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // 44pt target lives on the Pressable so the whole envelope is tappable.
  hitTarget: {
    justifyContent: 'center',
    minHeight: 44,
  },
  // Transform-only press feedback; skipped under reduced motion.
  pressedScale: {
    transform: [{ scale: 0.985 }],
  },
  sealedCard: {
    gap: Spacing[12],
    minHeight: 108,
    overflow: 'hidden',
    paddingTop: Spacing[24],
  },
  paperPeek: {
    position: 'absolute',
    top: Spacing[8],
    left: Spacing[16],
    right: Spacing[16],
    height: Spacing[32],
    borderRadius: Radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    transform: [{ rotate: '-2deg' }],
  },
  // Full-bleed flap across the sealed top; the bottom hairline is the fold.
  flap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    height: Spacing[32],
    borderBottomLeftRadius: Spacing[40],
    borderBottomRightRadius: Spacing[40],
    marginHorizontal: -Spacing[16],
    marginTop: -Spacing[8],
  },
  // Thin warning edge pinned to the sealed top when the letter is ready.
  readyEdge: {
    height: 3,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  // Opened mouth: the inverse layer — a shallow inner sheet peeking where
  // the sealed flap was, so opened reads as open without new geometry.
  openSlot: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    height: 8,
    marginHorizontal: -Spacing[16],
    marginTop: -Spacing[16],
  },
  sealedMeta: {
    gap: Spacing[4],
  },
  openedCard: {
    gap: Spacing[12],
    minHeight: 44,
    overflow: 'hidden',
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing[8],
  },
  authorDot: {
    borderRadius: Radii.pill,
    flexShrink: 0,
    height: 8,
    width: 8,
  },
  sealedHeadingFlex: {
    flex: 1,
  },
});
