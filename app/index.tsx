import { Redirect } from "expo-router";

import { useSession } from "@/features/session/session-context";
import { useSpace } from "@/features/space/space-context";
import { useAoiTheme } from "@/features/theme/theme-context";

/**
 * Root landing. With `EXPO_PUBLIC_DEV_SEED` set, the dev seed has already
 * written a real session + space, so this redirects into the REAL app tree
 * (tabs and all) exactly as a genuine sign-in would — no preview route, no
 * navigation bypassed.
 */
export default function Index() {
	const { status, isHydrated: isSessionHydrated } = useSession();
	const { status: spaceStatus, isHydrated: isSpaceHydrated } = useSpace();
	const { isHydrated: isThemeHydrated } = useAoiTheme();

	if (!isSessionHydrated || status === "loading") {
		return null;
	}

	if (status === "signed_out") {
		// E2E builds land on the test console instead of the public sign-in,
		// which needs a native sheet no emulator can answer. Past that
		// screen everything is production code.
		if (__DEV__ && process.env.EXPO_PUBLIC_E2E_MODE === "true") {
			return <Redirect href="/dev-e2e" />;
		}
		return <Redirect href="/(public)" />;
	}

	if (!isSpaceHydrated || !isThemeHydrated) {
		return null;
	}

	if (spaceStatus !== "ready") {
		return <Redirect href="/(auth)/space-setup" />;
	}

	// The dev seed opens on Us so the seeded screen is one launch away.
	return (
		<Redirect
			href={process.env.EXPO_PUBLIC_DEV_SEED ? "/(app)/(tabs)/together" : "/(app)/(tabs)/(memories)"}
		/>
	);
}
