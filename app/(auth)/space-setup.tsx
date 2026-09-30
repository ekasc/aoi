import { OnboardingWizard } from '@/components/setup/onboarding-wizard';

export const options = { headerShown: false };

/**
 * The setup route, and nothing more.
 *
 * The resume rule ("a Space that already exists skips setup entirely") belongs
 * to the flow, which is also the only thing that knows a Space was just minted
 * here and its invite code has not been read yet. Deciding it at this level
 * would redirect straight out of the beat, before the code was ever on screen.
 */
export default function SpaceSetupScreen() {
  return <OnboardingWizard />;
}
