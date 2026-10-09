import { useEffect, useRef } from 'react';
import { useLocalSearchParams } from 'expo-router';

import { OnboardingWizard } from '@/components/setup/onboarding-wizard';
import { publishInvite } from '@/features/space/invite-handoff';

export const options = { headerShown: false };

/**
 * The setup route, and nothing more.
 *
 * The resume rule ("a Space that already exists skips setup entirely") belongs
 * to the flow, which is also the only thing that knows a Space was just minted
 * here and its invite code has not been read yet. Deciding it at this level
 * would redirect straight out of the beat, before the code was ever on screen.
 *
 * An invite link lands here, so the code it carried is handed to the flow
 * rather than left in the URL. It arrives as a route param, the flow owns the
 * field, and the wizard is re-entered for whoever is signed in.
 */
export default function SpaceSetupScreen() {
  const { code } = useLocalSearchParams<{ code?: string | string[] }>();
  const shared = Array.isArray(code) ? code[0] : code;
  // One pass per code. The flow holds the field, so re-running this on a
  // re-render would overwrite anything the reader has typed since.
  const applied = useRef<string | null>(null);

  useEffect(() => {
    if (!shared || applied.current === shared) {
      return;
    }
    applied.current = shared;
    publishInvite(shared);
  }, [shared]);

  return <OnboardingWizard />;
}
