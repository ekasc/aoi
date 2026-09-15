import Constants from "expo-constants";
import { Redirect } from "expo-router";
import { Stack } from "expo-router/stack";
import { ActivityIndicator, View } from "react-native";

import { CalendarProvider } from "@/features/calendar/calendar-context";
import { LettersProvider } from "@/features/letters/letters-context";
import { PartnerDetailsProvider } from "@/features/partner-details/partner-details-context";
import { ProposalsProvider } from "@/features/proposals/proposals-context";
import { PushProvider } from "@/features/push/push-context";
import { QuestionProvider } from "@/features/question/question-context";
import { useSession } from "@/features/session/session-context";
import { SomedayProvider } from "@/features/someday/someday-context";
import { useSpace } from "@/features/space/space-context";
import { SqueezeProvider } from "@/features/squeeze/squeeze-context";
import { useAoiTheme } from "@/features/theme/theme-context";
import { SqueezeOverlay } from "@/components/squeeze/squeeze-overlay";
import { ComposerProvider } from "@/features/composer/composer-context";
import { useDevSeed } from "@/features/dev/preview";
import { FontFamilies } from "@/constants/typography";

// Space (the profile) is a detail hoisted above the tabs. Anchoring the stack
// to (tabs) guarantees the anchor is seeded beneath any direct entry (deep
// link, redirect, dev preview), so its native header always has a back button.
export const unstable_settings = { anchor: "(tabs)" };

export default function AuthenticatedAppLayout() {
	// Seeds the mock world into the REAL app tree when EXPO_PUBLIC_DEV_SEED is
	// set (dev only): the tabs, navigation, and every screen run normally, the
	// stub data layer just swaps its fixtures. No-op otherwise.
	useDevSeed();
	const isIos = process.env.EXPO_OS === "ios";
	const isExpoGo = Constants.appOwnership === "expo";
	const useFormSheet = isIos && !isExpoGo;
	const { status, isHydrated: isSessionHydrated } = useSession();
	const { status: spaceStatus, isHydrated: isSpaceHydrated } = useSpace();
	const {
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

	return (
		<CalendarProvider>
			<PartnerDetailsProvider>
				<SomedayProvider>
					<QuestionProvider>
						<SqueezeProvider>
							<ProposalsProvider>
							<LettersProvider>
							<PushProvider>
								<ComposerProvider>
								<SqueezeOverlay />
							<Stack
									screenOptions={{
										contentStyle: { backgroundColor: colors.background },
										headerStyle: { backgroundColor: colors.background },
										headerTintColor: colors.text,
										headerShadowVisible: false,
										headerTitleStyle: { fontFamily: FontFamilies.body },
									}}
								>
									<Stack.Screen name="(tabs)" options={{ headerShown: false }} />
									{/* Legacy compat redirect (P2A): no header flash before it resolves. */}
									<Stack.Screen name="profile" options={{ headerShown: false }} />
									<Stack.Screen
										name="space"
										options={{
											// A pushed view, not a sheet: the profile lives
											// in its own screen with a native back button.
											title: "Space",
										}}
									/>
									{/* Legacy setting deep link: redirects into Space. */}
									<Stack.Screen name="settings" options={{ headerShown: false }} />
									<Stack.Screen
										name="moment/trace"
										options={{
											title: "Keep this",
											presentation: "pageSheet",
											...sheetOptions,
										}}
									/>
								<Stack.Screen
									name="moment/new"
									options={{
										title: "New memory",
										// The header owns Cancel/title/Save on iOS
										// (Screen.Title + header toolbars in the
										// composer). Other platforms keep the
										// composer's custom top bar, so the native
										// header stays hidden there.
										headerShown: process.env.EXPO_OS === "ios",
										presentation: useFormSheet ? "formSheet" : "modal",
										...sheetOptions,
									}}
								/>
									<Stack.Screen
										name="moment/[id]"
										options={{
											title: "Memory",
											presentation: useFormSheet ? "formSheet" : "modal",
											...sheetOptions,
										}}
									/>
									<Stack.Screen
										name="moment/edit/[id]"
										options={{
											title: "Edit moment",
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
										name="chapter/[id]"
										options={{
											title: "Chapter",
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
										name="letters"
										options={{
											title: "Letters",
											presentation: useFormSheet ? "formSheet" : "modal",
											...sheetOptions,
										}}
									/>
									<Stack.Screen
										name="letter/new"
										options={{
											title: "Write a letter",
											presentation: useFormSheet ? "formSheet" : "modal",
											...sheetOptions,
										}}
									/>
									<Stack.Screen
										name="letter/[id]"
										options={{
											title: "Letter",
											presentation: useFormSheet ? "formSheet" : "modal",
											...sheetOptions,
										}}
									/>
									<Stack.Screen
										name="proposal/new"
										options={{
											title: "Suggest a time",
											presentation: useFormSheet ? "formSheet" : "modal",
											...sheetOptions,
										}}
									/>
									<Stack.Screen
										name="paywall"
										options={{
											title: "Aoi Plus",
											presentation: useFormSheet ? "formSheet" : "modal",
											...sheetOptions,
										}}
									/>
									<Stack.Screen
										name="goal-new"
										options={{
											title: "New goal",
											presentation: useFormSheet ? "formSheet" : "modal",
											...sheetOptions,
										}}
									/>
								</Stack>
								</ComposerProvider>
							</PushProvider>
							</LettersProvider>
							</ProposalsProvider>
					</SqueezeProvider>
					</QuestionProvider>
				</SomedayProvider>
			</PartnerDetailsProvider>
		</CalendarProvider>
	);
}
