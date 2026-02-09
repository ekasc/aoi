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
import { SessionProvider } from "@/features/session/session-context";
import { AoiThemeProvider, useAoiTheme } from "@/features/theme/theme-context";
import { useAoiFonts } from "@/hooks/use-aoi-fonts";

void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
	const { fontsLoaded } = useAoiFonts();

	return (
		<SessionProvider>
			<AoiThemeProvider>
				<RootNavigation fontsLoaded={fontsLoaded} />
			</AoiThemeProvider>
		</SessionProvider>
	);
}

type RootNavigationProps = {
	fontsLoaded: boolean;
};

function RootNavigation({ fontsLoaded }: RootNavigationProps) {
	const { mode, colors, isHydrated } = useAoiTheme();
	const themeName = mode === "dark" ? "dark" : "light";
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

	if (!fontsLoaded || !isHydrated || showLaunchSplash) {
		return <LaunchSplash colors={colors} themeName={themeName} />;
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
			<StatusBar style={themeName === "dark" ? "light" : "dark"} />
		</NavigationThemeProvider>
	);
}
