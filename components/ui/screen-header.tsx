import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { IconButton } from '@/components/ui/icon-button';
import { SpaceAvatarButton } from '@/components/space/space-avatar-button';
import { Spacing } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';

export type ScreenHeaderAction = {
  label: string;
  icon: ReactNode;
  onPress: () => void;
};

export type ScreenHeaderProps = {
  title: string;
  subtitle?: string;
  primaryAction?: ScreenHeaderAction;
  showAvatar?: boolean;
  leading?: ReactNode;
  /** Pinned archive menu (Memories only): chevron + 44pt title tap. */
  onTitlePress?: () => void;
  /**
   * Foreground tone. `onDark` (default) renders the light chrome designed
   * for over-sky headers (Us, Plans). `onLight` renders theme text colors
   * for paper backgrounds with no sky behind the header (Memories feed).
   */
  tone?: 'onDark' | 'onLight';
};

export function ScreenHeader({ title, subtitle, primaryAction, showAvatar = true, leading, onTitlePress, tone = 'onDark' }: ScreenHeaderProps) {
  const chevronColor = useThemeColor({}, 'muted');
  // onLight inherits theme text colors; onDark keeps the fixed light chrome.
  const titleLight = tone === 'onLight' ? undefined : '#FFF8FA';
  const titleDark = tone === 'onLight' ? undefined : '#F6EDF3';
  return (
    <View style={styles.root}>
      <View style={styles.row}>
        <View style={styles.titleLeft}>
          {leading ? <View style={styles.leading}>{leading}</View> : null}
          {onTitlePress ? (
            <Pressable
              accessibilityHint="Open Timeline, Photos, or Chapters"
              accessibilityLabel={`${title}, open archive menu`}
              accessibilityRole="button"
              onPress={onTitlePress}
              style={styles.titlePress}
            >
              <View style={styles.titleBlock}>
                <ThemedText type="display" selectable lightColor={titleLight} darkColor={titleDark} style={styles.title}>
                  {title}
                </ThemedText>
              </View>
              <Ionicons color={chevronColor} name="chevron-down" size={18} />
            </Pressable>
          ) : (
            <View style={styles.titleBlock}>
              <ThemedText type="display" selectable lightColor={titleLight} darkColor={titleDark} style={styles.title}>
                {title}
              </ThemedText>
            </View>
          )}
        </View>
        <View style={styles.cluster}>
          {primaryAction ? (
            <IconButton label={primaryAction.label} onPress={primaryAction.onPress} variant="accent">
              {primaryAction.icon}
            </IconButton>
          ) : null}
          {showAvatar ? <SpaceAvatarButton /> : null}
        </View>
      </View>
      {subtitle ? (
        <ThemedText type="caption" numberOfLines={2} lightColor={titleLight} darkColor={titleDark}>
          {subtitle}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'relative',
    zIndex: 2,
    gap: Spacing[4],
    marginBottom: Spacing[4],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing[12],
  },
  titleLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    gap: Spacing[12],
  },
  leading: {
    flexShrink: 0,
    justifyContent: 'center',
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
  },
  titlePress: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    minHeight: 44,
    gap: Spacing[4],
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
  },
  cluster: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: Spacing[12],
  },
});
