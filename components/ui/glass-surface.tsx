import { GlassView } from "expo-glass-effect";
import { AppState, StyleSheet, View, type ViewProps } from "react-native";
import { useEffect, useState } from "react";

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
		"surface",
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
	const tintColor = useThemeColor(
		{
			light: "rgba(255, 255, 255, 0.3)",
			dark: "rgba(255, 255, 255, 0.18)",
		},
		"surface",
	);
	const isIos = process.env.EXPO_OS === "ios";
	const [glassRenderVersion, setGlassRenderVersion] = useState(0);

	useEffect(() => {
		if (!isIos) {
			return;
		}

		const startupRefresh = setTimeout(() => {
			setGlassRenderVersion((current) => current + 1);
		}, 140);
		const delayedRefresh = setTimeout(() => {
			setGlassRenderVersion((current) => current + 1);
		}, 900);

		const subscription = AppState.addEventListener("change", (state) => {
			if (state === "active") {
				setGlassRenderVersion((current) => current + 1);
			}
		});

			return () => {
				clearTimeout(startupRefresh);
				clearTimeout(delayedRefresh);
				subscription.remove();
			};
		}, [isIos]);

	if (isIos) {
		return (
			<GlassView
				key={`glass-${effect}-${glassRenderVersion}`}
				glassEffectStyle={effect}
				style={[
					styles.base,
					{
						borderColor: border,
						backgroundColor: iosBacking,
					},
					style,
				]}
				tintColor={tintColor}
				{...rest}
			>
				{children}
			</GlassView>
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
