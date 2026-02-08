import { Redirect, Slot } from 'expo-router';

import { useSession } from '@/features/session/session-context';

export default function PublicLayout() {
  const { status } = useSession();

  if (status === 'signed_in') {
    return <Redirect href="/(app)/(tabs)" />;
  }

  return <Slot />;
}
