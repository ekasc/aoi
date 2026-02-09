import { useMemo } from "react";
import {
	Pressable,
	StyleSheet,
	type PressableProps,
	type TextStyle,
	type ViewStyle,
} from "react-native";

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
};

export function Button({
	label,
	variant = "primary",
	size = "md",
	disabled,
	accessibilityLabel,
	...rest
}: ButtonProps) {
	const accent = useThemeColor({}, "accent");
	const onAccent = useThemeColor({}, "onAccent");
	const surface = useThemeColor({}, "surface");
	const border = useThemeColor({}, "border");
	const text = useThemeColor({}, "text");
	const danger = useThemeColor({}, "danger");
	const onDanger = useThemeColor({}, "onDanger");

	const variantStyles = useMemo<Record<ButtonVariant, VariantStyles>>(
		() => ({
			primary: {
				container: {
					backgroundColor: accent,
					borderColor: accent,
				},
				label: { color: onAccent },
			},
			secondary: {
				container: {
					backgroundColor: surface,
					borderColor: border,
				},
				label: { color: text },
			},
			ghost: {
				container: {
					backgroundColor: "transparent",
					borderColor: "transparent",
				},
				label: { color: text },
			},
			destructive: {
				container: {
					backgroundColor: danger,
					borderColor: danger,
				},
				label: { color: onDanger },
			},
		}),
		[accent, border, danger, onAccent, onDanger, surface, text],
	);

	const currentVariant = variantStyles[variant];

	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={accessibilityLabel ?? label}
			disabled={disabled}
			style={({ pressed }) => [
				styles.base,
				size === "sm" ? styles.sm : styles.md,
				currentVariant.container,
				pressed && !disabled ? styles.pressed : undefined,
				disabled ? styles.disabled : undefined,
			]}
			{...rest}
		>
			<ThemedText
				type="body"
				style={[styles.label, currentVariant.label]}
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
		borderRadius: Radii.pill,
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
		transform: [{ translateY: 1 }],
	},
	disabled: {
		opacity: 0.55,
	},
	label: {
		fontWeight: "600",
	},
});
