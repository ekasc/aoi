import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/features/session/session-context';
import { useThemeColor } from '@/hooks/use-theme-color';

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function SignInScreen() {
  const router = useRouter();
  const { signInStart } = useSession();
  const border = useThemeColor({}, 'border');
  const surface2 = useThemeColor({}, 'surface2');
  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const danger = useThemeColor({}, 'danger');
  const background = useThemeColor({}, 'background');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  const inputStyle = useMemo(
    () => [
      styles.input,
      { borderColor: border, backgroundColor: surface2, color: text },
    ],
    [border, surface2, text]
  );

  const handleContinue = useCallback(() => {
    const normalized = email.trim().toLowerCase();

    if (!isValidEmail(normalized)) {
      setError('Enter a valid email address.');
      return;
    }

    signInStart(normalized);
    router.push('/(auth)/verify-code');
  }, [email, router, signInStart]);

  return (
    <ScrollView
      style={{ backgroundColor: background }}
      contentContainerStyle={styles.contentContainer}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <Surface variant="raised" style={styles.card}>
        <ThemedText type="meta" style={{ color: muted }}>
          Welcome back
        </ThemedText>
        <ThemedText type="title" selectable>
          Sign in
        </ThemedText>
        <ThemedText type="caption" style={{ color: muted }}>
          Enter your email to get started.
        </ThemedText>

        <TextInput
          accessibilityLabel="Email address"
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          keyboardType="email-address"
          onChangeText={(value) => {
            setEmail(value);
            if (error) {
              setError('');
            }
          }}
          placeholder="you@example.com"
          placeholderTextColor={muted}
          style={inputStyle}
          value={email}
        />

        {error ? (
          <ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>
            {error}
          </ThemedText>
        ) : null}

        <View style={styles.actions}>
          <Button label="Continue" onPress={handleContinue} />
        </View>
      </Surface>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  contentContainer: {
    paddingHorizontal: Spacing[16],
    paddingTop: Spacing[16],
    paddingBottom: Spacing[40],
  },
  card: {
    gap: Spacing[12],
  },
  input: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: Spacing[12],
    paddingVertical: Spacing[12],
  },
  actions: {
    marginTop: Spacing[4],
  },
});
