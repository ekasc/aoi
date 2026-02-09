import { Redirect, Slot } from "expo-router";

import { useSession } from "@/features/session/session-context";
import { useSpace } from "@/features/space/space-context";
import { useAoiTheme } from "@/features/theme/theme-context";

export default function PublicLayout() {
	const { status, isHydrated: isSessionHydrated } = useSession();
	const { status: spaceStatus, isHydrated: isSpaceHydrated } = useSpace();
	const { hasStoredSelection, isHydrated: isThemeHydrated } = useAoiTheme();

	if (!isSessionHydrated || status === "loading") {
		return null;
	}

	if (status === "signed_in") {
		if (!isSpaceHydrated || !isThemeHydrated) {
			return null;
		}

		if (spaceStatus !== "ready") {
			return <Redirect href="/(auth)/space-setup" />;
		}

		return (
			<Redirect
				href={
					hasStoredSelection ? "/(app)/(tabs)" : "/(auth)/theme-select"
				}
			/>
		);
	}

	return <Slot />;
}
