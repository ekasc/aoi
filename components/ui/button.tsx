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
import { FontFamilies } from "@/constants/typography";
import { ThemedText } from "@/components/themed-text";
import { Pressed } from "@/components/ui/pressed";
import { useAoiTheme } from "@/features/theme/theme-context";
import { useThemeColor } from "@/hooks/use-theme-color";

type ButtonVariant = "primary" | "secondary" | "muted" | "ghost" | "destructive";
type ButtonSize = "sm" | "md";

/**
 * What the button is standing on.
 *
 * `sky` dresses it in the dark half of the theme, the same rule the landing
 * and sign-in follow: a control on the night backdrop is always dressed for
 * night, whatever the system scheme is doing. The colour math is identical,
 * only the half of the palette changes.
 */
export type ButtonTone = "paper" | "sky";

export type ButtonProps = Omit<PressableProps, "style"> & {
	label: string;
	variant?: ButtonVariant;
	size?: ButtonSize;
	tone?: ButtonTone;
	/**
	 * Announce a label that changes in place, for a button whose label reports
	 * state. A copy button that becomes "Code copied" is a new thing to a screen
	 * reader, not a quiet repaint of the old one.
	 */
	accessibilityLiveRegion?: PressableProps["accessibilityLiveRegion"];
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
	tone = "paper",
	disabled,
	accessibilityLabel,
	accessibilityLiveRegion,
	...rest
}: ButtonProps) {
	const onSky = tone === "sky";
	// Only read for the sky: half the palette is not needed to dress a button
	// that is standing on paper.
	const { selectedTheme } = useAoiTheme();
	const half = onSky ? selectedTheme.dark : null;
	const themedPrimary = useThemeColor({}, "primary");
	const themedPrimaryPressed = useThemeColor({}, "primaryPressed");
	const themedPrimaryText = useThemeColor({}, "primaryText");
	const themedBorderStrong = useThemeColor({}, "borderStrong");
	const themedTextPrimary = useThemeColor({}, "textPrimary");
	const themedDestructive = useThemeColor({}, "destructive");
	const themedDisabled = useThemeColor({}, "disabled");
	const themedSurface2 = useThemeColor({}, "surface2");
	const primary = half ? half.primary : themedPrimary;
	const primaryPressed = half ? half.primaryPressed : themedPrimaryPressed;
	const primaryText = half ? half.primaryText : themedPrimaryText;
	const borderStrong = half ? half.borderStrong : themedBorderStrong;
	const textPrimary = half ? half.textPrimary : themedTextPrimary;
	const destructive = half ? half.destructive : themedDestructive;
	const disabledColor = half ? half.disabled : themedDisabled;
	const surface2 = half ? half.surface2 : themedSurface2;
	const reduceMotion = useReducedMotion();

	// A disabled primary must not keep the full-strength fill dimmed: a
	// translucent accent still reads as that accent, loud at any opacity.
	// The fill itself fades to a whisper of the primary over whatever it
	// stands on, so the button reads as "not now" rather than "blue, but
	// ignore me". The label takes the theme's disabled ink, which keeps the
	// whole control muted in one gesture.
	const disabledFill = withAlpha(primary, 0.16);

	const variantStyles = useMemo<Record<ButtonVariant, VariantStyles>>(
		() => ({
			primary: {
				container: {
					backgroundColor: primary,
					borderColor: "transparent",
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
			/**
			 * A quiet action with a surface under it, for when transparent reads
			 * as absent. Secondary is an outline; on a photograph or a night sky
			 * an outline is nearly invisible, which is the wrong affordance for
			 * the one thing the reader has to send.
			 */
			muted: {
				container: {
					backgroundColor: surface2,
					borderColor: "transparent",
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
		[primary, primaryPressed, primaryText, borderStrong, textPrimary, destructive, surface2],
	);

	const currentVariant = variantStyles[variant];
	const isDisabled = Boolean(disabled);
	// Primary is the one variant whose fill carries the accent, so it needs
	// its own muted fill rather than a dim of the loud one.
	const isDisabledPrimary = isDisabled && variant === "primary";

	return (
		<Pressable
			accessibilityRole="button"
			// The label is the accessible name and it changes in place, so a
			// button whose label reports state (a copy button becoming
			// "Code copied") would otherwise be silent to a screen reader.
			accessibilityLiveRegion={accessibilityLiveRegion}
			accessibilityLabel={accessibilityLabel ?? label}
			disabled={disabled}
			style={({ pressed }) => [
				styles.base,
				size === "sm" ? styles.sm : styles.md,
				currentVariant.container,
				isDisabledPrimary
					// Muted wash of the accent, at full opacity — dimming it on
					// top would wash the wash out to nothing.
					? { backgroundColor: disabledFill, borderColor: "transparent" }
					: undefined,
				pressed && !isDisabled && currentVariant.pressedContainer
					? currentVariant.pressedContainer
					: undefined,
				pressed && !isDisabled ? Pressed.at : undefined,
				pressed && !isDisabled && !reduceMotion ? Pressed.scaled : undefined,
				// The muted primary fill already reads as inactive; the global
				// dim is for every other variant's disabled state.
				isDisabled && !isDisabledPrimary ? styles.disabled : undefined,
			]}
			{...rest}
		>
			<ThemedText
				numberOfLines={1}
				style={[
					styles.label,
					size === "sm" ? styles.labelSm : styles.labelMd,
					currentVariant.label,
					isDisabled ? { color: disabledColor } : undefined,
				]}
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
		// A pill, not a rounded rectangle. Ten points of radius on a hairline
		// border is Material's shape with aoi's colours in it; a full round
		// reads as a stamp, which is what this app's controls should look like.
		borderRadius: Radii.pill,
		borderCurve: "continuous",
		alignItems: "center",
		justifyContent: "center",
	},
	label: {
		// Body, not display: buttons must never inherit a future display
		// face (see typography P9A). All three keys resolve to the same
		// system sans today, so this changes nothing visually; it pins
		// the contract for when a display face is procured.
		fontFamily: FontFamilies.body,
	},
	labelMd: {
		fontSize: 18,
		lineHeight: 24,
		letterSpacing: 0.1,
	},
	labelSm: {
		fontSize: 15,
		lineHeight: 21,
		letterSpacing: 0.15,
	},
	sm: {
		paddingHorizontal: 14,
		paddingVertical: 10,
	},
	md: {
		paddingHorizontal: 20,
		paddingVertical: 12,
	},
	disabled: {
		opacity: 0.55,
	},
});

/**
 * Fades a #RRGGBB token toward whatever the button stands on. Every theme
 * token is a six-digit hex colour; anything else falls back to the opaque
 * colour rather than guessing.
 */
function withAlpha(hex: string, alpha: number): string {
	if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
		return hex;
	}
	const a = Math.round(Math.min(Math.max(alpha, 0), 1) * 255)
		.toString(16)
		.padStart(2, "0");
	return `${hex}${a}`;
}
