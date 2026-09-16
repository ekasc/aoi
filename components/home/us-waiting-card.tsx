import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing } from '@/constants/theme';
import type { UsFocal } from '@/features/home/us-focal';
import { formatSealDayLabel } from '@/features/letters/letter-time';
import type { Letter } from '@/features/letters/types';
import type { WeeklyQuestionState } from '@/features/question/types';
import { useThemeColor } from '@/hooks/use-theme-color';

export type UsWaitingCardProps = {
  focal: UsFocal;
  partnerName: string;
  onOpenLetter: (letter: Letter) => void;
  onOpenQuestion: () => void;
};

/**
 * What is waiting between the two of you, shown as the thing itself.
 *
 * The screen used to name destinations ("Letters", "Reflection") and leave
 * the reader to guess whether anything was inside. A sealed letter coming due
 * and this week's question are the two events that are actually happening
 * now, so the card shows the envelope and the question. When neither is
 * pending it says so and stays out of the way.
 */
export function UsWaitingCard({
  focal,
  partnerName,
  onOpenLetter,
  onOpenQuestion,
}: UsWaitingCardProps) {
  const accent = useThemeColor({}, 'accent');
  const borderStrong = useThemeColor({}, 'borderStrong');
  const muted = useThemeColor({}, 'muted');
  const surface = useThemeColor({}, 'surface');
  const textPrimary = useThemeColor({}, 'textPrimary');

  if (focal.kind === 'letter' || focal.kind === 'question') {
    const isLetter = focal.kind === 'letter';
    const letter: Letter | null = isLetter ? focal.letter : null;
    const question: WeeklyQuestionState | null = isLetter ? null : focal.question;
    const eyebrow = isLetter
      ? `A letter from ${letter?.authorName ?? partnerName}`
      : 'This week';
    const title = isLetter
      ? letter?.caption?.trim() || 'Sealed and waiting'
      : question?.question ?? '';
    const detail = isLetter
      ? formatSealDayLabel(letter?.sealedUntil ?? '')
      : question?.revealed
        ? 'Both answers are in'
        : question?.yourAnswer
          ? `You answered. ${partnerName} has not yet.`
          : 'Your answer is waiting';
    const action = isLetter ? 'Open it' : 'Answer';

    return (
      <Pressable
        accessibilityHint={isLetter ? 'Opens the letter' : 'Opens this week’s question'}
        accessibilityLabel={`${eyebrow}. ${title}. ${detail}. ${action}`}
        accessibilityRole="button"
        onPress={() => {
          if (letter) {
            onOpenLetter(letter);
            return;
          }
          onOpenQuestion();
        }}
        style={({ pressed }) => [
          styles.card,
          { backgroundColor: surface, borderColor: pressed ? accent : borderStrong },
          pressed ? styles.pressed : null,
        ]}
      >
        <ThemedText type="meta" style={{ color: muted }}>
          {eyebrow}
        </ThemedText>
        <ThemedText type="title" style={styles.title}>
          {title}
        </ThemedText>
        <View style={styles.footer}>
          <ThemedText type="caption" style={{ color: muted }}>
            {detail}
          </ThemedText>
          <View style={styles.action}>
            <ThemedText type="label" style={{ color: textPrimary }}>
              {action}
            </ThemedText>
            <Ionicons color={muted} name="chevron-forward" size={14} />
          </View>
        </View>
      </Pressable>
    );
  }

  // Nothing pending. This is not an empty state to fix: a quiet day between
  // two people is the point, so it says so and leaves the sky to it.
  return (
    <View accessibilityLiveRegion="polite" style={styles.quiet}>
      <ThemedText type="caption" style={{ color: muted }}>
        {focal.kind === 'moment'
          ? `Nothing waiting. Last kept ${formatSealDayLabel(focal.moment.occurredAt)}.`
          : 'Nothing waiting.'}
      </ThemedText>
      <ThemedText type="label" style={{ color: muted }}>
        {partnerName} is one squeeze away
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.lg,
    gap: Spacing[8],
    padding: Spacing[16],
  },
  pressed: {
    opacity: 0.92,
  },
  title: {
    lineHeight: 28,
  },
  footer: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing[8],
    justifyContent: 'space-between',
  },
  action: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing[4],
  },
  quiet: {
    gap: Spacing[4],
    paddingHorizontal: Spacing[4],
  },
});
