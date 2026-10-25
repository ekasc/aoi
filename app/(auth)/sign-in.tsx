import { useIsFocused } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ProviderAuthActions } from '@/components/auth/provider-auth-actions';
import { ImmersiveHero } from '@/components/landing/immersive-hero';
import { MidnightBackdrop } from '@/components/landing/midnight-backdrop';
import { LANDING_ERROR, landingThemeForColorScheme } from '@/constants/landing-theme';
import { useAoiTheme } from '@/features/theme/theme-context';

export default function SignInScreen() {
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { selectedTheme } = useAoiTheme();
  const theme = useMemo(
    () => landingThemeForColorScheme(selectedTheme.dark),
    [selectedTheme],
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <StatusBar style="light" />
      <MidnightBackdrop focused={focused} />
      <View
        style={[
          styles.content,
          {
            paddingTop: 24,
            paddingBottom: insets.bottom + 32,
          },
        ]}
      >
        <ImmersiveHero
          theme={theme}
          variant="signin"
          cta={
            <ProviderAuthActions
              appearance={{
                colorScheme: 'dark',
                helperColor: theme.subtle,
                googleBorderColor: theme.border,
                errorColor: LANDING_ERROR,
              }}
            />
          }
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
});
