import { useIsFocused, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ProviderAuthActions } from '@/components/auth/provider-auth-actions';
import { ImmersiveHero } from '@/components/landing/immersive-hero';
import { MidnightBackdrop } from '@/components/landing/midnight-backdrop';
import { ThemedText } from '@/components/themed-text';
import { LANDING_ERROR, landingThemeForColorScheme } from '@/constants/landing-theme';
import { Spacing } from '@/constants/theme';
import { getLegalLinks } from '@/features/legal/legal-links';
import { useAoiTheme } from '@/features/theme/theme-context';

const MEASURE_MAX_WIDTH = 480;

/**
 * Get started.
 *
 * Two changes from how it was. The palette is read from the app's dark
 * tokens rather than a set of literals copied out of the backdrop art, so
 * the screen a reader meets first is in the same family as the app they are
 * about to open. And everything else comes from the shared system: the type
 * scale, the spacing rhythm, the reveal timing, and ThemedText for the
 * heading role rather than a hand-set accessibilityRole.
 *
 * It is dark in both system schemes on purpose. The backdrop is a night
 * window; making the page follow a light theme would mean light ink on a
 * dark photograph, and the scrim that prevents that is the reason the
 * landing is legible at all.
 */
export default function LandingScreen() {
  const router = useRouter();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { selectedTheme } = useAoiTheme();
  const theme = useMemo(
    () => landingThemeForColorScheme(selectedTheme.dark),
    [selectedTheme],
  );
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

  const legalLink = useCallback(
    (label: string, url?: string | null) => (
      <ThemedText
        accessibilityLabel={`${label}, opens in your browser`}
        accessibilityRole="link"
        onPress={url ? () => void openUrl(url) : undefined}
        type="link"
        style={styles.legalLink}
      >
        {label}
      </ThemedText>
    ),
    [openUrl],
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <StatusBar style="light" />
      <MidnightBackdrop focused={focused} />
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + Spacing[24],
            paddingBottom: insets.bottom + Spacing[24],
          },
        ]}
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        style={styles.scroll}
      >
        <View style={styles.content}>
          <ImmersiveHero
            theme={theme}
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
              <ThemedText type="caption" style={{ color: theme.subtle }}>
                {'By continuing, you agree to our '}
                {legalLink('Privacy Policy', legal.privacyUrl)}
                {' and '}
                {legalLink('Terms of Service', legal.termsUrl)}
                {'.'}
              </ThemedText>
            }
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  content: {
    alignSelf: 'center',
    flex: 1,
    flexGrow: 1,
    maxWidth: MEASURE_MAX_WIDTH,
    paddingHorizontal: Spacing[24],
    width: '100%',
  },
  // The type scale already underlines a link, so saying so again is the
  // system being overridden by a screen.
  legalLink: {
    fontSize: 13,
  },
});
