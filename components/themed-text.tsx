import { StyleSheet, Text, type TextProps } from "react-native";

import { Typography } from "@/constants/typography";
import { useThemeColor } from "@/hooks/use-theme-color";

export type ThemedTextProps = TextProps & {
	lightColor?: string;
	darkColor?: string;
	type?: "display" | "title" | "subheading" | "body" | "bodyEmphasis" | "supporting" | "caption" | "label" | "meta" | "link";
};

export function ThemedText({
	style,
	lightColor,
	darkColor,
	type = "body",
	accessibilityRole,
	...rest
}: ThemedTextProps) {
	const textColor = useThemeColor(
		{ light: lightColor, dark: darkColor },
		type === "meta"
			? "textMuted"
			: type === "link"
				? "accent"
				: type === "caption" || type === "supporting" || type === "label"
					? "textSecondary"
					: "textPrimary",
	);

	// Display, title, and subheading are the app's heading levels. Mark them
	// as headers so screen readers can navigate by heading; callers can still
	// override with an explicit accessibilityRole.
	const headingRole =
		type === "display" || type === "title" || type === "subheading"
			? "header"
			: undefined;

	return (
		<Text
			accessibilityRole={accessibilityRole ?? headingRole}
			style={[
				styles.base,
				type === "display" ? styles.display : undefined,
				type === "title" ? styles.title : undefined,
				type === "subheading" ? styles.subheading : undefined,
				type === "body" ? styles.body : undefined,
				type === "bodyEmphasis" ? styles.bodyEmphasis : undefined,
				type === "supporting" ? styles.supporting : undefined,
				type === "caption" ? styles.caption : undefined,
				type === "label" ? styles.label : undefined,
				type === "meta" ? styles.meta : undefined,
				type === "link" ? styles.link : undefined,
				{ color: textColor },
				style,
			]}
			{...rest}
		/>
	);
}

const styles = StyleSheet.create({
	base: {
		includeFontPadding: false,
	},
	display: Typography.display,
	title: Typography.title,
	subheading: {
		...Typography.subheading,
		fontWeight: "600",
	},
	body: Typography.body,
	bodyEmphasis: {
		...Typography.bodyEmphasis,
		fontWeight: "600",
	},
	supporting: Typography.supporting,
	caption: Typography.caption,
	label: {
		...Typography.label,
		fontWeight: "600",
	},
	meta: Typography.meta,
	link: {
		...Typography.link,
		textDecorationLine: "underline",
		textDecorationStyle: "solid",
	},
});
