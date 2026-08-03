import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';

export type TombstoneMarkerProps = {
  actorName: string;
};

/**
 * A quiet, non-interactive rail marker proving a moment existed and was
 * removed — honesty without drama. Never carries moment content.
 */
function TombstoneMarkerComponent({ actorName }: TombstoneMarkerProps) {
  const muted = useThemeColor({}, 'muted');

  return (
    <View
      accessibilityLabel={`${actorName} removed a moment`}
      style={styles.row}
    >
      <ThemedText type="meta" style={{ color: muted }}>
        {actorName} removed a moment
      </ThemedText>
    </View>
  );
}

export const TombstoneMarker = memo(TombstoneMarkerComponent);

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing[4],
  },
});
