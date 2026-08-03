import { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { Motion, Spacing } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';

export type ActionSheetAction = {
  label: string;
  onPress: () => void;
  variant?: 'default' | 'destructive';
};

export type ActionSheetProps = {
  visible: boolean;
  title?: string;
  description?: string;
  actions: ActionSheetAction[];
  onClose: () => void;
};

/**
 * A quiet bottom sheet for moment actions and confirmations. Built from the
 * Modal primitive so it works on both platforms without extra dependencies.
 */
export function ActionSheet({
  visible,
  title,
  description,
  actions,
  onClose,
}: ActionSheetProps) {
  const insets = useSafeAreaInsets();
  const shadow = useThemeColor({}, 'shadow');
  const background = useThemeColor({}, 'background');
  const muted = useThemeColor({}, 'muted');

  const sheetStyle = useMemo(
    () => [
      styles.sheet,
      { marginBottom: insets.bottom + Spacing[12], backgroundColor: background },
    ],
    [background, insets.bottom]
  );

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View style={[styles.root, { backgroundColor: shadow }]}>
        <Pressable
          accessibilityLabel="Dismiss sheet"
          accessibilityRole="button"
          onPress={onClose}
          style={styles.backdrop}
        />
        {/* Blocks taps on the sheet itself from dismissing it. */}
        <Pressable style={styles.sheetAnchor}>
          <Animated.View
            entering={FadeIn.duration(Motion.base).reduceMotion(ReduceMotion.System)}
            style={styles.animatedWrap}
          >
            <Surface style={sheetStyle} variant="raised">
              {title ? <ThemedText type="title">{title}</ThemedText> : null}
              {description ? (
                <ThemedText type="caption" style={[styles.description, { color: muted }]}>
                  {description}
                </ThemedText>
              ) : null}
              <View style={styles.actions}>
                {actions.map((action) => (
                  <Button
                    key={action.label}
                    label={action.label}
                    onPress={action.onPress}
                    variant={action.variant === 'destructive' ? 'destructive' : 'secondary'}
                  />
                ))}
              </View>
            </Surface>
          </Animated.View>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheetAnchor: {
    paddingHorizontal: Spacing[16],
  },
  animatedWrap: {
    width: '100%',
  },
  sheet: {
    gap: Spacing[8],
  },
  description: {
    lineHeight: 20,
  },
  actions: {
    gap: Spacing[8],
    marginTop: Spacing[4],
  },
});
