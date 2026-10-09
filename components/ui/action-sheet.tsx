import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { NativeSheet } from '@/components/ui/native-sheet';
import { Spacing, withAlpha } from '@/constants/theme';
import { haptics } from '@/features/haptics/haptics';
import { useThemeColor } from '@/hooks/use-theme-color';

export type ActionSheetAction = {
  label: string;
  onPress: () => void;
  variant?: 'default' | 'destructive';
  /** Optional leading glyph, e.g. a trash for a destructive action. */
  icon?: ComponentProps<typeof Ionicons>['name'];
};

export type ActionSheetProps = {
  visible: boolean;
  title?: string;
  description?: string;
  actions: ActionSheetAction[];
  onClose: () => void;
  busy?: boolean;
  error?: string;
};

const NO_ACTIONS: ActionSheetAction[] = [];

/**
 * Action sheet on the platform's native sheet: the OS provides the present /
 * dismiss spring, translucent material, backdrop dim, grabber, and drag.
 * We supply the content — a title/description header and hairline-separated
 * rows, with a trailing non-destructive action split into its own cancel row.
 */
export function ActionSheet({
  visible,
  title,
  description,
  actions,
  onClose,
  busy = false,
  error,
}: ActionSheetProps) {
  const { height } = useWindowDimensions();
  const border = useThemeColor({}, 'border');
  const muted = useThemeColor({}, 'muted');
  const danger = useThemeColor({}, 'danger');
  const text = useThemeColor({}, 'text');

  const { mainActions, cancelAction } = useMemo(() => {
    const safeActions = actions ?? NO_ACTIONS;
    const last = safeActions[safeActions.length - 1];
    const hasCancel = safeActions.length > 1 && last.variant !== 'destructive';
    return {
      mainActions: hasCancel ? safeActions.slice(0, -1) : safeActions,
      cancelAction: hasCancel ? last : null,
    };
  }, [actions]);

  return (
    <NativeSheet dismissible={!busy} onClose={onClose} visible={visible}>
      <ScrollView
        accessibilityViewIsModal
        accessibilityLabel={title ?? 'Actions'}
        role="dialog"
        aria-modal
        contentContainerStyle={styles.content}
        style={{ maxHeight: height * 0.8 }}
      >
        {title || description || error ? (
          <View style={[styles.header, { borderColor: border }]}>
            {title ? <ThemedText type="title">{title}</ThemedText> : null}
            {description ? (
              <ThemedText
                type="caption"
                style={[styles.description, { color: withAlpha(text, 0.72) }]}
              >
                {description}
              </ThemedText>
            ) : null}
            {error ? <ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>{error}</ThemedText> : null}
          </View>
        ) : null}

        {mainActions.map((action, index) => {
          const tint = action.variant === 'destructive' ? danger : text;
          return (
            <Pressable
              accessibilityLabel={action.label}
              accessibilityRole="button"
              accessibilityState={{ disabled: busy, busy }}
              disabled={busy}
              key={action.label}
              onPress={() => {
                if (busy) return;
                haptics.select();
                action.onPress();
              }}
              style={({ pressed }) => [
                styles.row,
                index > 0
                  ? { borderTopWidth: StyleSheet.hairlineWidth, borderColor: border }
                  : null,
                pressed ? { backgroundColor: withAlpha(muted, 0.14) } : null,
              ]}
            >
              {action.icon ? (
                <Ionicons color={tint} name={action.icon} size={20} />
              ) : (
                <View style={styles.iconSpacer} />
              )}
              <ThemedText type="bodyEmphasis" style={{ color: tint }}>
                {action.label}
              </ThemedText>
            </Pressable>
          );
        })}

        {cancelAction ? (
          <Pressable
            accessibilityLabel={cancelAction.label}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={() => {
              if (busy) return;
              haptics.select();
              cancelAction.onPress();
            }}
            style={({ pressed }) => [
              styles.row,
              styles.cancelRow,
              { borderTopWidth: StyleSheet.hairlineWidth, borderColor: border },
              pressed ? { backgroundColor: withAlpha(muted, 0.14) } : null,
            ]}
          >
            {cancelAction.icon ? (
              <Ionicons color={text} name={cancelAction.icon} size={20} />
            ) : (
              <View style={styles.iconSpacer} />
            )}
            <ThemedText type="bodyEmphasis" style={{ color: text }}>
              {cancelAction.label}
            </ThemedText>
          </Pressable>
        ) : null}
      </ScrollView>
    </NativeSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: Spacing[8],
  },
  header: {
    paddingHorizontal: Spacing[16],
    paddingTop: Spacing[12],
    paddingBottom: Spacing[16],
    gap: Spacing[8],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  description: {
    lineHeight: 20,
  },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[12],
    paddingHorizontal: Spacing[16],
  },
  cancelRow: {
    marginTop: Spacing[8],
  },
  iconSpacer: {
    width: 20,
  },
});
