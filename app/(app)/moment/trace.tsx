import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useThemeColor } from '@/hooks/use-theme-color';

/**
 * Legacy capture compat: old deep links (Story sheet, Us returnTo=us,
 * Photos empty) land here with ?capture=photo|note|voice. Forward to the
 * universal Memories inline composer preserving the intended capture but
 * never auto-saving — the user still taps Keep it. The old direct
 * upload path (ImagePicker + addMoment here) is removed; capture stages
 * through the durable composer only.
 *
 * returnTo=us is intentionally ignored: Memories is the universal final
 * destination (approved).
 */
function captureToCompose(capture: string | string[] | undefined): string {
  const kind = Array.isArray(capture) ? capture[0] : capture;
  if (kind === 'photo') return 'photos';
  if (kind === 'voice') return 'voice';
  return 'note';
}

export default function TraceCompatScreen() {
  const router = useRouter();
  const { capture } = useLocalSearchParams<{ capture?: string | string[]; returnTo?: string | string[] }>();
  const muted = useThemeColor({}, 'muted');
  const background = useThemeColor({}, 'background');

  useEffect(() => {
    const compose = captureToCompose(capture);
    router.replace({
      pathname: '/(app)/(tabs)/(memories)' as const,
      params: { compose },
    });
  }, [capture, router]);

  return (
    <View style={[styles.root, { backgroundColor: background }]}>
      <Stack.Screen options={{ title: 'Keep this' }} />
      <ThemedText type="caption" style={{ color: muted }}>
        Opening Memories…
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
