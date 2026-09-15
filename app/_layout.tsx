import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router/react-navigation";
import { Stack } from "expo-router/stack";
import * as Notifications from "expo-notifications";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";

import { LaunchSplash } from "@/components/launch-splash";
import { DebugHarness } from "@/components/dev/debug-harness";
import { ensureDevSeed } from "@/features/dev/dev-seed";
import { MomentsProvider } from "@/features/moments/moments-context";
import { SessionProvider, useSession } from "@/features/session/session-context";
import { SpaceProvider, useSpace } from "@/features/space/space-context";
import { SubscriptionProvider } from "@/features/subscription/subscription-context";
import { AoiThemeProvider, useAoiTheme } from "@/features/theme/theme-context";
import { useAoiFonts } from "@/hooks/use-aoi-fonts";

void SplashScreen.preventAutoHideAsync().catch(() => {});

// Memories arrive quietly: show banners when the app is open, never sound.
Notifications.setNotificationHandler({
	handleNotification: async () => ({
		shouldShowBanner: true,
		shouldShowList: true,
		shouldPlaySound: false,
		shouldSetBadge: false,
	}),
});

// React Navigation's own theme provider (imported via expo-router since
// SDK 56 forbids `@react-navigation/*` imports in app code), fed from Aoi's
// theme context so headers, sheets, and modals use the app's colors and
// fonts instead of the system defaults.
export default function RootLayout() {
	const { fontsLoaded } = useAoiFonts();
	// Dev-only: write the seeded session/space BEFORE the providers hydrate,
	// so the real app tree boots signed in with the mock world. Resolves
	// immediately when EXPO_PUBLIC_DEV_SEED is unset.
	const [seedReady, setSeedReady] = useState(false);

	useEffect(() => {
		let cancelled = false;
		void ensureDevSeed().finally(() => {
			if (!cancelled) {
				setSeedReady(true);
			}
		});
		return () => {
			cancelled = true;
		};
	}, []);

	if (!seedReady) {
		return null;
	}

	return (
		<SessionProvider>
			<SpaceProvider>
				<AoiThemeProvider>
					<SubscriptionProvider>
						<MomentsProvider>
							<RootNavigation fontsLoaded={fontsLoaded} />
						</MomentsProvider>
					</SubscriptionProvider>
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
		isHydrated: isSessionHydrated,
	} = useSession();
	const { isHydrated: isSpaceHydrated } = useSpace();
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

	if (
		!fontsLoaded ||
		!isHydrated ||
		!isSessionHydrated ||
		!isSpaceHydrated ||
		showLaunchSplash
	) {
		return <LaunchSplash />;
	}

	return (
		<ThemeProvider value={navigationTheme}>
			<DebugHarness>
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
					<Stack.Screen
						name="dev-story"
						options={{ headerShown: false }}
					/>
					<Stack.Screen
						name="dev-chapter"
						options={{ headerShown: false }}
					/>
					<Stack.Screen
						name="dev-composer"
						options={{ headerShown: false }}
					/>
				</Stack>
				<StatusBar
					style={themeName === "dark" ? "light" : "dark"}
				/>
			</DebugHarness>
		</ThemeProvider>
	);
}
