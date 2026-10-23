import Ionicons from '@expo/vector-icons/Ionicons';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { StyleSheet, View } from 'react-native';

import { FontFamilies } from '@/constants/typography';
import { useAoiTheme } from '@/features/theme/theme-context';
import { useSkyEntry } from '@/components/home/sky-entry-provider';

// System tab bar (iOS 26 liquid glass, Android Material 3) with the app's
// envelope/paper iconography. SF Symbols on iOS with filled selected
// states; the same Ionicons outline/filled pair as the old bar on Android
// via src VectorIcons. Labels stay 12pt semibold body.
export default function TabsLayout() {
  const { colors } = useAoiTheme();
  const { entry } = useSkyEntry();

  return (
    <View style={styles.root}>
      <NativeTabs
      hidden={entry !== null && entry.kind !== 'fading'}
      tintColor={colors.accent}
      // Pinned. iOS 26 can minimize the bar on scroll, but every minimize
      // and expand resizes the content area (and the safe-area insets every
      // tab pads against), so scrolling — and switching tabs mid-scroll —
      // visibly jumps the content. Stability wins over the extra room.
      minimizeBehavior="never"
      labelStyle={{
        fontFamily: FontFamilies.body,
        fontSize: 12,
        fontWeight: '600',
      }}
    >
      <NativeTabs.Trigger name="(memories)" contentStyle={{ backgroundColor: colors.background }}>
        <NativeTabs.Trigger.Label>Memories</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'book', selected: 'book.fill' }}
          src={{
            default: (
              <NativeTabs.Trigger.VectorIcon
                family={Ionicons}
                name="book-outline"
              />
            ),
            selected: (
              <NativeTabs.Trigger.VectorIcon family={Ionicons} name="book" />
            ),
          }}
        />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="together" contentStyle={{ backgroundColor: colors.background }}>
        <NativeTabs.Trigger.Label>Us</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'sparkles', selected: 'sparkles' }}
          src={{
            default: (
              <NativeTabs.Trigger.VectorIcon
                family={Ionicons}
                name="sparkles-outline"
              />
            ),
            selected: (
              <NativeTabs.Trigger.VectorIcon family={Ionicons} name="sparkles" />
            ),
          }}
        />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="plans" contentStyle={{ backgroundColor: colors.background }}>
        <NativeTabs.Trigger.Label>Plans</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'calendar', selected: 'calendar.circle.fill' }}
          src={{
            default: (
              <NativeTabs.Trigger.VectorIcon
                family={Ionicons}
                name="calendar-outline"
              />
            ),
            selected: (
              <NativeTabs.Trigger.VectorIcon
                family={Ionicons}
                name="calendar"
              />
            ),
          }}
        />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="ours" contentStyle={{ backgroundColor: colors.background }}>
        <NativeTabs.Trigger.Label>Lists</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'square.grid.2x2', selected: 'square.grid.2x2.fill' }}
          src={{
            default: (
              <NativeTabs.Trigger.VectorIcon
                family={Ionicons}
                name="grid-outline"
              />
            ),
            selected: (
              <NativeTabs.Trigger.VectorIcon family={Ionicons} name="grid" />
            ),
          }}
        />
      </NativeTabs.Trigger>
      {/*
        The "photos of us" probe tab is gone. It was the only importer of
        features/album, and that module is written against Node: it needs
        `crypto.getRandomValues` and `Buffer`, neither of which React Native
        has. Its tests pass because vitest runs in Node, so nothing caught it
        until the route was the one the app restored into on launch, where it
        took down the whole tree from a useState initializer.

        features/album is untouched and still on disk. Bringing it back means
        porting it to RN first, not un-deleting this.
      */}
    </NativeTabs>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
