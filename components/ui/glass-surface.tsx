import { GlassView } from "expo-glass-effect";
import { StyleSheet, View, type ViewProps } from "react-native";

import { AndroidGlassSurface } from "@/components/ui/android-glass-surface";
import { useThemeColor } from "@/hooks/use-theme-color";

export type GlassSurfaceProps = ViewProps & {
	effect?: "regular" | "clear";
};

export function GlassSurface({
	children,
	style,
	effect = "regular",
	...rest
}: GlassSurfaceProps) {
	const border = useThemeColor({}, "border");
	const surface = useThemeColor({}, "surface");
	const iosBacking = useThemeColor(
		{
			light: "rgba(255, 255, 255, 0.16)",
			dark: "rgba(10, 10, 10, 0.24)",
		},
		"background",
	);
	const fallbackBackground = useThemeColor(
		effect === "clear"
			? {
					light: "rgba(255, 255, 255, 0.94)",
					dark: "rgba(34, 28, 22, 0.9)",
				}
			: { light: surface, dark: surface },
		"background",
	);
	const isIos = process.env.EXPO_OS === "ios";
	const isAndroid = process.env.EXPO_OS === "android";

	if (isIos) {
		return (
			<GlassView
				isInteractive
				glassEffectStyle={effect}
				style={[
					styles.base,
					{
						borderColor: border,
						backgroundColor: iosBacking,
					},
					style,
				]}
				{...rest}
			>
				{children}
			</GlassView>
		);
	}

	if (isAndroid) {
		return (
			<AndroidGlassSurface effect={effect} style={[styles.base, style]} {...rest}>
				{children}
			</AndroidGlassSurface>
		);
	}

	return (
		<View
			style={[
				styles.base,
				{
					borderColor: border,
					backgroundColor: fallbackBackground,
				},
				style,
			]}
			{...rest}
		>
			{children}
		</View>
	);
}

const styles = StyleSheet.create({
	base: {
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: 28,
		borderCurve: "continuous",
		overflow: "hidden",
	},
});
