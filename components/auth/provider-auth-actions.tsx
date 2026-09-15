import { Ionicons } from '@expo/vector-icons';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useColorScheme,
  type PressableStateCallbackType,
  type ViewStyle,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import type { AuthProvider } from '@/features/auth/types';
import { useSession } from '@/features/session/session-context';
import { useThemeColor } from '@/hooks/use-theme-color';

const GOOGLE_G_MARK_URI =
  'https://developers.google.com/identity/images/g-logo.png';

export type ProviderAuthAppearance = {
  helperColor?: string;
  googleBorderColor?: string;
  colorScheme?: 'light' | 'dark';
  errorColor?: string;
};

type ProviderAuthActionsProps = {
  helperColor?: string;
  showHelper?: boolean;
  onSuccess?: () => void;
  appearance?: ProviderAuthAppearance;
};

export function ProviderAuthActions({
  helperColor,
  showHelper = true,
  onSuccess,
  appearance,
}: ProviderAuthActionsProps) {
  const { signInWithProvider, status } = useSession();
  const [activeProvider, setActiveProvider] = useState<AuthProvider | null>(
    null
  );
  const [error, setError] = useState('');
  const [isAppleNativeAvailable, setIsAppleNativeAvailable] = useState(false);
  const [hasGoogleIconError, setHasGoogleIconError] = useState(false);
  const colorScheme = useColorScheme();
  const forcedScheme = appearance?.colorScheme;
  const isDark = forcedScheme ? forcedScheme === 'dark' : colorScheme === 'dark';
  const isMidnight = forcedScheme === 'dark';
  const muted = useThemeColor({}, 'muted');
  const danger = useThemeColor({}, 'danger');
  const googleBorderColor =
    appearance?.googleBorderColor ?? (isMidnight ? '#554b54' : isDark ? '#4A443C' : '#E4D9C7');
  const resolvedHelperColor = appearance?.helperColor ?? helperColor ?? muted;
  const resolvedErrorColor = appearance?.errorColor ?? danger;

  useEffect(() => {
    let isActive = true;

    void AppleAuthentication.isAvailableAsync()
      .then((isAvailable) => {
        if (isActive) {
          setIsAppleNativeAvailable(isAvailable);
        }
      })
      .catch(() => {
        if (isActive) {
          setIsAppleNativeAvailable(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, []);

  const handleSignIn = useCallback(
    async (provider: AuthProvider) => {
      setError('');
      setActiveProvider(provider);

      const result = await signInWithProvider(provider);
      setActiveProvider(null);

      if (!result.ok) {
        setError(result.error ?? 'Unable to sign in right now.');
        return;
      }

      onSuccess?.();
    },
    [onSuccess, signInWithProvider]
  );

  const isLoading = status === 'loading' || activeProvider !== null;
  const helperText = useMemo(() => {
    if (error) {
      return error;
    }

    if (activeProvider === 'apple') {
      return 'Connecting to Apple…';
    }

    if (activeProvider === 'google') {
      return 'Connecting to Google…';
    }

    return 'Invite-only spaces. No public profiles.';
  }, [activeProvider, error]);

  const googleButtonStyle = useCallback(
    ({ pressed }: PressableStateCallbackType): (ViewStyle | null)[] => [
      styles.googleButton,
      { borderColor: googleBorderColor },
      isMidnight ? styles.googleButtonMidnight : null,
      pressed ? styles.pressed : styles.resting,
      isLoading ? styles.disabled : styles.resting,
    ],
    [isLoading, googleBorderColor, isMidnight]
  );

  const showHelperText = showHelper || error || activeProvider !== null;

  return (
    <View style={styles.root}>
      {isAppleNativeAvailable ? (
        <View style={isLoading ? styles.disabled : styles.resting}>
          <AppleAuthentication.AppleAuthenticationButton
            accessibilityLabel="Continue with Apple"
            buttonStyle={
              isDark
                ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
            }
            buttonType={
              AppleAuthentication.AppleAuthenticationButtonType.CONTINUE
            }
            cornerRadius={999}
            onPress={() => {
              if (isLoading) {
                return;
              }
              void handleSignIn('apple');
            }}
            style={styles.appleNativeButton}
          />
        </View>
      ) : (
        <Pressable
          accessibilityLabel="Continue with Apple"
          accessibilityRole="button"
          disabled={isLoading}
          onPress={() => {
            void handleSignIn('apple');
          }}
          style={({ pressed }) => [
            styles.appleFallbackButton,
            isDark ? styles.appleFallbackDark : styles.appleFallbackLight,
            pressed ? styles.pressed : styles.resting,
            isLoading ? styles.disabled : styles.resting,
          ]}
        >
          <Ionicons
            color={isDark ? '#000000' : '#FFFFFF'}
            name="logo-apple"
            size={20}
          />
          <Text
            style={[
              styles.appleLabel,
              isDark ? styles.appleLabelDark : styles.appleLabelLight,
            ]}
          >
            Continue with Apple
          </Text>
        </Pressable>
      )}

      <Pressable
        accessibilityLabel="Continue with Google"
        accessibilityRole="button"
        disabled={isLoading}
        onPress={() => {
          void handleSignIn('google');
        }}
        style={googleButtonStyle}
      >
        {!hasGoogleIconError ? (
          <Image
            accessibilityElementsHidden
            contentFit="contain"
            onError={() => setHasGoogleIconError(true)}
            source={GOOGLE_G_MARK_URI}
            style={styles.googleIcon}
          />
        ) : (
          <Text style={styles.googleFallbackIcon}>G</Text>
        )}
        <Text style={[styles.googleLabel, isMidnight ? styles.googleLabelMidnight : null]}>Continue with Google</Text>
      </Pressable>

      {showHelperText ? (
        <ThemedText
          accessibilityRole={error ? 'alert' : undefined}
          type="caption"
          style={[styles.helper, { color: error ? resolvedErrorColor : resolvedHelperColor }]}
        >
          {helperText}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: '100%',
    gap: 12,
  },
  appleNativeButton: {
    width: '100%',
    height: 56,
  },
  appleFallbackButton: {
    minHeight: 56,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
  },
  appleFallbackLight: {
    backgroundColor: '#0B0B0C',
  },
  appleFallbackDark: {
    backgroundColor: '#FFFFFF',
  },
  appleLabel: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  appleLabelLight: {
    color: '#FFFFFF',
  },
  appleLabelDark: {
    color: '#000000',
  },
  googleButton: {
    minHeight: 56,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
  },
  googleIcon: {
    width: 20,
    height: 20,
  },
  googleFallbackIcon: {
    color: '#4285F4',
    fontSize: 18,
    fontWeight: '700',
  },
  googleLabelMidnight: {
    color: '#e3e3e3',
  },
  googleButtonMidnight: {
    backgroundColor: '#131314',
  },
  googleLabel: {
    color: '#1F1F1F',
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  helper: {
    textAlign: 'center',
  },
  resting: {
    opacity: 1,
  },
  pressed: {
    opacity: 0.88,
    transform: [{ translateY: 1 }],
  },
  disabled: {
    opacity: 0.55,
  },
});
