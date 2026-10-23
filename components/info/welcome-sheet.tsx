import { Ionicons } from '@expo/vector-icons';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { NativeSheet } from '@/components/ui/native-sheet';
import { Radii, Spacing, withAlpha } from '@/constants/theme';
import {
  TOUR_FEATURES,
  TOUR_FOOTER,
  TOUR_LEAD,
  TOUR_TITLE,
} from '@/features/info/welcome-tour';
import { useThemeColor } from '@/hooks/use-theme-color';

export type WelcomeSheetProps = {
  visible: boolean;
  onClose: () => void;
  onStart?: () => void;
};

/**
 * The help map, opened on request from Account.
 *
 * Nothing here is a screen of its own and nothing asks a question. It is
 * dismissed in one press, and the app underneath is already the explanation:
 * no automatic tour, no instructions for a control that is not on this screen.
 */
export function WelcomeSheet({ visible, onClose, onStart }: WelcomeSheetProps) {
  const secondary = useThemeColor({}, 'textSecondary');
  const accent = useThemeColor({}, 'accent');
  const accentInk = useThemeColor({}, 'accentInk');

  return (
    <NativeSheet onClose={onClose} visible={visible}>
      <ScrollView
        accessibilityLabel={TOUR_TITLE}
        accessibilityViewIsModal
        aria-modal
        contentContainerStyle={styles.content}
        role="dialog"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.head}>
          <ThemedText type="title">{TOUR_TITLE}</ThemedText>
          <ThemedText type="caption" style={{ color: secondary }}>
            {TOUR_LEAD}
          </ThemedText>
        </View>

        <View style={styles.rows}>
          {TOUR_FEATURES.map((feature) => (
            <View key={feature.id} style={styles.row}>
              <View
                accessible={false}
                style={[styles.glyph, { backgroundColor: withAlpha(accent, 0.12) }]}
              >
                <Ionicons
                  accessible={false}
                  color={accentInk}
                  name={feature.icon}
                  size={18}
                />
              </View>
              <View style={styles.rowText}>
                <ThemedText type="bodyEmphasis">{feature.title}</ThemedText>
                <ThemedText type="caption" style={{ color: secondary }}>
                  {feature.line}
                </ThemedText>
              </View>
            </View>
          ))}
        </View>

        <ThemedText type="caption" style={{ color: secondary }}>
          {TOUR_FOOTER}
        </ThemedText>

        {onStart ? <Button label="Go to Memories" onPress={onStart} /> : null}
        <Button label="Keep exploring" variant="ghost" onPress={onClose} />
      </ScrollView>
    </NativeSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing[24],
    paddingBottom: Spacing[24],
    paddingHorizontal: Spacing[24],
    paddingTop: Spacing[16],
  },
  glyph: {
    alignItems: 'center',
    borderRadius: Radii.pill,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  head: {
    gap: Spacing[4],
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing[12],
  },
  rows: {
    gap: Spacing[16],
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
});
