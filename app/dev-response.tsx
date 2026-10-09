import { Redirect } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView } from 'react-native';

import { UsExchange } from '@/components/home/us-exchange';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { DevErrorBoundary, PREVIEW_SESSION, PREVIEW_SPACE } from '@/features/dev/preview';
import type { Moment } from '@/features/moments/types';
import { ResponsesProvider, useResponses } from '@/features/responses/responses-context';
import { SessionContext } from '@/features/session/session-context';
import { SpaceContext } from '@/features/space/space-context';

const memory: Moment = {
  id: 'preview-response-memory', type: 'note', title: 'A day together', body: 'A small memory.',
  occurredAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z',
  authorId: 'preview-maya', authorRole: 'you', authorName: 'Maya',
};

export default function DevResponse() {
  if (!__DEV__) return <Redirect href="/" />;
  return (
    <SessionContext.Provider value={PREVIEW_SESSION}>
      <SpaceContext.Provider value={PREVIEW_SPACE}>
        <ResponsesProvider>
          <DevErrorBoundary label="UsExchange">
            <ScrollView contentContainerStyle={{ padding: Spacing[24] }}>
              <ThemedText type="title">{memory.title}</ThemedText>
              <ResponsePreview />
            </ScrollView>
          </DevErrorBoundary>
        </ResponsesProvider>
      </SpaceContext.Provider>
    </SessionContext.Provider>
  );
}

function ResponsePreview() {
  const { loadFor } = useResponses();
  useEffect(() => { void loadFor(memory.id); }, [loadFor]);
  return <UsExchange moment={memory} />;
}
