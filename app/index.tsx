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
		return <Redirect href="/(public)" />;
	}

	if (!isSpaceHydrated || !isThemeHydrated) {
		return null;
	}

	if (spaceStatus !== "ready") {
		return <Redirect href="/(auth)/space-setup" />;
	}

	return <Redirect href="/(app)/(tabs)/(memories)" />;
}
