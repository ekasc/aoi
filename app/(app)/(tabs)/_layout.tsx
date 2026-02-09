import { Icon, Label, NativeTabs } from 'expo-router/unstable-native-tabs';

import { FontFamilies } from '@/constants/typography';
import { useAoiTheme } from '@/features/theme/theme-context';

export default function TabsLayout() {
  const { colors, mode, selectedThemeId } = useAoiTheme();
  const isIos = process.env.EXPO_OS === 'ios';
  const blurEffect = isIos
    ? mode === 'dark'
      ? 'systemMaterialDark'
      : 'systemMaterialLight'
    : undefined;

  return (
    <NativeTabs
      key={`${selectedThemeId}-${mode}`}
      backgroundColor={colors.surface}
      blurEffect={blurEffect}
      disableTransparentOnScrollEdge={isIos}
      iconColor={{ default: colors.muted, selected: colors.accent }}
      labelStyle={{
        default: {
          color: colors.muted,
          fontFamily: FontFamilies.body,
          fontSize: 11,
          fontWeight: '500',
        },
        selected: {
          color: colors.accent,
          fontFamily: FontFamilies.body,
          fontSize: 11,
          fontWeight: '600',
        },
      }}
      shadowColor={colors.border}
      tintColor={colors.accent}
    >
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: 'clock', selected: 'clock.fill' }} />
        <Label>Timeline</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="calendar">
        <Icon sf={{ default: 'calendar', selected: 'calendar.circle.fill' }} />
        <Label>Calendar</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="settings">
        <Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} />
        <Label>Settings</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
