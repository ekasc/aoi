import { Stack, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { phraseFromRecoveryEntropy } from '@/features/album/recovery';
import { readRecoveryEntropy } from '@/features/album/protocol-local-state';
import { useSpace } from '@/features/space/space-context';

/**
 * The recovery phrase, shown once and confirmed.
 *
 * The words are rendered from the entropy this device already holds, and they
 * live only in this component's state: nothing here logs them, sends them, or
 * writes them to any store other than the keystore the entropy came from. The
 * screen has no "copy" action, because a clipboard is a general-purpose store
 * with no expiry and a phrase on paper is the point.
 */

export default function RecoveryPhraseRoute() {
  const router = useRouter();
  const { space } = useSpace();
  const spaceId = space?.id;
  const [words, setWords] = useState<string[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [writtenDown, setWrittenDown] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [firstAnswer, setFirstAnswer] = useState('');
  const [secondAnswer, setSecondAnswer] = useState('');
  // Two spot-check positions, drawn once per mount: confirming back a sample
  // proves the paper copy, not just the tap.
  const [checkPositions] = useState(() => {
    const first = Math.floor(Math.random() * 12);
    const second = 12 + Math.floor(Math.random() * 12);
    return [first, second] as const;
  });
  const wordGroups = useMemo(() => {
    if (!words) return [];
    return [0, 1, 2, 3].map((group) => words.slice(group * 6, group * 6 + 6));
  }, [words]);

  useEffect(() => {
    let cancelled = false;
    if (!spaceId) return;
    void readRecoveryEntropy(spaceId).then((entropy) => {
      if (cancelled) return;
      if (!entropy) {
        setMissing(true);
        return;
      }
      setWords(phraseFromRecoveryEntropy(entropy).split(' '));
    });
    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  return (
    <View style={styles.page}>
      <Stack.Screen options={{ title: 'Recovery phrase' }} />
      <ScrollView contentContainerStyle={styles.content}>
        {missing ? (
          <>
            <ThemedText type="subheading">No phrase on this device</ThemedText>
            <ThemedText type="body" style={styles.muted}>
              The phrase belongs to the device that created this album. On that phone,
              open this screen to see it.
            </ThemedText>
          </>
        ) : null}

        {words ? (
          <>
            <ThemedText type="subheading">Write these 24 words down</ThemedText>
            <ThemedText type="body" style={styles.muted}>
              They are the only way back into this album if every phone is lost.
              Anyone who has them can read the album. Write them on paper and
              keep them somewhere private — never a screenshot or a note on this phone.
            </ThemedText>
            {wordGroups.map((group, groupIndex) => (
              <View
                key={`group-${groupIndex}`}
                accessibilityLabel={`Words ${groupIndex * 6 + 1} to ${groupIndex * 6 + 6}`}
                style={styles.wordGroup}
              >
                {group.map((word, index) => {
                  const number = groupIndex * 6 + index + 1;
                  return (
                    <ThemedText
                      key={`${number}-${word}`}
                      type="body"
                      accessibilityLabel={`Word ${number} of ${words.length}: ${word}`}
                    >
                      {`${number}. ${word}`}
                    </ThemedText>
                  );
                })}
              </View>
            ))}

            {confirmed ? (
              <ThemedText type="body" accessibilityLiveRegion="polite" style={styles.saved}>
                Kept on paper — the app does not store these words.
              </ThemedText>
            ) : writtenDown ? (
              <>
                <ThemedText type="subheading">
                  Check two words from your paper
                </ThemedText>
                <ThemedText type="body" style={styles.muted}>
                  What is word {checkPositions[0] + 1}?
                </ThemedText>
                <TextInput
                  accessibilityLabel={`Word ${checkPositions[0] + 1} from your paper copy`}
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={(value) => {
                    setFirstAnswer(value);
                    setCheckError('');
                  }}
                  style={styles.checkInput}
                  value={firstAnswer}
                />
                <ThemedText type="body" style={styles.muted}>
                  What is word {checkPositions[1] + 1}?
                </ThemedText>
                <TextInput
                  accessibilityLabel={`Word ${checkPositions[1] + 1} from your paper copy`}
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={(value) => {
                    setSecondAnswer(value);
                    setCheckError('');
                  }}
                  style={styles.checkInput}
                  value={secondAnswer}
                />
                {checkError ? (
                  <ThemedText accessibilityRole="alert" type="body">
                    {checkError}
                  </ThemedText>
                ) : null}
                <Button
                  label="Confirm my paper copy"
                  onPress={() => {
                    const ok =
                      firstAnswer.trim().toLowerCase() === words[checkPositions[0]] &&
                      secondAnswer.trim().toLowerCase() === words[checkPositions[1]];
                    if (ok) {
                      setCheckError('');
                      setConfirmed(true);
                    } else {
                      setCheckError(
                        'That does not match — check your paper and try again.',
                      );
                    }
                  }}
                />
              </>
            ) : (
              <Button
                label="I have written them down"
                onPress={() => setWrittenDown(true)}
                accessibilityHint="Shows a two-word check against your paper copy"
              />
            )}
          </>
        ) : null}

        {words === null && !missing ? (
          <ThemedText accessibilityLiveRegion="polite" type="body" style={styles.muted}>
            Checking this device…
          </ThemedText>
        ) : null}

        <Button label="Back" variant="secondary" onPress={() => router.back()} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { gap: Spacing[16], padding: Spacing[24] },
  muted: { opacity: 0.7 },
  saved: { opacity: 0.7 },
  words: { gap: Spacing[4], paddingVertical: Spacing[8] },
  wordGroup: { gap: Spacing[4], paddingVertical: Spacing[8] },
  checkInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    minHeight: 44,
    paddingHorizontal: Spacing[12],
  },
});
