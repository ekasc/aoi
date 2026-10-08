import { Stack, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { recoverProtocolArchive } from '@/features/album/protocol-archive';
import { RECOVERY_WORDS } from '@/features/album/recovery';
import { useThemeColor } from '@/hooks/use-theme-color';
import { useSpace } from '@/features/space/space-context';

/**
 * Recovering the archive on a replacement phone.
 *
 * The phrase is the trust decision here: `recoverProtocolArchive` checks the
 * anchor's recovery key, the recovery signature over the whole anchor, the root
 * signature, and the recovery envelope before it stores anything. This screen
 * only collects the words and reports what happened — it never decides trust,
 * and it keeps the typed phrase in component state alone.
 */

export default function RestoreRoute() {
  const router = useRouter();
  const { space } = useSpace();
  const spaceId = space?.id;
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const text = useThemeColor({}, 'text');
  const border = useThemeColor({}, 'border');
  const surface2 = useThemeColor({}, 'surface2');

  const wordCount = value.trim() === '' ? 0 : value.trim().split(/\s+/).length;

  const restore = useCallback(async () => {
    if (!spaceId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await recoverProtocolArchive({ spaceId, phrase: value });
      if (result.status === 'ready') {
        router.replace('/(app)/(tabs)/(memories)');
        return;
      }
      setError(
        result.reason === 'invalid-phrase'
          ? 'That is not a valid recovery phrase. Check it and try again.'
          : 'This album could not be restored with that phrase.'
      );
    } catch {
      setError('Could not reach the shared album. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }, [router, spaceId, value]);

  return (
    <View style={styles.page}>
      <Stack.Screen options={{ title: 'Restore album' }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ThemedText type="subheading">Enter your recovery phrase</ThemedText>
        <ThemedText type="body" style={styles.muted}>
          The {RECOVERY_WORDS} words from the phone that created this album. Separate
          them with spaces.
        </ThemedText>
        <TextInput
          accessibilityLabel="Recovery phrase"
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          numberOfLines={4}
          onChangeText={setValue}
          placeholder="word one word two …"
          placeholderTextColor={text}
          style={[styles.input, { borderColor: border, backgroundColor: surface2, color: text }]}
          value={value}
        />
        <ThemedText type="caption" style={styles.muted}>
          {`${wordCount} of ${RECOVERY_WORDS} words`}
        </ThemedText>
        {error ? (
          <ThemedText type="body" accessibilityRole="alert" style={styles.error}>
            {error}
          </ThemedText>
        ) : null}
        <Button
          label="Restore this album"
          disabled={busy || wordCount !== RECOVERY_WORDS}
          onPress={() => void restore()}
        />
        <Button label="Back" variant="secondary" onPress={() => router.back()} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { gap: Spacing[12], padding: Spacing[24] },
  muted: { opacity: 0.7 },
  error: { color: '#b3261e' },
  input: {
    borderRadius: Spacing[8],
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 96,
    padding: Spacing[12],
    textAlignVertical: 'top',
  },
});
