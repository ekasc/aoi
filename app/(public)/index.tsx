import { useIsFocused, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo } from 'react';
import {
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ProviderAuthActions } from '@/components/auth/provider-auth-actions';
import { ImmersiveHero } from '@/components/landing/immersive-hero';
import { MidnightBackdrop } from '@/components/landing/midnight-backdrop';
import { LANDING_ERROR, landingThemeForColorScheme } from '@/constants/landing-theme';
import { getLegalLinks } from '@/features/legal/legal-links';

export default function LandingScreen() {
  const router = useRouter();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const theme = landingThemeForColorScheme('dark');
  const legal = useMemo(() => getLegalLinks(), []);

  const openUrl = useCallback(async (url: string) => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      }
    } catch {
      // Legal links are best-effort on landing; never block sign-in.
    }
  }, []);

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
            paddingBottom: insets.bottom + 24,
          },
        ]}
      >
        <View style={styles.content}>
          <ImmersiveHero
            cta={
              <ProviderAuthActions
                showHelper={false}
                appearance={{
                  colorScheme: 'dark',
                  helperColor: theme.subtle,
                  googleBorderColor: theme.border,
                  errorColor: LANDING_ERROR,
                }}
                onSuccess={() => router.replace('/')}
              />
            }
            legal={
              <Text style={[styles.legal, { color: theme.subtle }]}>
                <Text>By continuing, you agree to our </Text>
                {legal.privacyUrl ? (
                  <Text
                    accessibilityRole="link"
                    onPress={() =>
                      void openUrl(legal.privacyUrl as string)
                    }
                    style={styles.legalLink}
                  >
                    Privacy Policy
                  </Text>
                ) : (
                  <Text style={styles.legalLink}>Privacy Policy</Text>
                )}
                <Text>{'\n'}and </Text>
                {legal.termsUrl ? (
                  <Text
                    accessibilityRole="link"
                    onPress={() => void openUrl(legal.termsUrl as string)}
                    style={styles.legalLink}
                  >
                    Terms of Service
                  </Text>
                ) : (
                  <Text style={styles.legalLink}>Terms of Service</Text>
                )}
                <Text>.</Text>
              </Text>
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
  legal: {
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'left',
  },
  legalLink: {
    textDecorationLine: 'underline',
  },
});
