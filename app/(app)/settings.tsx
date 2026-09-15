import { Redirect } from 'expo-router';

/**
 * Legacy settings deep link. Account controls now live in the Space screen's
 * Account segment (one route, no nested settings screen), so /settings points
 * there with that segment preselected.
 */
export default function LegacySettingsRedirect() {
	return <Redirect href="/(app)/space" />;
}
