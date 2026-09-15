import { Redirect } from 'expo-router';

import { OnboardingWizard } from '@/components/setup/onboarding-wizard';
import { useSpace } from '@/features/space/space-context';

export const options = { headerShown: false };

export default function SpaceSetupScreen() {
  const { status } = useSpace();
  // Resume safety: creation already succeeded (or another device joined) —
  // skip setup entirely and enter Story. There are no setup steps to redo.
  if (status === 'ready') {
    return <Redirect href="/(app)/(tabs)/(memories)" />;
  }
  return <OnboardingWizard />;
}
