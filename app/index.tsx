import { Redirect } from 'expo-router';

import { useSession } from '@/features/session/session-context';

export default function Index() {
  const { status } = useSession();

  return <Redirect href={status === 'signed_in' ? '/(app)/(tabs)' : '/(public)'} />;
}
