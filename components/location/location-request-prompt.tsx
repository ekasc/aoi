import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ReduceMotion } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Motion, Spacing } from '@/constants/theme';
import { useLocation } from '@/features/location/location-context';
import { useSpace } from '@/features/space/space-context';
import { useThemeColor } from '@/hooks/use-theme-color';

/**
 * The gentle approval prompt for an incoming location request. One tap to
 * share once, one tap to let it pass — no guilt copy, no confirmation
 * dialogs. Mounted once in the authenticated layout; invisible while no
 * request is pending.
 */
export function LocationRequestPrompt() {
  const { hasPendingRequest, isGranting, approveRequest, dismissRequest } =
    useLocation();
  const { space } = useSpace();
  const muted = useThemeColor({}, 'muted');
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');

  if (!hasPendingRequest && !isGranting) {
    return null;
  }

  const partnerName = space?.partnerName ?? 'Your partner';

  return (
    <Animated.View
      entering={FadeIn.duration(Motion.slow).reduceMotion(ReduceMotion.System)}
      exiting={FadeOut.duration(Motion.slow).reduceMotion(ReduceMotion.System)}
      pointerEvents="box-none"
      style={styles.wrapper}
    >
      <View style={[styles.card, { backgroundColor: surface, borderColor: border }]}>
        <ThemedText type="body">
          {partnerName} is asking where you are.
        </ThemedText>
        <ThemedText type="caption" style={{ color: muted }}>
          One tap to share once — or just let it pass.
        </ThemedText>
        <View style={styles.actions}>
          <Button
            accessibilityLabel="Share your location once"
            disabled={isGranting}
            label={isGranting ? 'Sharing…' : 'Share once'}
            onPress={() => void approveRequest()}
          />
          <Button
            accessibilityLabel="Do not share your location"
            disabled={isGranting}
            label="Not now"
            onPress={dismissRequest}
            variant="ghost"
          />
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    bottom: Spacing[24],
    left: Spacing[16],
    position: 'absolute',
    right: Spacing[16],
  },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing[8],
    padding: Spacing[16],
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing[8],
    marginTop: Spacing[4],
  },
});
