import { Redirect, useRouter } from 'expo-router';

import { OnboardingWizard } from '@/components/setup/onboarding-wizard';
import {
  DevErrorBoundary,
  PREVIEW_SESSION,
} from '@/features/dev/preview';
import { SessionContext } from '@/features/session/session-context';
import { SpaceContext } from '@/features/space/space-context';
import type { SpaceContextValue } from '@/features/space/types';

/**
 * Development-only Space setup preview. The seeded session boots straight
 * into a ready space, so the first-run screen a brand-new reader actually
 * sees has no other way onto a screen headlessly. Not linked from any
 * navigation; production builds redirect home.
 */

const PREVIEW_SPACELESS: SpaceContextValue = {
  status: 'none',
  space: null,
  isHydrated: true,
  // Creation resolves with a real-shaped space and its code, so the whole
  // first-run flow (including the beat after creating) is walkable here
  // without a backend. The context itself never updates, so the screen stays
  // on setup exactly as a reader's would until they choose to leave.
  createSpace: async (input) => ({
    id: 'preview-space-created',
    name: input.name,
    createdByUserId: input.createdByUserId,
    yourName: input.yourName,
    partnerName: null,
    relationshipStartDate: null,
    inviteCode: 'MAYA16',
    partnerJoined: false,
    inviteExpiresAt: null,
    createdAt: '2026-09-29T00:00:00.000Z',
    updatedAt: '2026-09-29T00:00:00.000Z',
  }),
  // Viewer-relative, like the real repositories: the joiner's own name in
  // `yourName`, the person they joined in `partnerName`.
  joinSpace: async (input) => ({
    id: 'preview-space-joined',
    name: 'Maya & June',
    createdByUserId: 'preview-june',
    yourName: input.yourName?.trim() || 'Maya',
    partnerName: 'June',
    relationshipStartDate: '2022-06-14',
    inviteCode: input.inviteCode,
    partnerJoined: true,
    inviteExpiresAt: null,
    createdAt: '2022-06-14T00:00:00.000Z',
    updatedAt: '2026-09-29T00:00:00.000Z',
  }),
  updateSpace: async () => null,
  clearSpace: async () => {},
  leaveSpace: async () => {},
  regenerateInvite: async () => 'MAYA16',
  // Preview spaces are fixed; there is nothing newer to read.
  refreshSpace: async () => {},
};

export default function DevSetup() {
  const router = useRouter();
  if (!__DEV__) {
    return <Redirect href="/" />;
  }
  return (
    <SessionContext.Provider value={PREVIEW_SESSION}>
      <SpaceContext.Provider value={PREVIEW_SPACELESS}>
        <DevErrorBoundary label="OnboardingWizard">
          <OnboardingWizard onEnter={() => router.replace('/dev-story?variant=empty&firstPage=create')} />
        </DevErrorBoundary>
      </SpaceContext.Provider>
    </SessionContext.Provider>
  );
}
