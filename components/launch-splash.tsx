import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAoiTheme } from '@/features/theme/theme-context';

/**
 * Launch splash: brand mark + wordmark on the paper background. Static —
 * no animation dependency for first paint, no scenes, no variants. The
 * ring-and-dot mark echoes the app icon and the sealed-letter motif: one
 * product language, no illustration.
 */
export function LaunchSplash() {
  const { colors } = useAoiTheme();
  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={styles.mark} accessible={false}>
        <View style={[styles.ring, { borderColor: colors.primary }]}>
          <View style={[styles.dot, { backgroundColor: colors.accent }]} />
        </View>
      </View>
      <ThemedText type="display" style={styles.wordmark}>
        Aoi
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[16],
  },
  mark: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  wordmark: {
    letterSpacing: 0.5,
  },
});
