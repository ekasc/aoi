import { useEffect, type ReactNode } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, {
	Easing,
	FadeInDown,
	ReduceMotion,
	useAnimatedStyle,
	useReducedMotion,
	useSharedValue,
	withRepeat,
	withTiming,
} from "react-native-reanimated";

import { ThemedText } from "@/components/themed-text";
import { GlassSurface } from "@/components/ui/glass-surface";
import { Motion, Spacing } from "@/constants/theme";
import { FontFamilies } from "@/constants/typography";
import { useThemeColor } from "@/hooks/use-theme-color";

type ImmersiveHeroProps = {
	cta: ReactNode;
};

export function ImmersiveHero({ cta }: ImmersiveHeroProps) {
	const { width } = useWindowDimensions();
	const reduceMotion = useReducedMotion();
	const accent = useThemeColor({}, "accent");
	const thread = useThemeColor({}, "thread");
	const border = useThemeColor({}, "border");
	const muted = useThemeColor({}, "muted");
	const text = useThemeColor({}, "text");
	const warmGlow = useThemeColor(
		{
			light: "rgba(232, 138, 112, 0.22)",
			dark: "rgba(232, 138, 112, 0.18)",
		},
		"partnerAccent",
	);
	const coolGlow = useThemeColor(
		{ light: "rgba(94, 212, 204, 0.2)", dark: "rgba(94, 212, 204, 0.16)" },
		"accent",
	);
	const isCompact = width < 390;

	const ambientDriftX = useSharedValue(0);
	const ambientDriftY = useSharedValue(0);
	const ambientDriftSoft = useSharedValue(0);
	const ambientDriftSun = useSharedValue(0);

	useEffect(() => {
		if (reduceMotion) {
			return;
		}

		ambientDriftX.value = withRepeat(
			withTiming(16, {
				duration: 5800,
				easing: Easing.inOut(Easing.sin),
			}),
			-1,
			true,
		);
		ambientDriftY.value = withRepeat(
			withTiming(-14, {
				duration: 5100,
				easing: Easing.inOut(Easing.sin),
			}),
			-1,
			true,
		);
		ambientDriftSoft.value = withRepeat(
			withTiming(10, {
				duration: 6400,
				easing: Easing.inOut(Easing.sin),
			}),
			-1,
			true,
		);
		ambientDriftSun.value = withRepeat(
			withTiming(-8, {
				duration: 7600,
				easing: Easing.inOut(Easing.sin),
			}),
			-1,
			true,
		);
	}, [
		ambientDriftSoft,
		ambientDriftSun,
		ambientDriftX,
		ambientDriftY,
		reduceMotion,
	]);

	const ambientAStyle = useAnimatedStyle(() => ({
		transform: [{ translateX: ambientDriftX.value }],
	}));
	const ambientBStyle = useAnimatedStyle(() => ({
		transform: [{ translateY: ambientDriftY.value }],
	}));
	const ambientCStyle = useAnimatedStyle(() => ({
		transform: [{ translateX: ambientDriftSoft.value }],
	}));
	const ambientSunStyle = useAnimatedStyle(() => ({
		transform: [{ translateY: ambientDriftSun.value }],
	}));

	return (
		<View style={styles.heroWrap}>
			<Animated.View
				style={[
					styles.ambient,
					styles.ambientA,
					ambientAStyle,
					{ backgroundColor: accent },
				]}
			/>
			<Animated.View
				style={[
					styles.ambient,
					styles.sunHalo,
					ambientSunStyle,
					{ backgroundColor: warmGlow },
				]}
			/>
			<Animated.View
				style={[
					styles.ambient,
					styles.ambientB,
					ambientBStyle,
					{ backgroundColor: coolGlow },
				]}
			/>
			<Animated.View
				style={[
					styles.ambient,
					styles.ambientC,
					ambientCStyle,
					{ backgroundColor: thread },
				]}
			/>
			<View style={[styles.horizon, { backgroundColor: border }]} />

			<Animated.View
				entering={FadeInDown.duration(Motion.slow)
					.delay(40)
					.reduceMotion(ReduceMotion.System)}
			>
				<GlassSurface
					effect="regular"
					style={[styles.heroCard, { borderColor: border }]}
				>
					<ThemedText
						type="meta"
						selectable={false}
						style={{ color: muted }}
					>
						Private for two
					</ThemedText>
					<ThemedText
						type="display"
						selectable={false}
						style={[
							styles.display,
							isCompact ? styles.displayCompact : undefined,
						]}
					>
						Aoi
					</ThemedText>
					<ThemedText
						type="title"
						selectable={false}
						style={[
							styles.tagline,
							{ color: text },
							isCompact ? styles.taglineCompact : undefined,
						]}
					>
						The space between the tide and the shore
					</ThemedText>
					<View
						style={[styles.divider, { backgroundColor: border }]}
					/>
					<ThemedText
						type="body"
						selectable={false}
						style={{ color: muted }}
					>
						Keep your plans and memories in one private place.
					</ThemedText>
					<View style={styles.ctaRow}>{cta}</View>
				</GlassSurface>
			</Animated.View>
		</View>
	);
}

const styles = StyleSheet.create({
	heroWrap: {
		position: "relative",
		minHeight: 560,
		justifyContent: "flex-end",
	},
	ambient: {
		position: "absolute",
		borderRadius: 999,
		opacity: 0.14,
	},
	ambientA: {
		width: 340,
		height: 340,
		top: -130,
		right: -96,
	},
	sunHalo: {
		width: 250,
		height: 250,
		top: 24,
		right: 8,
		opacity: 0.24,
	},
	ambientB: {
		width: 340,
		height: 340,
		bottom: -118,
		left: -98,
		opacity: 0.12,
	},
	ambientC: {
		width: 260,
		height: 260,
		top: 180,
		left: 48,
		opacity: 0.1,
	},
	horizon: {
		position: "absolute",
		left: 26,
		right: 26,
		top: 302,
		height: StyleSheet.hairlineWidth,
		opacity: 0.45,
	},
	heroCard: {
		gap: Spacing[12],
		padding: Spacing[24],
		borderRadius: 32,
		borderCurve: "continuous",
		overflow: "hidden",
	},
	glossOverlay: {
		position: "absolute",
		top: 0,
		left: 0,
		right: 0,
		height: 88,
		borderBottomLeftRadius: 24,
		borderBottomRightRadius: 24,
	},
	display: {
		fontFamily: FontFamilies.display,
		fontSize: 52,
		lineHeight: 58,
		letterSpacing: -0.9,
	},
	displayCompact: {
		fontSize: 44,
		lineHeight: 50,
	},
	tagline: {
		fontSize: 27,
		lineHeight: 34,
		letterSpacing: -0.35,
	},
	taglineCompact: {
		fontSize: 24,
		lineHeight: 30,
	},
	divider: {
		height: StyleSheet.hairlineWidth,
		width: "100%",
		marginVertical: 2,
	},
	ctaRow: {
		marginTop: Spacing[4],
		width: "100%",
	},
});
