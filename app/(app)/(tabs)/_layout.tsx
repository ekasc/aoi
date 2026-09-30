import Ionicons from '@expo/vector-icons/Ionicons';
import { NativeTabs } from 'expo-router/unstable-native-tabs';

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
    <NativeTabs
      hidden={entry !== null && entry.kind !== 'fading'}
      tintColor={colors.accent}
      // iOS 26 liquid-glass behavior: the bar minimizes as you scroll down
      // and comes back when you scroll up, keeping focus on content.
      minimizeBehavior="onScrollDown"
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
          sf={{ default: 'envelope', selected: 'envelope.fill' }}
          src={{
            default: (
              <NativeTabs.Trigger.VectorIcon
                family={Ionicons}
                name="mail-outline"
              />
            ),
            selected: (
              <NativeTabs.Trigger.VectorIcon family={Ionicons} name="mail" />
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
      <NativeTabs.Trigger name="space" contentStyle={{ backgroundColor: colors.background }}>
        <NativeTabs.Trigger.Label>Space</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'person', selected: 'person.fill' }}
          src={{
            default: (
              <NativeTabs.Trigger.VectorIcon
                family={Ionicons}
                name="person-outline"
              />
            ),
            selected: (
              <NativeTabs.Trigger.VectorIcon family={Ionicons} name="person" />
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
  );
}
