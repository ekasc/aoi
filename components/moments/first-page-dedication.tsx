import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';

export function FirstPageDedication({ partnerName, waiting, onCompose, onSkip }: {
  partnerName: string;
  waiting: boolean;
  onCompose: () => void;
  onSkip: () => void;
}) {
  const muted = useThemeColor({}, 'muted');
  const accent = useThemeColor({}, 'accent');
  return (
    <View style={styles.page} testID="first-page-dedication">
      <View accessible={false} style={[styles.authorMark, { backgroundColor: accent }]} />
      <ThemedText type="display">For {partnerName}.</ThemedText>
      <ThemedText type="body" style={{ color: muted }}>
        Leave a photo, a few words, or your voice.
        {waiting ? '\nSomething to find when they arrive.' : '\nA little something to begin with.'}
      </ThemedText>
      <View style={styles.actions}>
        <Button label="Leave something" onPress={onCompose} />
        <Button label="Not now" variant="ghost" onPress={onSkip} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: Spacing[16], paddingVertical: Spacing[24] },
  authorMark: { width: 24, height: 2, marginBottom: Spacing[8] },
  actions: { gap: Spacing[8], marginTop: Spacing[16], alignSelf: 'flex-start' },
});
