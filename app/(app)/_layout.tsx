import Constants from "expo-constants";
import { Redirect } from "expo-router";
import { Stack } from "expo-router/stack";

import { CalendarProvider } from "@/features/calendar/calendar-context";
import { useSession } from "@/features/session/session-context";
import { useSpace } from "@/features/space/space-context";
import { useAoiTheme } from "@/features/theme/theme-context";

export default function AuthenticatedAppLayout() {
	const isIos = process.env.EXPO_OS === "ios";
	const isExpoGo = Constants.appOwnership === "expo";
	const useFormSheet = isIos && !isExpoGo;
	const { status, isHydrated: isSessionHydrated } = useSession();
	const { status: spaceStatus, isHydrated: isSpaceHydrated } = useSpace();
	const {
		hasStoredSelection,
		colors,
		isHydrated: isThemeHydrated,
	} = useAoiTheme();
	const sheetOptions = useFormSheet
		? {
				sheetGrabberVisible: true,
				sheetAllowedDetents: [0.55, 1.0],
				contentStyle: { backgroundColor: colors.background },
		  }
		: {};

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

	return (
		<CalendarProvider>
			<Stack
				screenOptions={{
					contentStyle: { backgroundColor: colors.background },
				}}
			>
				<Stack.Screen
					name="(tabs)"
					options={{ headerShown: false }}
				/>
				<Stack.Screen
						name="moment/new"
						options={{
							title: "Add moment",
							presentation: useFormSheet ? "formSheet" : "modal",
							...sheetOptions,
						}}
					/>
				<Stack.Screen
						name="calendar/new-event"
						options={{
							title: "New event",
							presentation: useFormSheet ? "formSheet" : "modal",
							...sheetOptions,
						}}
					/>
				<Stack.Screen
						name="calendar/edit/[id]"
						options={{
							title: "Edit event",
							presentation: useFormSheet ? "formSheet" : "modal",
							...sheetOptions,
						}}
					/>
				<Stack.Screen
						name="profile/edit-relationship"
						options={{
							title: "Edit relationship",
							presentation: useFormSheet ? "formSheet" : "modal",
							...sheetOptions,
						}}
					/>
				<Stack.Screen
						name="profile/import-milestones"
						options={{
							title: "Import milestones",
							presentation: useFormSheet ? "formSheet" : "modal",
							...sheetOptions,
						}}
					/>
			</Stack>
		</CalendarProvider>
	);
}
