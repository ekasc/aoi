import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Stack, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	AppState,
	Pressable,
	ScrollView,
	StyleSheet,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LetterCard } from "@/components/letters/letter-card";
import { ThemedText } from "@/components/themed-text";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { Radii, Spacing, withAlpha } from "@/constants/theme";
import { useLetters } from "@/features/letters/letters-context";
import {
	formatOpensInLabel,
	isLetterReadyToOpen,
} from "@/features/letters/letter-time";
import type { Letter } from "@/features/letters/types";
import { useThemeColor } from "@/hooks/use-theme-color";
import { relationshipCopy } from "@/features/relationship/relationship-age";
import { useRelationshipAge } from "@/features/relationship/use-relationship-age";
import { useSpace } from "@/features/space/space-context";

// How often the shelf re-derives "Opens in…" labels while letters wait.
const SHELF_TICK_MS = 20_000;

/**
 * The letters shelf. Sealed and opened letters render as quiet closed
 * metadata — their words are never shown here (the body is not even here
 * until a letter is opened, for the author too). When one is due, tapping
 * it opens it through the server and then moves to the dedicated reader,
 * where the words finally appear.
 */
export default function LettersScreen() {
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const { letters, isLoading, error, openLetter, reload } = useLetters();
	const { space } = useSpace();
	const copy = relationshipCopy(useRelationshipAge(space?.relationshipStartDate).tone);
	const accent = useThemeColor({}, "accent");
	const accentInk = useThemeColor({}, "accentInk");
	const surface = useThemeColor({}, "surface");
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

			if (letter.isOpened) {
				router.push({
					pathname: "/(app)/letter/[id]",
					params: { id: letter.id },
				});
				return;
			}

			if (!isLetterReadyToOpen(letter, now)) {
				setHint(`Not yet time. ${formatOpensInLabel(letter.sealedUntil, now)}.`);
				return;
			}

			if (isOpeningId === letter.id) {
				return;
			}

			setIsOpeningId(letter.id);
			void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

			void openLetter(letter.id)
				.then((opened) => {
					setIsOpeningId(null);
					void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
					router.push({
						pathname: "/(app)/letter/[id]",
						params: { id: opened.id },
					});
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
		[isOpeningId, now, openLetter, router],
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
					{copy.letterIntro}
				</ThemedText>
				<Pressable
					accessibilityLabel="Write a letter"
					accessibilityRole="button"
					hitSlop={Spacing[8]}
					onPress={handleWrite}
					style={[styles.writeButton, { borderColor: accent }]}
				>
					<Ionicons color={accentInk} name="create-outline" size={18} />
					<ThemedText style={{ color: accentInk }} type="meta">
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
				<View accessibilityLabel="Loading your letters" style={styles.skeletons}>
					{[0, 1, 2].map((row) => (
						<View
							accessibilityElementsHidden
							importantForAccessibility="no-hide-descendants"
							key={row}
							style={[
								styles.skeleton,
								{ backgroundColor: withAlpha(surface, 0.4), opacity: 1 - row * 0.22 },
							]}
						/>
					))}
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
							No letters yet. Write one for a future day, for the two of you.
					</ThemedText>
				</Surface>
			) : (
				letters.map((letter) => (
					<View
						key={`${letter.id}-${letter.isOpened ? "opened" : "sealed"}`}
						style={isOpeningId === letter.id ? styles.opening : undefined}
					>
						<LetterCard
							letter={letter}
							now={now}
							onPress={handlePress}
						/>
					</View>
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
		flexShrink: 0,
		gap: Spacing[4],
		minHeight: 44,
		justifyContent: "center",
		paddingHorizontal: Spacing[12],
	},
	skeletons: {
		gap: Spacing[12],
		paddingVertical: Spacing[8],
	},
	skeleton: {
		height: 72,
		borderRadius: Radii.card,
		borderCurve: "continuous",
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
