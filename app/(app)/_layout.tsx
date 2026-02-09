import { Redirect } from "expo-router";
import { Stack } from "expo-router/stack";

import { CalendarProvider } from "@/features/calendar/calendar-context";
import { MomentsProvider } from "@/features/moments/moments-context";
import { useSession } from "@/features/session/session-context";
import { useAoiTheme } from "@/features/theme/theme-context";

export default function AuthenticatedAppLayout() {
	const { status } = useSession();
	const { hasStoredSelection, colors } = useAoiTheme();

	if (status === "signed_out") {
		return <Redirect href="/(public)" />;
	}

	if (!hasStoredSelection) {
		return <Redirect href="/(auth)/theme-select" />;
	}

	return (
		<CalendarProvider>
			<MomentsProvider>
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
						options={{ presentation: "modal", title: "Add moment" }}
					/>
					<Stack.Screen
						name="calendar/new-event"
						options={{
							title: "New event",
							presentation: "formSheet",
							sheetGrabberVisible: true,
							sheetAllowedDetents: [0.55, 1.0],
							contentStyle: { backgroundColor: "transparent" },
						}}
					/>
					<Stack.Screen
						name="calendar/edit/[id]"
						options={{
							title: "Edit event",
							presentation: "formSheet",
							sheetGrabberVisible: true,
							sheetAllowedDetents: [0.55, 1.0],
							contentStyle: { backgroundColor: "transparent" },
						}}
					/>
				</Stack>
			</MomentsProvider>
		</CalendarProvider>
	);
}
