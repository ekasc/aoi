import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';

import { Colors } from '@/constants/theme';
import { FontFamilies } from '@/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function TabsLayout() {
  const colorScheme = useColorScheme();
  const themeName = colorScheme === 'dark' ? 'dark' : 'light';

  return (
    <Tabs
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: {
          backgroundColor: Colors[themeName].surface,
        },
        headerTitleStyle: styles.headerTitle,
        headerTintColor: Colors[themeName].text,
        tabBarStyle: [
          styles.tabBar,
          {
            backgroundColor: Colors[themeName].surface,
            borderTopColor: Colors[themeName].border,
          },
        ],
        tabBarLabelStyle: styles.tabBarLabel,
        tabBarActiveTintColor: Colors[themeName].accent,
        tabBarInactiveTintColor: Colors[themeName].muted,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Timeline',
          tabBarLabel: 'Timeline',
        }}
      />
      <Tabs.Screen
        name="recaps"
        options={{
          title: 'Recaps',
          tabBarLabel: 'Recaps',
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarLabel: 'Settings',
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  headerTitle: {
    fontFamily: FontFamilies.display,
    fontSize: 27,
    letterSpacing: -0.3,
  },
  tabBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 6,
    height: 66,
  },
  tabBarLabel: {
    fontFamily: FontFamilies.body,
    fontSize: 12,
    letterSpacing: 0.15,
  },
});
