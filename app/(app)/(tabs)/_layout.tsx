import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { Icon, Label, NativeTabs } from 'expo-router/unstable-native-tabs';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FontFamilies } from '@/constants/typography';
import { useAoiTheme } from '@/features/theme/theme-context';

export default function TabsLayout() {
  const { colors, mode } = useAoiTheme();
  const insets = useSafeAreaInsets();
  const isIos = process.env.EXPO_OS === 'ios';
  const blurEffect = isIos
    ? mode === 'dark'
      ? 'systemMaterialDark'
      : 'systemMaterialLight'
    : undefined;

  if (!isIos) {
    return (
      <Tabs
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: colors.background },
          tabBarHideOnKeyboard: true,
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.muted,
          tabBarLabelStyle: {
            fontFamily: FontFamilies.body,
            fontSize: 12,
            fontWeight: '600',
          },
          tabBarStyle: [
            styles.androidTabBar,
            {
              backgroundColor: colors.surface,
              borderTopColor: colors.border,
              height: 60 + Math.max(insets.bottom, 8),
              paddingBottom: Math.max(insets.bottom, 8),
            },
          ],
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Timeline',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons
                color={color}
                name={focused ? 'time' : 'time-outline'}
                size={size}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="calendar"
          options={{
            title: 'Calendar',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons
                color={color}
                name={focused ? 'calendar' : 'calendar-outline'}
                size={size}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons
                color={color}
                name={focused ? 'person-circle' : 'person-circle-outline'}
                size={size}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: 'Settings',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons
                color={color}
                name={focused ? 'settings' : 'settings-outline'}
                size={size}
              />
            ),
          }}
        />
      </Tabs>
    );
  }

  return (
    <NativeTabs
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

      <NativeTabs.Trigger name="profile">
        <Icon sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }} />
        <Label>Profile</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="settings">
        <Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} />
        <Label>Settings</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

const styles = StyleSheet.create({
  androidTabBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
});
