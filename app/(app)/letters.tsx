import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Stack, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	AppState,
	ActivityIndicator,
	Pressable,
	ScrollView,
	StyleSheet,
	View,
} from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LetterCard } from "@/components/letters/letter-card";
import { ThemedText } from "@/components/themed-text";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { Motion, Radii, Spacing } from "@/constants/theme";
import { useLetters } from "@/features/letters/letters-context";
import {
	formatOpensInLabel,
	isLetterReadyToOpen,
} from "@/features/letters/letter-time";
import type { Letter } from "@/features/letters/types";
import { useThemeColor } from "@/hooks/use-theme-color";

// The reveal: a gentle fade, nothing louder than Motion.slow.
const SHELF_ANIMATION = FadeIn.duration(Motion.slow).reduceMotion(
	ReduceMotion.System,
);

// How often the shelf re-derives "Opens in…" labels while letters wait.
const SHELF_TICK_MS = 20_000;

/**
 * The letters shelf. Sealed letters render as quiet closed cards — their
 * words are never shown (the body is not even here until a letter is opened,
 * for the author too). When one is due, tapping it opens it with a soft
 * fade and the words finally appear.
 */
export default function LettersScreen() {
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const { letters, isLoading, error, openLetter, reload } = useLetters();
	const accent = useThemeColor({}, "accent");
	const background = useThemeColor({}, "background");
	const muted = useThemeColor({}, "muted");
	const [now, setNow] = useState(() => new Date());
	const [hint, setHint] = useState<string | null>(null);
	const [isOpeningId, setIsOpeningId] = useState<string | null>(null);

	// Time passes even while the shelf is open: re-derive readiness and the
	// "Opens in…" labels quietly. The server/local repo stays the authority
	// on whether a letter may actually open.
	useEffect(() => {
		const tick = () => setNow(new Date());
		const interval = setInterval(tick, SHELF_TICK_MS);
		const subscription = AppState.addEventListener("change", (state) => {
			if (state === "active") {
				tick();
			}
		});

		return () => {
			clearInterval(interval);
			subscription.remove();
		};
	}, []);

	const handlePress = useCallback(
		(letter: Letter) => {
			setHint(null);

			if (!isLetterReadyToOpen(letter, now)) {
				setHint(`Not yet time. ${formatOpensInLabel(letter.sealedUntil, now)}.`);
				return;
			}

			setIsOpeningId(letter.id);
			void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

			void openLetter(letter.id)
				.then(() => {
					setIsOpeningId(null);
				})
				.catch((openError: unknown) => {
					setIsOpeningId(null);
					const message =
						openError instanceof Error ? openError.message : "";
					if (message === "Not yet time") {
						setHint(
							`Not yet time. ${formatOpensInLabel(letter.sealedUntil, new Date())}.`,
						);
					} else {
						setHint("That letter couldn't be opened right now.");
					}
				});
		},
		[now, openLetter],
	);

	const handleWrite = useCallback(() => {
		router.push("/(app)/letter/new");
	}, [router]);

	const contentContainerStyle = useMemo(
		() => [
			styles.contentContainer,
			{
				paddingTop: Spacing[16],
				paddingBottom: insets.bottom + Spacing[24],
			},
		],
		[insets.bottom],
	);

	return (
		<ScrollView
			contentContainerStyle={contentContainerStyle}
			contentInsetAdjustmentBehavior="never"
			showsVerticalScrollIndicator={false}
			style={{ backgroundColor: background }}
		>
			<Stack.Screen options={{ title: "Letters" }} />
			<View style={styles.headerRow}>
				<ThemedText style={styles.intro} type="caption">
					Sealed for a future day. Once sealed, a letter waits — even for
					you.
				</ThemedText>
				<Pressable
					accessibilityLabel="Write a letter"
					accessibilityRole="button"
					hitSlop={Spacing[8]}
					onPress={handleWrite}
					style={[styles.writeButton, { borderColor: accent }]}
				>
					<Ionicons color={accent} name="create-outline" size={18} />
					<ThemedText style={{ color: accent }} type="meta">
						Write
					</ThemedText>
				</Pressable>
			</View>

			{hint ? (
				<ThemedText style={{ color: muted }} type="caption">
					{hint}
				</ThemedText>
			) : null}

			{isLoading && letters.length === 0 ? (
				<View style={styles.center}>
					<ActivityIndicator color={accent} />
				</View>
			) : error && letters.length === 0 ? (
				<Surface style={styles.emptyCard}>
					<ThemedText style={{ color: muted }} type="caption">
						{error}
					</ThemedText>
					<View style={styles.retrySpacer} />
					<Button
						label="Try again"
						onPress={() => void reload()}
						variant="secondary"
					/>
				</Surface>
			) : letters.length === 0 ? (
				<Surface style={styles.emptyCard}>
					<ThemedText style={{ color: muted }} type="caption">
						No letters yet. Write one for a future day — for the two of
						you.
					</ThemedText>
				</Surface>
			) : (
				letters.map((letter) => (
					<Animated.View
						entering={SHELF_ANIMATION}
						key={`${letter.id}-${letter.isOpened ? "opened" : "sealed"}`}
						style={isOpeningId === letter.id ? styles.opening : undefined}
					>
						<LetterCard
							letter={letter}
							now={now}
							onPress={letter.isOpened ? undefined : handlePress}
						/>
					</Animated.View>
				))
			)}
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	contentContainer: {
		gap: Spacing[12],
		paddingHorizontal: Spacing[16],
	},
	headerRow: {
		alignItems: "center",
		flexDirection: "row",
		gap: Spacing[12],
	},
	intro: {
		flex: 1,
	},
	writeButton: {
		alignItems: "center",
		borderRadius: Radii.pill,
		borderWidth: 1,
		flexDirection: "row",
		gap: Spacing[4],
		minHeight: 40,
		justifyContent: "center",
		paddingHorizontal: Spacing[12],
	},
	center: {
		alignItems: "center",
		justifyContent: "center",
		paddingVertical: Spacing[40],
	},
	emptyCard: {
		gap: Spacing[4],
		padding: Spacing[16],
	},
	retrySpacer: {
		height: Spacing[8],
	},
	// A brief hush while the seal breaks.
	opening: {
		opacity: 0.7,
	},
});
