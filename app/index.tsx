import { Redirect } from "expo-router";

import { useSession } from "@/features/session/session-context";
import { useSpace } from "@/features/space/space-context";
import { useAoiTheme } from "@/features/theme/theme-context";

export default function Index() {
	const { status, isHydrated: isSessionHydrated } = useSession();
	const { status: spaceStatus, isHydrated: isSpaceHydrated } = useSpace();
	const { hasStoredSelection, isHydrated: isThemeHydrated } = useAoiTheme();

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

	if (!hasStoredSelection) {
		return <Redirect href="/(auth)/theme-select" />;
	}

	return <Redirect href="/(app)/(tabs)" />;
}
