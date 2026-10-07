import { Redirect, useLocalSearchParams } from 'expo-router';

import NewListScreen from '@/app/(app)/collection/new';
import AccountScreen from '@/app/(app)/account';
import EditListScreen from '@/app/(app)/collection/[id]/edit';
import CollectionDetailScreen from '@/app/(app)/collection/[id]/index';
import EditItemScreen from '@/app/(app)/collection/[id]/item/[itemId]';
import NewItemScreen from '@/app/(app)/collection/[id]/item/new';
import OursScreen from '@/app/(app)/(tabs)/ours';
import { CollectionsProvider } from '@/features/collections/collections-context';
import {
  DevErrorBoundary,
  PREVIEW_SESSION,
  PREVIEW_SPACE,
} from '@/features/dev/preview';
import { MomentsProvider } from '@/features/moments/moments-context';
import { SessionContext } from '@/features/session/session-context';
import { SpaceContext } from '@/features/space/space-context';
import { SubscriptionProvider } from '@/features/subscription/subscription-context';

/**
 * Development-only preview of the "Ours" screens: the real Ours tab, the
 * Account screen, and a list detail, through the mock world and the real
 * provider tree. Not linked from any navigation; production redirects home.
 *
 * Screens: ?screen=ours (default) | new-list | account | list&id=<collectionId> |
 * item&id=<collectionId>&itemId=<itemId> | new-item&id=<collectionId> |
 * edit-list&id=<collectionId>.
 */
export default function DevOurs() {
  const { screen: screenParam, previewScreen } = useLocalSearchParams<{ screen?: string; previewScreen?: string }>();
  const screen = previewScreen ?? screenParam;

  if (!__DEV__) {
    return <Redirect href="/" />;
  }

  return (
    <SessionContext.Provider value={PREVIEW_SESSION}>
      <SpaceContext.Provider value={PREVIEW_SPACE}>
        <SubscriptionProvider>
          <CollectionsProvider>
            <MomentsProvider>
              <DevErrorBoundary label={`OursPreview:${screen ?? 'ours'}`}>
                {screen === 'new-list' ? (
                  <NewListScreen />
                ) : screen === 'account' ? (
                  <AccountScreen />
                ) : screen === 'item' ? (
                  <EditItemScreen />
                ) : screen === 'new-item' ? (
                  <NewItemScreen />
                ) : screen === 'edit-list' ? (
                  <EditListScreen />
                ) : screen === 'shelf' || screen === 'list' ? (
                  <CollectionDetailScreen />
                ) : (
                  <OursScreen />
                )}
              </DevErrorBoundary>
            </MomentsProvider>
          </CollectionsProvider>
        </SubscriptionProvider>
      </SpaceContext.Provider>
    </SessionContext.Provider>
  );
}
