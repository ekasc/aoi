import { Redirect, useLocalSearchParams } from 'expo-router';

import SpaceScreen from '@/app/(app)/(tabs)/space';
import EditRelationshipScreen from '@/app/(app)/profile/edit-relationship';
import { DevErrorBoundary, PREVIEW_SESSION, PREVIEW_SPACE } from '@/features/dev/preview';
import { SessionContext } from '@/features/session/session-context';
import { SpaceContext } from '@/features/space/space-context';

export default function DevSpace() {
  if (!__DEV__) return <Redirect href="/" />;
  return <DevSpacePreview />;
}

function DevSpacePreview() {
  const { waiting, edit } = useLocalSearchParams<{ waiting?: string; edit?: string }>();
  const space = PREVIEW_SPACE.space;
  return (
    <SessionContext.Provider value={PREVIEW_SESSION}>
      <SpaceContext.Provider value={{
        ...PREVIEW_SPACE,
        space: space ? {
          ...space,
          partnerJoined: waiting !== 'true',
          inviteCode: waiting === 'true' ? 'HQABD7' : space.inviteCode,
        } : null,
      }}>
        <DevErrorBoundary label="SpaceScreen">
          {edit === 'true' ? <EditRelationshipScreen /> : <SpaceScreen />}
        </DevErrorBoundary>
      </SpaceContext.Provider>
    </SessionContext.Provider>
  );
}
