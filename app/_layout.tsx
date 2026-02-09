import {
	DarkTheme,
	DefaultTheme,
	ThemeProvider as NavigationThemeProvider,
} from "@react-navigation/native";
import { Stack } from "expo-router/stack";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";

import { LaunchSplash } from "@/components/launch-splash";
import { MomentsProvider } from "@/features/moments/moments-context";
import { SessionProvider, useSession } from "@/features/session/session-context";
import { SpaceProvider, useSpace } from "@/features/space/space-context";
import { AoiThemeProvider, useAoiTheme } from "@/features/theme/theme-context";
import { useAoiFonts } from "@/hooks/use-aoi-fonts";

void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
	const { fontsLoaded } = useAoiFonts();

	return (
		<SessionProvider>
			<SpaceProvider>
				<AoiThemeProvider>
					<MomentsProvider>
						<RootNavigation fontsLoaded={fontsLoaded} />
					</MomentsProvider>
				</AoiThemeProvider>
			</SpaceProvider>
		</SessionProvider>
	);
}

type RootNavigationProps = {
	fontsLoaded: boolean;
};

function RootNavigation({ fontsLoaded }: RootNavigationProps) {
	const {
		status: sessionStatus,
		user,
		isHydrated: isSessionHydrated,
	} = useSession();
	const { status: spaceStatus, space, isHydrated: isSpaceHydrated } = useSpace();
	const { mode, colors, isHydrated } = useAoiTheme();
	const themeName = mode === "dark" ? "dark" : "light";
	const isAndroid = process.env.EXPO_OS === "android";
	const [showLaunchSplash, setShowLaunchSplash] = useState(true);

	const navigationTheme = useMemo(() => {
		const baseTheme = mode === "dark" ? DarkTheme : DefaultTheme;

		return {
			...baseTheme,
			colors: {
				...baseTheme.colors,
				primary: colors.accent,
				background: colors.background,
				card: colors.surface,
				text: colors.text,
				border: colors.border,
				notification: colors.danger,
			},
		};
	}, [colors, mode]);

	useEffect(() => {
		if (!fontsLoaded || !isHydrated) {
			return;
		}

		let isActive = true;
		let splashTimer: ReturnType<typeof setTimeout> | null = null;

		async function hideNativeSplash() {
			await SplashScreen.hideAsync().catch(() => {});
			splashTimer = setTimeout(() => {
				if (isActive) {
					setShowLaunchSplash(false);
				}
			}, 980);
		}

		void hideNativeSplash();

		return () => {
			isActive = false;
			if (splashTimer) {
				clearTimeout(splashTimer);
			}
		};
	}, [fontsLoaded, isHydrated]);

	const relationship = useMemo(() => {
		if (
			sessionStatus !== "signed_in" ||
			spaceStatus !== "ready" ||
			!space ||
			!user
		) {
			return null;
		}

		const relationshipDate = new Date(space.relationshipStartDate);
		const isValidDate = !Number.isNaN(relationshipDate.getTime());

		return {
			youName: user.displayName,
			partnerName: space.partnerName,
			sinceLabel: isValidDate
				? relationshipDate.toLocaleDateString("en-US", {
						month: "long",
						day: "numeric",
						year: "numeric",
				  })
				: "a shared chapter",
		};
	}, [sessionStatus, space, spaceStatus, user]);

	if (
		!fontsLoaded ||
		!isHydrated ||
		!isSessionHydrated ||
		!isSpaceHydrated ||
		showLaunchSplash
	) {
		return (
			<LaunchSplash
				colors={colors}
				relationship={relationship}
				themeName={themeName}
			/>
		);
	}

	return (
		<NavigationThemeProvider value={navigationTheme}>
			<Stack
				screenOptions={{
					contentStyle: { backgroundColor: colors.background },
				}}
			>
				<Stack.Screen
					name="(public)"
					options={{ headerShown: false }}
				/>
				<Stack.Screen name="(auth)" options={{ headerShown: false }} />
				<Stack.Screen name="(app)" options={{ headerShown: false }} />
			</Stack>
			<StatusBar
				backgroundColor={colors.background}
				style={themeName === "dark" ? "light" : "dark"}
				translucent={!isAndroid}
			/>
		</NavigationThemeProvider>
	);
}
