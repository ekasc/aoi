import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';

/**
 * The first thing an empty archive says.
 *
 * It is a dedication rather than a prompt, because the person it is for is not
 * here yet and the alternative is a form. One primary action, per the usual
 * rule for an empty state; the escape is offered plainly rather than as a
 * floating caption, because a reader who is not ready is not refusing and
 * should not have to dismiss anything.
 */
export function FirstPageDedication({ partnerName, waiting, sinceLabel, onCompose, onSkip }: {
  partnerName: string;
  waiting: boolean;
  /**
   * How long this space has existed, when the space was dated. The sky already
   * knows this; putting it here is what stops the header being wallpaper.
   */
  sinceLabel: string | null;
  onCompose: () => void;
  onSkip: () => void;
}) {
  const muted = useThemeColor({}, 'muted');
  return (
    <View style={styles.page} testID="first-page-dedication">
      <ThemedText type="caption" style={[styles.copy, { color: muted }]}>No memories yet</ThemedText>
      <ThemedText type="display" style={styles.heading}>For {partnerName}.</ThemedText>
      {sinceLabel ? (
        <ThemedText type="caption" style={[styles.copy, { color: muted }]}>{sinceLabel}</ThemedText>
      ) : null}
      <View style={styles.invitation}>
        <ThemedText type="body" textBreakStrategy="balanced" lineBreakStrategyIOS="standard"
          style={[styles.copy, { color: muted }]}>
          Leave a photo, a few words, or your voice.
        </ThemedText>
        <ThemedText type="supporting" textBreakStrategy="balanced" lineBreakStrategyIOS="standard"
          style={[styles.copy, { color: muted }]}>
          {waiting ? 'Something to find when they arrive.' : 'A little something to begin with.'}
        </ThemedText>
      </View>
      <View style={styles.actions}>
        <Button label="Leave something" onPress={onCompose} />
        <Button label="Not now" size="sm" variant="ghost" onPress={onSkip} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: Spacing[16], alignItems: 'center', maxWidth: 360, width: '100%', alignSelf: 'center' },
  copy: { textAlign: 'center', alignSelf: 'stretch' },
  invitation: { gap: Spacing[8], maxWidth: 260, width: '100%', alignItems: 'center' },
  heading: { textAlign: 'center', alignSelf: 'stretch' },
  actions: { gap: Spacing[4], marginTop: Spacing[12], alignItems: 'center' },
});
