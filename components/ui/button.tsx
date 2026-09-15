import { useMemo } from "react";
import {
	Pressable,
	StyleSheet,
	type PressableProps,
	type TextStyle,
	type ViewStyle,
} from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import { Radii } from "@/constants/theme";
import { ThemedText } from "@/components/themed-text";
import { useThemeColor } from "@/hooks/use-theme-color";

type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
type ButtonSize = "sm" | "md";

export type ButtonProps = Omit<PressableProps, "style"> & {
	label: string;
	variant?: ButtonVariant;
	size?: ButtonSize;
};

type VariantStyles = {
	container: ViewStyle;
	label: TextStyle;
	pressedContainer?: ViewStyle;
};

export function Button({
	label,
	variant = "primary",
	size = "md",
	disabled,
	accessibilityLabel,
	...rest
}: ButtonProps) {
	const primary = useThemeColor({}, "primary");
	const primaryPressed = useThemeColor({}, "primaryPressed");
	const primaryText = useThemeColor({}, "primaryText");
	const borderStrong = useThemeColor({}, "borderStrong");
	const textPrimary = useThemeColor({}, "textPrimary");
	const destructive = useThemeColor({}, "destructive");
	const disabledColor = useThemeColor({}, "disabled");
	const reduceMotion = useReducedMotion();

	const variantStyles = useMemo<Record<ButtonVariant, VariantStyles>>(
		() => ({
			primary: {
				container: {
					backgroundColor: primary,
					borderColor: primary,
				},
				label: { color: primaryText },
				pressedContainer: { backgroundColor: primaryPressed },
			},
			secondary: {
				container: {
					backgroundColor: "transparent",
					borderColor: borderStrong,
				},
				label: { color: textPrimary },
			},
			ghost: {
				container: {
					backgroundColor: "transparent",
					borderColor: "transparent",
				},
				label: { color: primary },
			},
			destructive: {
				container: {
					backgroundColor: "transparent",
					borderColor: destructive,
				},
				label: { color: destructive },
			},
		}),
		[primary, primaryPressed, primaryText, borderStrong, textPrimary, destructive],
	);

	const currentVariant = variantStyles[variant];
	const isDisabled = Boolean(disabled);

	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={accessibilityLabel ?? label}
			disabled={disabled}
			style={({ pressed }) => [
				styles.base,
				size === "sm" ? styles.sm : styles.md,
				currentVariant.container,
				pressed && !isDisabled && currentVariant.pressedContainer
					? currentVariant.pressedContainer
					: undefined,
				pressed && !isDisabled ? styles.pressed : undefined,
				pressed && !isDisabled && !reduceMotion ? styles.pressedScale : undefined,
				isDisabled ? styles.disabled : undefined,
			]}
			{...rest}
		>
			<ThemedText
				type="bodyEmphasis"
				style={[currentVariant.label, isDisabled ? { color: disabledColor } : undefined]}
			>
				{label}
			</ThemedText>
		</Pressable>
	);
}

const styles = StyleSheet.create({
	base: {
		minHeight: 44,
		minWidth: 44,
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: Radii.md,
		borderCurve: "continuous",
		alignItems: "center",
		justifyContent: "center",
	},
	sm: {
		paddingHorizontal: 14,
		paddingVertical: 10,
	},
	md: {
		paddingHorizontal: 16,
		paddingVertical: 12,
	},
	pressed: {
		opacity: 0.92,
	},
	pressedScale: {
		transform: [{ scale: 0.97 }],
	},
	disabled: {
		opacity: 0.55,
	},
});
