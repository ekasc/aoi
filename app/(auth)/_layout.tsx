import { Redirect, useSegments } from 'expo-router';
import { Stack } from 'expo-router/stack';

import { useSession } from '@/features/session/session-context';
import { useAoiTheme } from '@/features/theme/theme-context';

export default function AuthLayout() {
  const { status } = useSession();
  const { colors } = useAoiTheme();
  const segments = useSegments();
  const routeName = segments[segments.length - 1];
  const isThemeSelectRoute = routeName === 'theme-select';

  if (status === 'signed_in' && !isThemeSelectRoute) {
    return <Redirect href="/(app)/(tabs)" />;
  }

  if (status === 'signed_out' && isThemeSelectRoute) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: colors.background },
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
      }}
    >
      <Stack.Screen name="sign-in" options={{ title: 'Sign in' }} />
      <Stack.Screen name="verify-code" options={{ title: 'Verify code' }} />
      <Stack.Screen name="theme-select" options={{ title: 'Theme' }} />
    </Stack>
  );
}
