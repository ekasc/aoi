import { Redirect } from 'expo-router';

import PartnerPortraitScreen from '@/app/(app)/partner';
import { DevErrorBoundary, PREVIEW_SESSION, PREVIEW_SPACE } from '@/features/dev/preview';
import { PartnerDetailsProvider } from '@/features/partner-details/partner-details-context';
import { SessionContext } from '@/features/session/session-context';
import { SpaceContext } from '@/features/space/space-context';

export default function DevLittleThings() {
  if (!__DEV__) return <Redirect href="/" />;
  return (
    <SessionContext.Provider value={PREVIEW_SESSION}>
      <SpaceContext.Provider value={PREVIEW_SPACE}>
        <PartnerDetailsProvider><DevErrorBoundary label="PartnerPortraitScreen"><PartnerPortraitScreen /></DevErrorBoundary></PartnerDetailsProvider>
      </SpaceContext.Provider>
    </SessionContext.Provider>
  );
}
