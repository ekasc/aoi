import { Tabs } from 'expo-router/js-tabs';
import { View } from 'react-native';

import { AoiTabBar } from '@/components/navigation/aoi-tab-bar';
import { useAoiTheme } from '@/features/theme/theme-context';

/**
 * Android's tab bar.
 *
 * iOS keeps the system bar (`_layout.tsx` uses NativeTabs): UITabBar with
 * liquid glass is better than anything hand-drawn, and it is free. Material's
 * bar is not: a flat slab, a solid accent pill, and one visible label. So on
 * Android the navigator stays JS tabs and the bar is the app's own glass
 * capsule — the same four places, drawn in the app's language.
 */
export default function TabsLayout() {
  const { colors } = useAoiTheme();

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Tabs
        backBehavior="history"
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: colors.background },
          // The bar floats over the content so the glass has something behind
          // it; screens pad for it through the shared geometry helpers.
          tabBarStyle: {
            backgroundColor: 'transparent',
            borderTopWidth: 0,
            elevation: 0,
            position: 'absolute',
          },
        }}
        tabBar={(props) => <AoiTabBar {...props} />}
      >
        <Tabs.Screen name="(memories)" options={{ title: 'Memories' }} />
        <Tabs.Screen name="together" options={{ title: 'Us' }} />
        <Tabs.Screen name="plans" options={{ title: 'Plans' }} />
        <Tabs.Screen name="ours" options={{ title: 'Lists' }} />
      </Tabs>
    </View>
  );
}
