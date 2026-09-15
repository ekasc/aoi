import { Redirect } from "expo-router";

/**
 * Compatibility redirect: Profile left the bottom tabs in P2A and lives at
 * `/(app)/space`. This file sits OUTSIDE the tab group on purpose — route
 * groups are URL-transparent, so the legacy deep link (`/profile`) resolves
 * identically here while tab discovery sees only the three real tabs.
 */
export default function LegacyProfileRedirect() {
	return <Redirect href="/(app)/space" />;
}
