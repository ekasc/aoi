import { Link } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ImmersiveHero } from '@/components/landing/immersive-hero';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';

export default function LandingScreen() {
  const background = useThemeColor({}, 'background');
  const insets = useSafeAreaInsets();
  const contentContainerStyle = useMemo(
    () => [
      styles.contentContainer,
      {
        paddingTop: insets.top + Spacing[12],
        paddingBottom: insets.bottom + Spacing[24],
      },
    ],
    [insets.bottom, insets.top]
  );

  return (
    <ScrollView
      style={{ backgroundColor: background }}
      contentContainerStyle={contentContainerStyle}
      contentInsetAdjustmentBehavior='never'
      showsVerticalScrollIndicator={false}
    >
      <ImmersiveHero
        cta={
          <Link href='/(auth)/sign-in' asChild>
            <Button label='Get started' accessibilityLabel='Get started with Aoi' />
          </Link>
        }
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  contentContainer: {
    paddingHorizontal: Spacing[16],
  },
});
