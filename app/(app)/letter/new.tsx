import { Stack, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	KeyboardAvoidingView,
	Pressable,
	ScrollView,
	StyleSheet,
	TextInput,
	View,
} from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { NativeDateTimeField } from "@/components/forms/native-date-time-field";
import { ThemedText } from "@/components/themed-text";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { Motion, Radii, Spacing } from "@/constants/theme";
import { FontFamilies } from "@/constants/typography";
import {
	addDays,
	startOfDay,
} from "@/features/calendar/calendar-date-utils";
import { useLetters } from "@/features/letters/letters-context";
import {
	formatSealDayLabel,
	getNextAnniversary,
	getSealDateInMonths,
	getSealDateInYears,
} from "@/features/letters/letter-time";
import {
	LETTER_BODY_MAX_LENGTH,
	LETTER_CAPTION_MAX_LENGTH,
	LETTER_SEAL_MAX_HORIZON_DAYS,
} from "@/features/letters/types";
import { useSpace } from "@/features/space/space-context";
import { useThemeColor } from "@/hooks/use-theme-color";

const SEAL_ANIMATION = FadeIn.duration(Motion.slow).reduceMotion(
	ReduceMotion.System,
);

// How long the soft confirmation rests before returning to the shelf.
const CONFIRMATION_REST_MS = 2600;

type SealPresetId = "month" | "year" | "anniversary" | "custom";

type SealPreset = {
	id: SealPresetId;
	label: string;
	date: Date | null;
};

/**
 * The writing ceremony: a letter in the display serif, a few words for the
 * envelope, and the day it will open. Sealing is final — the copy says so
 * gently, and there is no edit path afterwards.
 */
export default function NewLetterScreen() {
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const isIos = process.env.EXPO_OS === "ios";
	const { sealLetter, isSealing } = useLetters();
	const { space } = useSpace();
	const accent = useThemeColor({}, "accent");
	const background = useThemeColor({}, "background");
	const border = useThemeColor({}, "border");
	const muted = useThemeColor({}, "muted");
	const onAccent = useThemeColor({}, "onAccent");
	const surface = useThemeColor({}, "surface");
	const text = useThemeColor({}, "text");

	const [body, setBody] = useState("");
	const [caption, setCaption] = useState("");
	const [presetId, setPresetId] = useState<SealPresetId>("month");
	const [customDate, setCustomDate] = useState(() =>
		getSealDateInMonths(new Date(), 1),
	);
	const [sealedDay, setSealedDay] = useState<Date | null>(null);
	const [sealError, setSealError] = useState<string | null>(null);

	// The writing moment is frozen at mount — presets stay steady while the
	// letter is being written.
	const writingMoment = useMemo(() => new Date(), []);

	const presets = useMemo<SealPreset[]>(() => {
		const list: SealPreset[] = [
			{ id: "month", label: "In a month", date: getSealDateInMonths(writingMoment, 1) },
			{ id: "year", label: "In a year", date: getSealDateInYears(writingMoment, 1) },
		];

		const anniversary = getNextAnniversary(
			space?.relationshipStartDate,
			writingMoment,
		);
		if (anniversary) {
			list.push({ id: "anniversary", label: "Our next anniversary", date: anniversary });
		}

		list.push({ id: "custom", label: "Pick a day", date: null });
		return list;
	}, [space?.relationshipStartDate, writingMoment]);

	const resolvedDate =
		presetId === "custom"
			? customDate
			: presets.find((preset) => preset.id === presetId)?.date ?? null;

	const canSeal = body.trim().length > 0 && resolvedDate !== null && !isSealing;

	const handleSeal = useCallback(async () => {
		if (!canSeal || !resolvedDate) {
			return;
		}

		setSealError(null);

		try {
			await sealLetter({
				caption: caption.trim() || undefined,
				body: body.trim(),
				sealedUntil: resolvedDate.toISOString(),
			});
			setSealedDay(resolvedDate);
		} catch (error) {
			const message = error instanceof Error ? error.message : "";
			setSealError(
				message || "Couldn't seal it right now — try again in a moment.",
			);
		}
	}, [body, canSeal, caption, resolvedDate, sealLetter]);

	// After the soft confirmation rests, drift back to the shelf.
	useEffect(() => {
		if (!sealedDay) {
			return;
		}

		const timer = setTimeout(() => router.back(), CONFIRMATION_REST_MS);
		return () => clearTimeout(timer);
	}, [router, sealedDay]);

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
		<KeyboardAvoidingView
			behavior={isIos ? "padding" : undefined}
			style={[styles.root, { backgroundColor: background }]}
		>
			<Stack.Screen options={{ title: "Write a letter" }} />
			<ScrollView
				contentContainerStyle={contentContainerStyle}
				keyboardShouldPersistTaps="handled"
				showsVerticalScrollIndicator={false}
			>
				{sealedDay ? (
					<Animated.View entering={SEAL_ANIMATION}>
						<Surface style={styles.confirmationCard}>
							<ThemedText type="title">Sealed.</ThemedText>
							<ThemedText style={{ color: muted }} type="caption">
								It opens {formatSealDayLabel(sealedDay.toISOString())}. Once
								sealed, it waits — even for you.
							</ThemedText>
							<View style={styles.confirmationButton}>
								<Button
									label="Back to the shelf"
									onPress={() => router.back()}
									variant="secondary"
								/>
							</View>
						</Surface>
					</Animated.View>
				) : (
					<>
						<ThemedText style={{ color: muted }} type="caption">
							Write it now; they&apos;ll open it on the day you choose.
						</ThemedText>

						<Surface style={styles.paper}>
							<TextInput
								maxLength={LETTER_BODY_MAX_LENGTH}
								multiline
								onChangeText={setBody}
								placeholder="Write it as if they'll read it on that day…"
								placeholderTextColor={muted}
								style={[styles.letterInput, { color: text }]}
								textAlignVertical="top"
								value={body}
							/>
							<TextInput
								maxLength={LETTER_CAPTION_MAX_LENGTH}
								onChangeText={setCaption}
								placeholder="A few words for the envelope (optional)"
								placeholderTextColor={muted}
								style={[styles.captionInput, { color: text }]}
								value={caption}
							/>
						</Surface>

						<ThemedText style={{ color: muted }} type="meta">
							Seal it until…
						</ThemedText>
						<ScrollView
							contentContainerStyle={styles.presetRow}
							horizontal
							showsHorizontalScrollIndicator={false}
						>
							{presets.map((preset) => {
								const isActive = presetId === preset.id;
								return (
									<Pressable
										accessibilityLabel={`Seal date: ${preset.label}`}
										accessibilityRole="button"
										accessibilityState={{ selected: isActive }}
										key={preset.id}
										onPress={() => setPresetId(preset.id)}
										style={[
											styles.presetChip,
											{
												backgroundColor: isActive ? accent : surface,
												borderColor: isActive ? accent : border,
											},
										]}
									>
										<ThemedText
											style={{ color: isActive ? onAccent : muted }}
											type="meta"
										>
											{preset.label}
										</ThemedText>
									</Pressable>
								);
							})}
						</ScrollView>

						{presetId === "custom" ? (
							<NativeDateTimeField
								label="Opens on"
								maximumDate={new Date(
									writingMoment.getTime() +
										LETTER_SEAL_MAX_HORIZON_DAYS * 24 * 60 * 60 * 1000,
								)}
								minimumDate={addDays(startOfDay(writingMoment), 1)}
								mode="date"
								onChange={setCustomDate}
								value={customDate}
							/>
						) : null}

						{resolvedDate ? (
							<ThemedText style={{ color: muted }} type="caption">
								Opens {formatSealDayLabel(resolvedDate.toISOString())}.
							</ThemedText>
						) : null}

						{sealError ? (
							<ThemedText style={{ color: muted }} type="caption">
								{sealError}
							</ThemedText>
						) : null}

						<Button
							disabled={!canSeal}
							label={isSealing ? "Sealing…" : "Seal it"}
							onPress={() => void handleSeal()}
						/>
						<ThemedText style={{ color: muted }} type="caption">
							Once sealed, it waits — even for you.
						</ThemedText>
					</>
				)}
			</ScrollView>
		</KeyboardAvoidingView>
	);
}

const styles = StyleSheet.create({
	root: {
		flex: 1,
	},
	contentContainer: {
		gap: Spacing[16],
		paddingHorizontal: Spacing[16],
	},
	paper: {
		gap: Spacing[12],
		padding: Spacing[16],
	},
	// The display serif makes writing feel like writing.
	letterInput: {
		fontFamily: FontFamilies.display,
		fontSize: 20,
		lineHeight: 30,
		letterSpacing: -0.2,
		minHeight: 200,
	},
	captionInput: {
		fontSize: 15,
		lineHeight: 22,
	},
	presetRow: {
		gap: Spacing[8],
	},
	presetChip: {
		borderRadius: Radii.pill,
		borderWidth: 1,
		paddingHorizontal: Spacing[12],
		paddingVertical: Spacing[8],
	},
	confirmationCard: {
		gap: Spacing[12],
		padding: Spacing[24],
	},
	confirmationButton: {
		marginTop: Spacing[4],
	},
});
