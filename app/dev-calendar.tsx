import { Redirect, useLocalSearchParams } from 'expo-router';

import CalendarYearScreen from '@/app/(app)/calendar/year';
import PlansScreen from '@/app/(app)/(tabs)/plans';
import { CalendarProvider } from '@/features/calendar/calendar-context';
import {
	DevErrorBoundary,
	PREVIEW_SESSION,
	PREVIEW_SPACE,
} from '@/features/dev/preview';
import { MomentsProvider } from '@/features/moments/moments-context';
import { PartnerDetailsProvider } from '@/features/partner-details/partner-details-context';
import { PushProvider } from '@/features/push/push-context';
import { SessionContext } from '@/features/session/session-context';
import { SomedayProvider } from '@/features/someday/someday-context';
import { SqueezeProvider } from '@/features/squeeze/squeeze-context';
import { SpaceContext } from '@/features/space/space-context';

type PreviewScreen = 'plans' | 'year';

function parseScreen(raw: string | string[] | undefined): PreviewScreen {
	const value = Array.isArray(raw) ? raw[0] : raw;
	if (value === 'year') {
		return value;
	}
	return 'plans';
}

/**
 * Development-only calendar preview: the whole mock world behind the same
 * providers the real tree uses, so the calendar renders as it ships instead of
 * through a throwaway harness. Months, the day view, and the year are all
 * reachable here, the day view by tapping a date.
 *
 * Screens: ?screen=plans (default) | year.
 * Not linked from any navigation. Production builds redirect home.
 */
export default function DevCalendar() {
	// The hook runs before the dev-only early return. A conditional hook is a
	// hook-order bug even in a preview route.
	const { screen } = useLocalSearchParams<{ screen?: string | string[] }>();
	const selected = parseScreen(screen);

	if (!__DEV__) {
		return <Redirect href="/" />;
	}

	return (
		<SessionContext.Provider value={PREVIEW_SESSION}>
			<SpaceContext.Provider value={PREVIEW_SPACE}>
				<CalendarProvider>
					<PartnerDetailsProvider>
						<SomedayProvider>
							<MomentsProvider>
								<SqueezeProvider>
									<PushProvider>
									<DevErrorBoundary label={`CalendarDev:${selected}`}>
										{selected === 'year' ? (
											<CalendarYearScreen />
										) : (
											<PlansScreen />
										)}
									</DevErrorBoundary>
									</PushProvider>
								</SqueezeProvider>
							</MomentsProvider>
						</SomedayProvider>
					</PartnerDetailsProvider>
				</CalendarProvider>
			</SpaceContext.Provider>
		</SessionContext.Provider>
	);
}
