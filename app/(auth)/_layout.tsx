import { Redirect } from 'expo-router';
import { Stack } from 'expo-router/stack';

import { useSession } from '@/features/session/session-context';

export default function AuthLayout() {
  const { status } = useSession();

  if (status === 'signed_in') {
    return <Redirect href="/(app)/(tabs)" />;
  }

  return (
    <Stack>
      <Stack.Screen name="sign-in" options={{ title: 'Sign in' }} />
      <Stack.Screen name="verify-code" options={{ title: 'Verify code' }} />
    </Stack>
  );
}
