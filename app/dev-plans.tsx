import { Redirect, useLocalSearchParams } from "expo-router";

import PlansScreen from "@/app/(app)/(tabs)/plans";
import { CalendarProvider } from "@/features/calendar/calendar-context";
import {
	DevErrorBoundary,
	PREVIEW_SESSION,
	PREVIEW_SPACE,
	parsePreviewVariant,
	useApplyPreviewVariant,
} from "@/features/dev/preview";
import { SessionContext } from "@/features/session/session-context";
import { SomedayProvider } from "@/features/someday/someday-context";
import { SpaceContext } from "@/features/space/space-context";

/**
 * Development-only Plans preview. Same convention as
 * dev-story/dev-chapter/dev-foundations: not linked from any navigation,
 * renders the REAL screen through the REAL provider tree with the stub
 * data layer's fixtures.
 *
 * Why it exists: the Plans screen sits behind the (app) layout and a
 * SecureStore session, so it is unreachable on web, and simulators are slow
 * to spin up. Motion work on the day view needs to be looked at, framed by
 * framed, so this route makes the screen reachable in a browser.
 *
 * It mounts the provider the (app) layout owns that this screen reads
 * (calendar) and overrides session/space with the preview world;
 * moments and the theme already come from the root layout. The bottom tab bar
 * is absent because the tab navigator lives in the (tabs) layout: expected for
 * a single-screen preview.
 *
 * Genuinely development-only: production builds (`__DEV__ === false`)
 * redirect to the app root instead of rendering preview content.
 */
export default function DevPlans() {
	if (!__DEV__) {
		return <Redirect href="/" />;
	}
	return <DevPlansPreview />;
}

function DevPlansPreview() {
	const { variant } = useLocalSearchParams<{ variant?: string | string[] }>();
	useApplyPreviewVariant(parsePreviewVariant(variant));
	return (
		<SessionContext.Provider value={PREVIEW_SESSION}>
			<SpaceContext.Provider value={PREVIEW_SPACE}>
				<SomedayProvider>
					<CalendarProvider>
						<DevErrorBoundary label="PlansScreen">
							<PlansScreen />
						</DevErrorBoundary>
					</CalendarProvider>
				</SomedayProvider>
			</SpaceContext.Provider>
		</SessionContext.Provider>
	);
}
