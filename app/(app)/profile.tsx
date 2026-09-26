import { Redirect } from "expo-router";

/**
 * Compatibility redirect: the legacy `/profile` deep link resolves to the
 * Space tab at `/(app)/(tabs)/space`. This file sits OUTSIDE the tab group
 * on purpose — route groups are URL-transparent, so the deep link keeps
 * working while tab discovery sees only the real tabs.
 */
export default function LegacyProfileRedirect() {
	return <Redirect href="/(app)/(tabs)/space" />;
}
