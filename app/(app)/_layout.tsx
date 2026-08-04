import Constants from "expo-constants";
import { Redirect } from "expo-router";
import { Stack } from "expo-router/stack";
import { ActivityIndicator, View } from "react-native";

import { CalendarProvider } from "@/features/calendar/calendar-context";
import { LocationProvider } from "@/features/location/location-context";
import { PartnerDetailsProvider } from "@/features/partner-details/partner-details-context";
import { PushProvider } from "@/features/push/push-context";
import { QuestionProvider } from "@/features/question/question-context";
import { useSession } from "@/features/session/session-context";
import { SomedayProvider } from "@/features/someday/someday-context";
import { useSpace } from "@/features/space/space-context";
import { SqueezeProvider } from "@/features/squeeze/squeeze-context";
import { useAoiTheme } from "@/features/theme/theme-context";
import { LocationRequestPrompt } from "@/components/location/location-request-prompt";
import { SqueezeOverlay } from "@/components/squeeze/squeeze-overlay";

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
		return (
			<View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" }}>
				<ActivityIndicator color={colors.accent} />
			</View>
		);
	}

	if (status === "signed_out") {
		return <Redirect href="/(public)" />;
	}

	if (!isSpaceHydrated || !isThemeHydrated) {
		return (
			<View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" }}>
				<ActivityIndicator color={colors.accent} />
			</View>
		);
	}

	if (spaceStatus !== "ready") {
		return <Redirect href="/(auth)/space-setup" />;
	}

	if (!hasStoredSelection) {
		return <Redirect href="/(auth)/theme-select" />;
	}

	return (
		<CalendarProvider>
			<PartnerDetailsProvider>
				<SomedayProvider>
					<QuestionProvider>
						<SqueezeProvider>
							<LocationProvider>
								<PushProvider>
									<SqueezeOverlay />
									<LocationRequestPrompt />
								<Stack
									screenOptions={{
										contentStyle: { backgroundColor: colors.background },
									}}
								>
									<Stack.Screen name="(tabs)" options={{ headerShown: false }} />
									<Stack.Screen
										name="moment/new"
										options={{
											title: "Add moment",
											presentation: "pageSheet",
											...sheetOptions,
										}}
									/>
									<Stack.Screen
										name="moment/trace"
										options={{
											title: "Keep this",
											presentation: "pageSheet",
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
									<Stack.Screen
										name="profile/little-things"
										options={{
											title: "The little things",
											presentation: useFormSheet ? "formSheet" : "modal",
											...sheetOptions,
										}}
									/>
									<Stack.Screen
										name="someday"
										options={{
											title: "Someday",
											presentation: useFormSheet ? "formSheet" : "modal",
											...sheetOptions,
										}}
									/>
									<Stack.Screen
										name="memory-wall"
										options={{
											title: "Memory wall",
											presentation: useFormSheet ? "formSheet" : "modal",
											...sheetOptions,
										}}
									/>
									<Stack.Screen
										name="question"
										options={{
											title: "This week",
											presentation: useFormSheet ? "formSheet" : "modal",
											...sheetOptions,
										}}
									/>
									<Stack.Screen
										name="location"
										options={{
											title: "Location",
											presentation: useFormSheet ? "formSheet" : "modal",
											...sheetOptions,
										}}
									/>
									<Stack.Screen
										name="partner-map"
										options={{
											title: "Where they are",
											presentation: useFormSheet ? "formSheet" : "modal",
											...sheetOptions,
										}}
									/>
								</Stack>
							</PushProvider>
						</LocationProvider>
					</SqueezeProvider>
					</QuestionProvider>
				</SomedayProvider>
			</PartnerDetailsProvider>
		</CalendarProvider>
	);
}
