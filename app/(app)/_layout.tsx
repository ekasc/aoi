import { Redirect } from 'expo-router';
import { Stack } from 'expo-router/stack';

import { MomentsProvider } from '@/features/moments/moments-context';
import { useSession } from '@/features/session/session-context';

export default function AuthenticatedAppLayout() {
  const { status } = useSession();

  if (status === 'signed_out') {
    return <Redirect href="/(public)" />;
  }

  return (
    <MomentsProvider>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="moment/new"
          options={{ presentation: 'modal', title: 'Add moment' }}
        />
      </Stack>
    </MomentsProvider>
  );
}
