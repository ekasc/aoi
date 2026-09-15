import { useIsFocused, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ProviderAuthActions } from '@/components/auth/provider-auth-actions';
import { ImmersiveHero } from '@/components/landing/immersive-hero';
import { MidnightBackdrop } from '@/components/landing/midnight-backdrop';
import { LANDING_ERROR, landingThemeForColorScheme } from '@/constants/landing-theme';

export default function SignInScreen() {
  const router = useRouter();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const theme = landingThemeForColorScheme('dark');

  const handleContinue = useCallback(() => {
    router.replace('/');
  }, [router]);

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <StatusBar style="light" />
      <MidnightBackdrop focused={focused} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + 24,
            paddingBottom: insets.bottom + 32,
          },
        ]}
      >
        <View style={styles.content}>
          <ImmersiveHero
            variant="signin"
            cta={
              <ProviderAuthActions
                appearance={{
                  colorScheme: 'dark',
                  helperColor: theme.subtle,
                  googleBorderColor: theme.border,
                  errorColor: LANDING_ERROR,
                }}
                onSuccess={handleContinue}
              />
            }
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    flex: 1,
    flexGrow: 1,
    paddingHorizontal: 24,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
});
