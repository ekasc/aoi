import { Redirect, useLocalSearchParams } from 'expo-router';

import CalendarYearScreen from '@/app/(app)/calendar/year';
import CalendarSearchScreen from '@/app/(app)/calendar/search';
import PlansScreen from '@/app/(app)/(tabs)/plans';
import { CalendarProvider } from '@/features/calendar/calendar-context';
import {
	DevErrorBoundary,
	PREVIEW_SESSION,
	PREVIEW_SPACE,
} from '@/features/dev/preview';
import { MomentsProvider } from '@/features/moments/moments-context';
import { PartnerDetailsProvider } from '@/features/partner-details/partner-details-context';
import { ProposalsProvider } from '@/features/proposals/proposals-context';
import { PushProvider } from '@/features/push/push-context';
import { SessionContext } from '@/features/session/session-context';
import { SomedayProvider } from '@/features/someday/someday-context';
import { SqueezeProvider } from '@/features/squeeze/squeeze-context';
import { SpaceContext } from '@/features/space/space-context';

type PreviewScreen = 'plans' | 'year' | 'search';

function parseScreen(raw: string | string[] | undefined): PreviewScreen {
	const value = Array.isArray(raw) ? raw[0] : raw;
	if (value === 'year' || value === 'search') {
		return value;
	}
	return 'plans';
}

/**
 * Development-only calendar preview: the whole mock world behind the same
 * providers the real tree uses, so the calendar renders as it ships instead of
 * through a throwaway harness. Months, the day view, the year and search are
 * all reachable here, the day view by tapping a date.
 *
 * Screens: ?screen=plans (default) | year | search.
 * Not linked from any navigation. Production builds redirect home.
 */
export default function DevCalendar() {
	if (!__DEV__) {
		return <Redirect href="/" />;
	}

	const { screen } = useLocalSearchParams<{ screen?: string | string[] }>();
	const selected = parseScreen(screen);

	return (
		<SessionContext.Provider value={PREVIEW_SESSION}>
			<SpaceContext.Provider value={PREVIEW_SPACE}>
				<CalendarProvider>
					<PartnerDetailsProvider>
						<SomedayProvider>
							<MomentsProvider>
								<ProposalsProvider>
								<SqueezeProvider>
									<PushProvider>
									<DevErrorBoundary label={`CalendarDev:${selected}`}>
										{selected === 'year' ? (
											<CalendarYearScreen />
										) : selected === 'search' ? (
											<CalendarSearchScreen />
										) : (
											<PlansScreen />
										)}
									</DevErrorBoundary>
									</PushProvider>
								</SqueezeProvider>
								</ProposalsProvider>
							</MomentsProvider>
						</SomedayProvider>
					</PartnerDetailsProvider>
				</CalendarProvider>
			</SpaceContext.Provider>
		</SessionContext.Provider>
	);
}
