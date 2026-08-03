import { Stack } from "expo-router/stack";
import * as Notifications from "expo-notifications";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { PropsWithChildren } from "react";

import { LaunchSplash } from "@/components/launch-splash";
import { MomentsProvider } from "@/features/moments/moments-context";
import { SessionProvider, useSession } from "@/features/session/session-context";
import { SpaceProvider, useSpace } from "@/features/space/space-context";
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

// Inline React Navigation theme objects (replacing @react-navigation/native import)
type NavigationColors = {
  primary: string;
  background: string;
  card: string;
  text: string;
  border: string;
  notification: string;
};

type NavigationTheme = {
  dark: boolean;
  colors: NavigationColors;
  fonts: any;
};

const NavigationDefaultTheme: NavigationTheme = {
  dark: false,
  colors: {
    primary: '#007AFF',
    background: '#F2F2F7',
    card: '#FFFFFF',
    text: '#000000',
    border: '#C6C6C8',
    notification: '#FF3B30',
  },
  fonts: {},
};

const NavigationDarkTheme: NavigationTheme = {
  dark: true,
  colors: {
    primary: '#0A84FF',
    background: '#000000',
    card: '#1C1C1E',
    text: '#FFFFFF',
    border: '#38383A',
    notification: '#FF453A',
  },
  fonts: {},
};

const NavigationThemeContext = createContext<NavigationTheme>(NavigationDefaultTheme);

function NavigationThemeProvider({ children, value }: PropsWithChildren<{ value: NavigationTheme }>) {
  return (
    <NavigationThemeContext.Provider value={value}>
      {children}
    </NavigationThemeContext.Provider>
  );
}

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
	const [showLaunchSplash, setShowLaunchSplash] = useState(true);

	const navigationTheme = useMemo(() => {
		const baseTheme = mode === "dark" ? NavigationDarkTheme : NavigationDefaultTheme;

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
				style={themeName === "dark" ? "light" : "dark"}
			/>
		</NavigationThemeProvider>
	);
}
