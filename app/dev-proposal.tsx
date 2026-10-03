import { Redirect } from 'expo-router';

import NewProposalScreen from '@/app/(app)/proposal/new';
import { DevErrorBoundary, PREVIEW_SESSION, PREVIEW_SPACE } from '@/features/dev/preview';
import { ProposalsProvider } from '@/features/proposals/proposals-context';
import { SessionContext } from '@/features/session/session-context';
import { SpaceContext } from '@/features/space/space-context';

export default function DevProposal() {
  if (!__DEV__) return <Redirect href="/" />;
  return (
    <SessionContext.Provider value={PREVIEW_SESSION}>
      <SpaceContext.Provider value={PREVIEW_SPACE}>
        <ProposalsProvider><DevErrorBoundary label="NewProposalScreen"><NewProposalScreen /></DevErrorBoundary></ProposalsProvider>
      </SpaceContext.Provider>
    </SessionContext.Provider>
  );
}
