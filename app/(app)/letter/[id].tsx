import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import {
	ActivityIndicator,
	ScrollView,
	StyleSheet,
	View,
} from "react-native";
import Animated, { ReduceMotion, ZoomIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { Radii, Spacing } from "@/constants/theme";
import { FontFamilies } from "@/constants/typography";
import { useLetters } from "@/features/letters/letters-context";
import {
	formatOpenedDayLabel,
	formatOpensInLabel,
	isLetterReadyToOpen,
} from "@/features/letters/letter-time";
import { useThemeColor } from "@/hooks/use-theme-color";

/**
 * Dedicated letter reader. The body appears only here, and only after the
 * server open result marks the letter opened — sealed letters never render
 * their words, for the author too. Loading, missing, and error states all
 * offer a way back to the shelf.
 */

// Sealed -> opened reveal: scale 0.96 -> 1, one spring, 350ms.
// Entering only with ReduceMotion.System; never gates data or delays nav.
const OPEN_REVEAL = ZoomIn.withInitialValues({
	transform: [{ scale: 0.96 }],
})
	.springify(350)
	.reduceMotion(ReduceMotion.System);
export default function LetterReaderScreen() {
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const { id } = useLocalSearchParams<{ id?: string | string[] }>();
	const letterId = Array.isArray(id) ? id[0] : id;
	const { letters, isLoading, error, reload } = useLetters();
	const accent = useThemeColor({}, "accent");
	const background = useThemeColor({}, "background");
	const muted = useThemeColor({}, "muted");
	const partnerAccent = useThemeColor({}, "partnerAccent");

	const letter = useMemo(
		() => letters.find((entry) => entry.id === letterId) ?? null,
		[letters, letterId],
	);

	const handleBackToShelf = useCallback(() => {
		router.back();
	}, [router]);

	const handleRetry = useCallback(() => {
		void reload();
	}, [reload]);

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

	if (!letterId) {
		return (
			<View style={[styles.center, { backgroundColor: background }]}>
				<Stack.Screen options={{ title: "Letter" }} />
				<Surface style={styles.missingCard}>
					<ThemedText type="title">Letter not found</ThemedText>
				</Surface>
				<Button
					label="Back to Letters"
					onPress={handleBackToShelf}
					variant="secondary"
				/>
			</View>
		);
	}

	if (isLoading && letters.length === 0) {
		return (
			<View style={[styles.center, { backgroundColor: background }]}>
				<Stack.Screen options={{ title: "Letter" }} />
				<ActivityIndicator accessibilityLabel="Loading" color={accent} />
			</View>
		);
	}

	if (!letter) {
		if (error) {
			return (
				<View style={[styles.center, { backgroundColor: background }]}>
					<Stack.Screen options={{ title: "Letter" }} />
					<Surface style={styles.missingCard}>
						<ThemedText style={{ color: muted }} type="caption">
							{error}
						</ThemedText>
					</Surface>
					<View style={styles.missingActions}>
						<Button
							label="Try again"
							onPress={handleRetry}
							variant="secondary"
						/>
						<Button
							label="Back to Letters"
							onPress={handleBackToShelf}
							variant="secondary"
						/>
					</View>
				</View>
			);
		}
		return (
			<View style={[styles.center, { backgroundColor: background }]}>
				<Stack.Screen options={{ title: "Letter" }} />
				<Surface style={styles.missingCard}>
					<ThemedText type="title">Letter not found</ThemedText>
				</Surface>
				<Button
					label="Back to Letters"
					onPress={handleBackToShelf}
					variant="secondary"
				/>
			</View>
		);
	}

	if (!letter.isOpened) {
		const heading = letter.caption ?? "An unopened letter";
		const ready = isLetterReadyToOpen(letter);
		const statusLabel = ready
			? "Ready to open"
			: formatOpensInLabel(letter.sealedUntil);
		return (
			<ScrollView
				contentContainerStyle={contentContainerStyle}
				contentInsetAdjustmentBehavior="never"
				showsVerticalScrollIndicator={false}
				style={{ backgroundColor: background }}
			>
				<Stack.Screen options={{ title: "Letter" }} />
				<Surface style={styles.readingCard}>
					<ThemedText type="bodyEmphasis">{heading}</ThemedText>
					<ThemedText style={{ color: muted }} type="caption">
						{`Sealed by ${letter.authorName}`}
					</ThemedText>
					<ThemedText style={{ color: muted }} type="caption">
						{statusLabel}
					</ThemedText>
				</Surface>
				<Button
					label="Back to Letters"
					onPress={handleBackToShelf}
					variant="secondary"
				/>
			</ScrollView>
		);
	}

	const authorColor = letter.authorRole === "you" ? accent : partnerAccent;
	const openedSuffix = letter.openedAt
		? ` · Opened ${formatOpenedDayLabel(letter.openedAt)}`
		: "";

	return (
		<ScrollView
			contentContainerStyle={contentContainerStyle}
			contentInsetAdjustmentBehavior="never"
			showsVerticalScrollIndicator={false}
			style={{ backgroundColor: background }}
		>
			<Stack.Screen options={{ title: "Letter" }} />
			<Animated.View entering={OPEN_REVEAL}>
				<Surface style={styles.readingCard}>
					<View style={styles.metaRow}>
						<View style={[styles.authorDot, { backgroundColor: authorColor }]} />
						<ThemedText style={{ color: muted }} type="caption">
							{letter.authorName}
							{openedSuffix}
						</ThemedText>
					</View>
					{letter.caption ? (
						<ThemedText type="bodyEmphasis">{letter.caption}</ThemedText>
					) : null}
					<ThemedText selectable style={styles.readingBody}>
						{letter.body ?? ""}
					</ThemedText>
				</Surface>
			</Animated.View>
			<Button
				label="Back to Letters"
				onPress={handleBackToShelf}
				variant="secondary"
			/>
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	contentContainer: {
		gap: Spacing[12],
		paddingHorizontal: Spacing[16],
	},
	center: {
		flex: 1,
		gap: Spacing[12],
		justifyContent: "center",
		paddingHorizontal: Spacing[16],
	},
	missingCard: {
		gap: Spacing[8],
		padding: Spacing[16],
	},
	missingActions: {
		gap: Spacing[12],
	},
	readingCard: {
		gap: Spacing[12],
		padding: Spacing[16],
	},
	metaRow: {
		alignItems: "center",
		flexDirection: "row",
		gap: Spacing[8],
	},
	authorDot: {
		borderRadius: Radii.pill,
		height: 8,
		width: 8,
	},
	readingBody: {
		fontFamily: FontFamilies.display,
		fontSize: 20,
		lineHeight: 32,
		letterSpacing: -0.2,
	},
});
