import { useRouter } from "expo-router";
import { useCallback } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { useSession } from "@/features/session/session-context";
import { useThemeColor } from "@/hooks/use-theme-color";

/**
 * Consistent entry to the Space/account surface from Story, Together, and
 * Plans. Shows the signed-in user's initial; Space itself is never a tab.
 */
export function SpaceAvatarButton() {
	const router = useRouter();
	const { user } = useSession();
	const borderStrong = useThemeColor({}, "borderStrong");
	const surface2 = useThemeColor({}, "surface2");
	const textPrimary = useThemeColor({}, "textPrimary");

	const rawName = user?.displayName?.trim() || user?.email?.trim() || "?";
	const initial = rawName.charAt(0).toUpperCase();

	const handlePress = useCallback(() => {
		// withAnchor loads the (tabs) anchor beneath Space. Space is a detail
		// hoisted above the tabs, so without this it becomes the first (and
		// only) route in the (app) stack when opened directly — a deep link or
		// the dev preview — and the native header renders no back button.
		router.push("/(app)/space", { withAnchor: true });
	}, [router]);

	return (
		<Pressable
			accessibilityLabel="Open Space settings"
			accessibilityRole="button"
			onPress={handlePress}
			style={styles.touchTarget}
		>
			<View
				style={[
					styles.avatar,
					{ borderColor: borderStrong, backgroundColor: surface2 },
				]}
			>
				<ThemedText type="body" style={{ color: textPrimary }}>
					{initial}
				</ThemedText>
			</View>
		</Pressable>
	);
}

const styles = StyleSheet.create({
	touchTarget: {
		width: 44,
		height: 44,
		alignItems: "center",
		justifyContent: "center",
	},
	avatar: {
		width: 36,
		height: 36,
		borderRadius: 18,
		borderWidth: StyleSheet.hairlineWidth,
		alignItems: "center",
		justifyContent: "center",
	},
});
