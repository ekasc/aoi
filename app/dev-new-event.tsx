import { Redirect } from 'expo-router';

import NewCalendarEventScreen from '@/app/(app)/calendar/new-event';
import { CalendarProvider } from '@/features/calendar/calendar-context';
import { DevErrorBoundary, PREVIEW_SESSION, PREVIEW_SPACE } from '@/features/dev/preview';
import { SessionContext } from '@/features/session/session-context';
import { SpaceContext } from '@/features/space/space-context';

export default function DevNewEvent() {
  if (!__DEV__) return <Redirect href="/" />;
  return (
    <SessionContext.Provider value={PREVIEW_SESSION}>
      <SpaceContext.Provider value={PREVIEW_SPACE}>
        <CalendarProvider><DevErrorBoundary label="NewCalendarEventScreen"><NewCalendarEventScreen /></DevErrorBoundary></CalendarProvider>
      </SpaceContext.Provider>
    </SessionContext.Provider>
  );
}
