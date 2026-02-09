import { Redirect, Slot } from "expo-router";

import { useSession } from "@/features/session/session-context";
import { useAoiTheme } from "@/features/theme/theme-context";

export default function PublicLayout() {
	const { status } = useSession();
	const { hasStoredSelection } = useAoiTheme();

	if (status === "signed_in") {
		return (
			<Redirect
				href={
					hasStoredSelection
						? "/(app)/(tabs)"
						: "/(auth)/theme-select"
				}
			/>
		);
	}

	return <Slot />;
}
