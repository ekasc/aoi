import * as Haptics from "expo-haptics";
import { Stack, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	KeyboardAvoidingView,
	Pressable,
	ScrollView,
	StyleSheet,
	TextInput,
	View,
} from "react-native";
import Animated, { ReduceMotion, ZoomIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { NativeDateTimeField } from "@/components/forms/native-date-time-field";
import { ThemedText } from "@/components/themed-text";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { Radii, Spacing } from "@/constants/theme";
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
import { useSubscription } from "@/features/subscription/subscription-context";
import { useThemeColor } from "@/hooks/use-theme-color";

// Seal confirmation: springs in scale 0.96 to 1, one short spring, entering only.
// ReduceMotion.System skips it. Never gates data or delays nav.
const SEAL_ANIMATION = ZoomIn.withInitialValues({
	transform: [{ scale: 0.96 }],
})
	.springify(300)
	.reduceMotion(ReduceMotion.System);

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
	const { letters, sealLetter, isSealing } = useLetters();
	const { serverPlus, refreshServerPlus } = useSubscription();
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
	// Shown only after the server itself enforces the allowance, the draft
	// (body/caption/date) is never cleared, so nothing is lost.
	const [limitBlocked, setLimitBlocked] = useState(false);
	// Same-tick duplicate guard: isSealing flips a render later, so a fast
	// second tap in the same tick would otherwise seal twice.
	const sealingRef = useRef(false);
	const finishedRef = useRef(false);
	const finishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// The writing moment is frozen at mount — presets stay steady while the
	// letter is being written.
	const writingMoment = useMemo(() => new Date(), []);

	const partnerName = space?.partnerName?.trim() || null;

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

	const sealedActiveCount = letters.filter((letter) => !letter.isOpened).length;
	// Server authority first: the known Free allowance and count come from
	// serverPlus; the local list is only a fallback while unknown. Unknown
	// never blocks, the seal endpoint enforces and we intercept honestly.
	const serverLetterLimit =
		serverPlus && !serverPlus.isPlus ? serverPlus.futureLetterLimit : null;
	const serverActiveCount = serverPlus?.activeFutureLetters ?? sealedActiveCount;
	const atServerLimit =
		serverLetterLimit !== null && serverActiveCount >= serverLetterLimit;

	const handleSeal = useCallback(async () => {
		if (sealingRef.current) {
			return;
		}
		if (!canSeal || !resolvedDate) {
			return;
		}

		if (atServerLimit) {
			router.push("/(app)/paywall");
			return;
		}

		sealingRef.current = true;
		setSealError(null);
		setLimitBlocked(false);

		try {
			await sealLetter({
				caption: caption.trim() || undefined,
				body: body.trim(),
				sealedUntil: resolvedDate.toISOString(),
			});
			void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
			void refreshServerPlus();
			setSealedDay(resolvedDate);
		} catch (error) {
			const code = (error as { code?: string } | null)?.code;
			if (code === "LIMIT_EXCEEDED") {
				// Draft preserved; explain the actual limit and offer Plus.
				void refreshServerPlus();
				setLimitBlocked(true);
				return;
			}
			const message = error instanceof Error ? error.message : "";
			setSealError(
				message
					? `This letter could not be sealed just now. ${message}`
					: "Couldn't seal it right now, try again in a moment.",
			);
		} finally {
			sealingRef.current = false;
		}
	}, [atServerLimit, body, canSeal, caption, resolvedDate, router, sealLetter, refreshServerPlus]);

	// Done, the shelf link, and the soft-confirmation timer share one
	// finish guard so the exit transition can only leave once.
	const handleFinish = useCallback(() => {
		if (finishedRef.current) {
			return;
		}
		finishedRef.current = true;
		if (finishTimerRef.current) {
			clearTimeout(finishTimerRef.current);
			finishTimerRef.current = null;
		}
		router.back();
	}, [router]);

	const handleGoToShelf = useCallback(() => {
		if (finishedRef.current) {
			return;
		}
		finishedRef.current = true;
		if (finishTimerRef.current) {
			clearTimeout(finishTimerRef.current);
			finishTimerRef.current = null;
		}
		router.push("/(app)/letters");
	}, [router]);

	// After the soft confirmation rests, drift back to the shelf.
	useEffect(() => {
		if (!sealedDay) {
			return;
		}

		finishedRef.current = false;
		finishTimerRef.current = setTimeout(handleFinish, CONFIRMATION_REST_MS);
		return () => {
			if (finishTimerRef.current) {
				clearTimeout(finishTimerRef.current);
				finishTimerRef.current = null;
			}
		};
	}, [handleFinish, sealedDay]);

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
								sealed, it waits, even for you.
							</ThemedText>
							<View style={styles.confirmationButton}>
								<Button
									accessibilityLabel="Done"
									label="Done"
									onPress={handleFinish}
								/>
							</View>
							<View style={styles.confirmationButton}>
								<Button
									label="Back to Letters"
									onPress={handleGoToShelf}
									variant="secondary"
								/>
							</View>
						</Surface>
					</Animated.View>
				) : (
					<>
						<View style={styles.recipientRow}>
							<ThemedText style={styles.recipient} type="title">
								For {partnerName ?? "the two of you"}
							</ThemedText>
							<ThemedText style={{ color: muted }} type="caption">
								Write it now; they&apos;ll open it on the day you choose.
							</ThemedText>
						</View>

						<TextInput
							accessibilityLabel="Letter body"
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
							accessibilityLabel="Envelope caption (optional)"
							maxLength={LETTER_CAPTION_MAX_LENGTH}
							onChangeText={setCaption}
							placeholder="A few words for the envelope (optional)"
							placeholderTextColor={muted}
							style={[styles.captionInput, { color: text }]}
							value={caption}
						/>

						<View style={styles.dateSection}>
							<ThemedText type="label">Choose the day it opens</ThemedText>
							<View style={styles.presetRow}>
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
							</View>

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
						</View>

						{sealError ? (
							<ThemedText style={{ color: muted }} type="caption">
								{sealError}
							</ThemedText>
						) : null}

						{atServerLimit || limitBlocked ? (
							<Surface style={styles.limitCard}>
								<ThemedText type="body">Your Space holds its future letter.</ThemedText>
								<ThemedText style={{ color: muted }} type="caption">
									Aoi Plus unlocks unlimited letters for your shared Space, your draft stays right here.
								</ThemedText>
								<Button
									label="Unlock Plus"
									onPress={() => router.push("/(app)/paywall")}
									variant="secondary"
								/>
							</Surface>
						) : null}

						<View style={styles.footer}>
							<Button
								disabled={!canSeal}
								label={isSealing ? "Sealing…" : "Seal it"}
								onPress={() => void handleSeal()}
							/>
							<ThemedText style={{ color: muted }} type="caption">
								Once sealed, neither of you can read it before that day. Letters cannot be edited after sealing.
							</ThemedText>
						</View>
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
		gap: Spacing[24],
		paddingHorizontal: Spacing[24],
		flexGrow: 1,
	},
	recipientRow: {
		gap: Spacing[8],
	},
	recipient: {
		fontFamily: FontFamilies.display,
		fontSize: 22,
		lineHeight: 28,
		letterSpacing: -0.2,
	},
	// The display serif makes writing feel like writing, content first.
	letterInput: {
		fontFamily: FontFamilies.display,
		fontSize: 22,
		lineHeight: 32,
		letterSpacing: -0.2,
		minHeight: 240,
		textAlignVertical: "top",
	},
	captionInput: {
		fontSize: 15,
		lineHeight: 22,
	},
	dateSection: {
		gap: Spacing[16],
	},
	presetRow: {
		flexDirection: "row",
		flexWrap: "wrap",
		gap: Spacing[8],
	},
	presetChip: {
		borderRadius: Radii.pill,
		borderWidth: 1,
		minHeight: 44,
		minWidth: 44,
		justifyContent: "center",
		paddingHorizontal: Spacing[12],
		paddingVertical: Spacing[8],
	},
	footer: {
		gap: Spacing[12],
	},
	confirmationCard: {
		gap: Spacing[12],
		padding: Spacing[24],
	},
	confirmationButton: {
		marginTop: Spacing[4],
	},
	limitCard: {
		gap: Spacing[8],
	},
});
