import * as AppleAuthentication from "expo-apple-authentication";
import { Image } from "expo-image";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	Pressable,
	StyleSheet,
	Text,
	View,
	type PressableStateCallbackType,
	type ViewStyle,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import type { AuthProvider } from "@/features/auth/types";
import { useSession } from "@/features/session/session-context";
import { useThemeColor } from "@/hooks/use-theme-color";

const GOOGLE_G_MARK_URI =
	"https://developers.google.com/identity/images/g-logo.png";
const GOOGLE_TEXT_COLOR = "#1F1F1F";
const GOOGLE_BORDER_COLOR = "#DADCE0";

type ProviderAuthActionsProps = {
	onSuccess?: () => void;
};

export function ProviderAuthActions({ onSuccess }: ProviderAuthActionsProps) {
	const { signInWithProvider, status } = useSession();
	const [activeProvider, setActiveProvider] = useState<AuthProvider | null>(
		null,
	);
	const [error, setError] = useState("");
	const [isAppleNativeAvailable, setIsAppleNativeAvailable] = useState(false);
	const [hasGoogleIconError, setHasGoogleIconError] = useState(false);
	const muted = useThemeColor({}, "muted");
	const danger = useThemeColor({}, "danger");

	useEffect(() => {
		let isActive = true;

		void AppleAuthentication.isAvailableAsync()
			.then((isAvailable) => {
				if (isActive) {
					setIsAppleNativeAvailable(isAvailable);
				}
			})
			.catch(() => {
				if (isActive) {
					setIsAppleNativeAvailable(false);
				}
			});

		return () => {
			isActive = false;
		};
	}, []);

	const handleSignIn = useCallback(
		async (provider: AuthProvider) => {
			setError("");
			setActiveProvider(provider);

			const result = await signInWithProvider(provider);
			setActiveProvider(null);

			if (!result.ok) {
				setError(result.error ?? "Unable to sign in right now.");
				return;
			}

			onSuccess?.();
		},
		[onSuccess, signInWithProvider],
	);

	const isLoading = status === "loading" || activeProvider !== null;
	const helperText = useMemo(() => {
		if (error) {
			return error;
		}

		if (activeProvider === "apple") {
			return "Connecting to Apple…";
		}

		if (activeProvider === "google") {
			return "Connecting to Google…";
		}

		return "Private sign in. No public profile.";
	}, [activeProvider, error]);

	const googleButtonStyle = useCallback(
		({ pressed }: PressableStateCallbackType): ViewStyle[] => [
			styles.googleButton,
			pressed ? styles.pressed : styles.resting,
			isLoading ? styles.disabled : styles.resting,
		],
		[isLoading],
	);

	return (
		<View style={styles.root}>
			{isAppleNativeAvailable ? (
				<View style={isLoading ? styles.disabled : styles.resting}>
					<AppleAuthentication.AppleAuthenticationButton
						accessibilityLabel="Continue with Apple"
						buttonStyle={
							AppleAuthentication.AppleAuthenticationButtonStyle
								.BLACK
						}
						buttonType={
							AppleAuthentication.AppleAuthenticationButtonType
								.CONTINUE
						}
						cornerRadius={24}
						onPress={() => {
							if (isLoading) {
								return;
							}
							void handleSignIn("apple");
						}}
						style={styles.appleNativeButton}
					/>
				</View>
			) : (
				<Pressable
					accessibilityLabel="Continue with Apple"
					accessibilityRole="button"
					disabled={isLoading}
					onPress={() => {
						void handleSignIn("apple");
					}}
					style={({ pressed }) => [
						styles.appleFallbackButton,
						pressed ? styles.pressed : styles.resting,
						isLoading ? styles.disabled : styles.resting,
					]}
				>
					<Image
						accessibilityElementsHidden
						contentFit="contain"
						source="sf:apple.logo"
						style={styles.appleIcon}
					/>
					<Text style={styles.appleLabel}>Continue with Apple</Text>
				</Pressable>
			)}

			<Pressable
				accessibilityLabel="Continue with Google"
				accessibilityRole="button"
				disabled={isLoading}
				onPress={() => {
					void handleSignIn("google");
				}}
				style={googleButtonStyle}
			>
				{!hasGoogleIconError ? (
					<Image
						accessibilityElementsHidden
						contentFit="contain"
						onError={() => setHasGoogleIconError(true)}
						source={GOOGLE_G_MARK_URI}
						style={styles.googleIcon}
					/>
				) : (
					<Text style={styles.googleFallbackIcon}>G</Text>
				)}
				<Text style={styles.googleLabel}>Continue with Google</Text>
			</Pressable>

			<ThemedText
				accessibilityRole={error ? "alert" : undefined}
				type="caption"
				style={{ color: error ? danger : muted }}
			>
				{helperText}
			</ThemedText>
		</View>
	);
}

const styles = StyleSheet.create({
	root: {
		width: "100%",
		gap: Spacing[8],
	},
	appleNativeButton: {
		width: "100%",
		height: 50,
	},
	appleFallbackButton: {
		minHeight: 50,
		borderRadius: 24,
		backgroundColor: "#000000",
		alignItems: "center",
		justifyContent: "center",
		flexDirection: "row",
		gap: 8,
		paddingHorizontal: 16,
	},
	appleIcon: {
		width: 16,
		height: 16,
		tintColor: "#FFFFFF",
	},
	appleLabel: {
		color: "#FFFFFF",
		fontSize: 16,
		fontWeight: "600",
	},
	googleButton: {
		minHeight: 50,
		borderRadius: 24,
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: GOOGLE_BORDER_COLOR,
		backgroundColor: "#FFFFFF",
		alignItems: "center",
		justifyContent: "center",
		flexDirection: "row",
		gap: 10,
		paddingHorizontal: 16,
	},
	googleIcon: {
		width: 18,
		height: 18,
	},
	googleFallbackIcon: {
		color: "#4285F4",
		fontSize: 17,
		fontWeight: "700",
	},
	googleLabel: {
		color: GOOGLE_TEXT_COLOR,
		fontSize: 16,
		fontWeight: "600",
	},
	resting: {
		opacity: 1,
	},
	pressed: {
		opacity: 0.88,
		transform: [{ translateY: 1 }],
	},
	disabled: {
		opacity: 0.55,
	},
});
