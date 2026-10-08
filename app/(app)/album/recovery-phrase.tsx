import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

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
  const [confirmed, setConfirmed] = useState(false);

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
              Anyone who has them can read the album, so keep them somewhere private.
            </ThemedText>
            <View style={styles.words}>
              {words.map((word, index) => (
                <ThemedText
                  key={`${index}-${word}`}
                  type="body"
                  accessibilityLabel={`Word ${index + 1} of ${words.length}: ${word}`}
                >
                  {`${index + 1}. ${word}`}
                </ThemedText>
              ))}
            </View>

            {confirmed ? (
              <ThemedText type="body" accessibilityLiveRegion="polite" style={styles.saved}>
                Saved.
              </ThemedText>
            ) : (
              <Button
                label="I have written them down"
                onPress={() => setConfirmed(true)}
                accessibilityHint="Confirms the phrase has been stored somewhere safe"
              />
            )}
          </>
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
});
