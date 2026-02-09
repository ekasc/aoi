import { Link, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { Spacing } from '@/constants/theme';
import { MOCK_VERIFY_CODE } from '@/features/session/mock-auth';
import { useSession } from '@/features/session/session-context';
import { useAoiTheme } from '@/features/theme/theme-context';
import { useThemeColor } from '@/hooks/use-theme-color';

export default function VerifyCodeScreen() {
  const router = useRouter();
  const { pendingEmail, verifyCode } = useSession();
  const { hasStoredSelection, isHydrated } = useAoiTheme();
  const border = useThemeColor({}, 'border');
  const surface2 = useThemeColor({}, 'surface2');
  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const danger = useThemeColor({}, 'danger');
  const background = useThemeColor({}, 'background');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const inputStyle = useMemo(
    () => [
      styles.input,
      { borderColor: border, backgroundColor: surface2, color: text },
    ],
    [border, surface2, text]
  );

  const handleVerify = useCallback(() => {
    if (!isHydrated) {
      setError('Preparing your theme settings. Please try again.');
      return;
    }

    const result = verifyCode(code);

    if (!result.ok) {
      setError(result.error ?? 'Unable to verify code.');
      return;
    }

    router.replace(hasStoredSelection ? '/(app)/(tabs)' : '/(auth)/theme-select');
  }, [code, hasStoredSelection, isHydrated, router, verifyCode]);

  if (!pendingEmail) {
    return (
      <ScrollView
        style={{ backgroundColor: background }}
        contentContainerStyle={styles.contentContainer}
        contentInsetAdjustmentBehavior="automatic"
      >
        <Surface style={styles.card}>
          <ThemedText type="title">Start with your email first</ThemedText>
          <Link href="/(auth)/sign-in" asChild>
            <Button label="Back to sign in" />
          </Link>
        </Surface>
      </ScrollView>
    );
  }

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
          Check your email
        </ThemedText>
        <ThemedText type="title" selectable>
          Enter the 6-digit code
        </ThemedText>
        <ThemedText type="caption" style={{ color: muted }}>
          Sent to {pendingEmail}
        </ThemedText>
        <ThemedText type="meta" style={{ color: muted }} selectable>
          Demo code {MOCK_VERIFY_CODE}
        </ThemedText>

        <TextInput
          accessibilityLabel="Verification code"
          autoCapitalize="none"
          autoComplete="one-time-code"
          autoCorrect={false}
          keyboardType="number-pad"
          maxLength={6}
          onChangeText={(value) => {
            const normalized = value.replace(/\D/g, '');
            setCode(normalized);
            if (error) {
              setError('');
            }
          }}
          placeholder="000000"
          placeholderTextColor={muted}
          style={inputStyle}
          value={code}
        />

        {error ? (
          <ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>
            {error}
          </ThemedText>
        ) : null}

        <View style={styles.actions}>
          <Button label="Continue" onPress={handleVerify} />
          <Link href="/(auth)/sign-in" asChild>
            <Button label="Back to email" variant="secondary" />
          </Link>
          <Button label="Resend code" variant="ghost" disabled onPress={() => {}} />
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
    gap: Spacing[8],
  },
  input: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: Spacing[12],
    paddingVertical: Spacing[12],
  },
  actions: {
    gap: Spacing[8],
    marginTop: Spacing[4],
  },
});
