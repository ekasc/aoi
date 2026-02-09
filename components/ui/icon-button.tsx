import { useMemo } from "react";
import {
	Pressable,
	StyleSheet,
	type PressableProps,
	type ViewStyle,
} from "react-native";

import { Radii } from "@/constants/theme";
import { useThemeColor } from "@/hooks/use-theme-color";
import { Text } from "@react-navigation/elements";

type IconButtonVariant = "accent" | "secondary" | "ghost" | "accentSecondary";

export type IconButtonProps = Omit<PressableProps, "style"> & {
	label: string;
	variant?: IconButtonVariant;
};

type VariantStyles = {
	container: ViewStyle;
};

export function IconButton({
	children,
	label,
	variant = "accent",
	disabled,
	accessibilityLabel,
	...rest
}: IconButtonProps) {
	const accent = useThemeColor({}, "accent");
	const onAccent = useThemeColor({}, "onAccent");
	const surface = useThemeColor({}, "surface");
	const border = useThemeColor({}, "border");

	const variantStyles = useMemo<Record<IconButtonVariant, VariantStyles>>(
		() => ({
			accent: {
				container: {
					backgroundColor: accent,
					borderColor: accent,
				},
			},
			secondary: {
				container: {
					backgroundColor: surface,
					borderColor: border,
				},
			},
			ghost: {
				container: {
					backgroundColor: "transparent",
					borderColor: "transparent",
				},
			},
			accentSecondary: {
				container: {
					backgroundColor: onAccent,
					borderColor: accent,
				},
			},
		}),
		[accent, border, onAccent, surface],
	);

	const currentVariant = variantStyles[variant];

	return (
		<Pressable
			accessibilityLabel={accessibilityLabel ?? label}
			accessibilityRole="button"
			disabled={disabled}
			style={({ pressed }) => [
				styles.base,
				currentVariant.container,
				pressed && !disabled ? styles.pressed : undefined,
				disabled ? styles.disabled : undefined,
			]}
			{...rest}
		>
			<Text style={{ fontSize: 25 }}>{`${children}`}</Text>
		</Pressable>
	);
}

const styles = StyleSheet.create({
	base: {
		minHeight: 44,
		minWidth: 44,
		width: 44,
		borderRadius: Radii.pill,
		borderWidth: StyleSheet.hairlineWidth,
		alignItems: "center",
		justifyContent: "center",
	},
	pressed: {
		opacity: 0.92,
		transform: [{ translateY: 1 }],
	},
	disabled: {
		opacity: 0.55,
	},
});
