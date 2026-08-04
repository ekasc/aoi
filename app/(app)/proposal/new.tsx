import { Stack, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
	KeyboardAvoidingView,
	Pressable,
	ScrollView,
	StyleSheet,
	TextInput,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { NativeDateTimeField } from "@/components/forms/native-date-time-field";
import { ThemedText } from "@/components/themed-text";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { Spacing } from "@/constants/theme";
import { CALENDAR_PRESET_LABELS } from "@/features/calendar/types";
import type { CalendarPresetLabel } from "@/features/calendar/types";
import { useProposals } from "@/features/proposals/proposals-context";
import { useThemeColor } from "@/hooks/use-theme-color";

function applyDatePart(base: Date, datePart: Date) {
	const next = new Date(base);
	next.setFullYear(datePart.getFullYear(), datePart.getMonth(), datePart.getDate());
	return next;
}

function applyTimePart(base: Date, timePart: Date) {
	const next = new Date(base);
	next.setHours(timePart.getHours(), timePart.getMinutes(), 0, 0);
	return next;
}

function datePlusOneHour(date: Date) {
	return new Date(date.getTime() + 60 * 60 * 1000);
}

function ensureEndAfterStart(startDate: Date, currentEndDate: Date) {
	if (currentEndDate.getTime() > startDate.getTime()) {
		return currentEndDate;
	}

	return datePlusOneHour(startDate);
}

export default function NewProposalScreen() {
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const isIos = process.env.EXPO_OS === "ios";
	const { propose } = useProposals();
	const border = useThemeColor({}, "border");
	const accent = useThemeColor({}, "accent");
	const onAccent = useThemeColor({}, "onAccent");
	const surface2 = useThemeColor({}, "surface2");
	const text = useThemeColor({}, "text");
	const muted = useThemeColor({}, "muted");
	const danger = useThemeColor({}, "danger");
	const background = useThemeColor({}, "background");

	const initialStart = useMemo(() => {
		const currentDate = new Date();
		currentDate.setHours(currentDate.getHours() + 1, 0, 0, 0);
		return currentDate;
	}, []);

	const [title, setTitle] = useState("");
	const [presetLabel, setPresetLabel] = useState<CalendarPresetLabel | null>(null);
	const [customLabel, setCustomLabel] = useState("");
	const [startsAt, setStartsAt] = useState(initialStart);
	const [endsAt, setEndsAt] = useState(() => datePlusOneHour(initialStart));
	const [error, setError] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);

	const isRangeInvalid = endsAt.getTime() <= startsAt.getTime();
	const isPastStart = startsAt.getTime() <= Date.now();

	const inputStyle = useMemo(
		() => [
			styles.input,
			{
				borderColor: border,
				backgroundColor: surface2,
				color: text,
			},
		],
		[border, surface2, text],
	);
	const contentContainerStyle = useMemo(
		() => [styles.contentContainer, { paddingBottom: insets.bottom + Spacing[24] }],
		[insets.bottom],
	);
	const footerStyle = useMemo(
		() => [styles.footer, { paddingBottom: insets.bottom + Spacing[12] }],
		[insets.bottom],
	);

	const handleSuggest = useCallback(async () => {
		const trimmedTitle = title.trim();

		if (!trimmedTitle) {
			setError("Give the idea a few words.");
			return;
		}

		if (isPastStart) {
			setError("A suggestion can only point to the future.");
			return;
		}

		if (isRangeInvalid) {
			setError("The ending needs to come after the start.");
			return;
		}

		setIsSubmitting(true);
		setError("");
		try {
			await propose({
				title: trimmedTitle,
				proposedStart: startsAt.toISOString(),
				proposedEnd: endsAt.toISOString(),
				label: presetLabel
					? presetLabel === "Other"
						? { preset: "Other", customText: customLabel.trim() }
						: { preset: presetLabel }
					: undefined,
			});

			router.back();
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Your suggestion could not be sent.",
			);
		} finally {
			setIsSubmitting(false);
		}
	}, [
		customLabel,
		endsAt,
		isPastStart,
		isRangeInvalid,
		presetLabel,
		propose,
		router,
		startsAt,
		title,
	]);

	return (
		<>
			<Stack.Screen options={{ title: "Suggest a time" }} />
			<KeyboardAvoidingView
				behavior={isIos ? "padding" : undefined}
				style={[styles.root, { backgroundColor: background }]}
			>
				<ScrollView
					contentContainerStyle={contentContainerStyle}
					contentInsetAdjustmentBehavior="never"
					keyboardDismissMode="interactive"
					keyboardShouldPersistTaps="handled"
					showsVerticalScrollIndicator={false}
				>
					<ThemedText type="caption" selectable style={{ color: muted }}>
						A gentle idea, never a demand — they can answer whenever, or pass
						with a quiet &quot;not now&quot;.
					</ThemedText>

					<Surface variant="raised" style={styles.section}>
						<ThemedText type="meta">The idea</ThemedText>
						<TextInput
							accessibilityLabel="Suggestion title"
							autoCapitalize="sentences"
							maxLength={120}
							onChangeText={(value) => {
								setTitle(value);
								if (error) {
									setError("");
								}
							}}
							placeholder="How about the farmers market?"
							placeholderTextColor={muted}
							style={inputStyle}
							value={title}
						/>
					</Surface>

					<Surface style={styles.section}>
						<ThemedText type="meta">When</ThemedText>
						<NativeDateTimeField
							accessibilityLabel="Choose start date"
							label="Start date"
							mode="date"
							onChange={(value) => {
								setStartsAt((current) => {
									const nextStartDate = applyDatePart(current, value);
									setEndsAt((currentEndDate) =>
										ensureEndAfterStart(nextStartDate, currentEndDate),
									);
									return nextStartDate;
								});
								setError("");
							}}
							value={startsAt}
						/>
						<NativeDateTimeField
							accessibilityLabel="Choose start time"
							label="Start time"
							mode="time"
							onChange={(value) => {
								setStartsAt((current) => {
									const nextStartDate = applyTimePart(current, value);
									setEndsAt((currentEndDate) =>
										ensureEndAfterStart(nextStartDate, currentEndDate),
									);
									return nextStartDate;
								});
								setError("");
							}}
							value={startsAt}
						/>
						<NativeDateTimeField
							accessibilityLabel="Choose end date"
							label="End date"
							mode="date"
							minimumDate={startsAt}
							onChange={(value) => {
								setEndsAt((current) => applyDatePart(current, value));
								setError("");
							}}
							value={endsAt}
						/>
						<NativeDateTimeField
							accessibilityLabel="Choose end time"
							label="End time"
							mode="time"
							onChange={(value) => {
								setEndsAt((current) => applyTimePart(current, value));
								setError("");
							}}
							value={endsAt}
						/>
						<ThemedText type="caption" selectable style={{ color: muted }}>
							{startsAt.toLocaleString("en-US")} —{" "}
							{endsAt.toLocaleTimeString("en-US", {
								hour: "numeric",
								minute: "2-digit",
							})}
						</ThemedText>
						{isRangeInvalid ? (
							<ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>
								The ending needs to come after the start.
							</ThemedText>
						) : null}
					</Surface>

					<Surface style={styles.section}>
						<ThemedText type="meta">Label (optional)</ThemedText>
						<View accessibilityRole="radiogroup">
							<View style={styles.choiceRow}>
								<Pressable
									accessibilityLabel="No label"
									accessibilityRole="radio"
									accessibilityState={{ selected: presetLabel === null }}
									onPress={() => setPresetLabel(null)}
									style={[
										styles.choiceChip,
										{
											borderColor: presetLabel === null ? accent : border,
											backgroundColor: presetLabel === null ? accent : surface2,
										},
									]}
								>
									<ThemedText
										type="caption"
										style={{ color: presetLabel === null ? onAccent : text }}
									>
										None
									</ThemedText>
								</Pressable>
								{CALENDAR_PRESET_LABELS.map((label) => {
									const selected = presetLabel === label;

									return (
										<Pressable
											accessibilityLabel={`Set label ${label}`}
											accessibilityRole="radio"
											accessibilityState={{ selected }}
											key={label}
											onPress={() => setPresetLabel(label)}
											style={[
												styles.choiceChip,
												{
													borderColor: selected ? accent : border,
													backgroundColor: selected ? accent : surface2,
												},
											]}
										>
											<ThemedText
												type="caption"
												style={{ color: selected ? onAccent : text }}
											>
												{label}
											</ThemedText>
										</Pressable>
									);
								})}
							</View>
						</View>

						{presetLabel === "Other" ? (
							<TextInput
								accessibilityLabel="Custom label"
								autoCapitalize="sentences"
								onChangeText={setCustomLabel}
								placeholder="Optional custom label"
								placeholderTextColor={muted}
								style={inputStyle}
								value={customLabel}
							/>
						) : null}
					</Surface>

					{error ? (
						<ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>
							{error}
						</ThemedText>
					) : null}
				</ScrollView>

				<View style={[footerStyle, { borderColor: border, backgroundColor: background }]}>
					<Button
						disabled={isSubmitting || isRangeInvalid || title.trim().length === 0}
						label={isSubmitting ? "Suggesting…" : "Suggest it"}
						onPress={handleSuggest}
					/>
					<Button label="Cancel" variant="secondary" onPress={() => router.back()} />
				</View>
			</KeyboardAvoidingView>
		</>
	);
}

const styles = StyleSheet.create({
	root: {
		flex: 1,
	},
	contentContainer: {
		paddingHorizontal: Spacing[16],
		paddingTop: Spacing[16],
		gap: Spacing[12],
	},
	section: {
		gap: Spacing[8],
	},
	input: {
		minHeight: 44,
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: 14,
		paddingHorizontal: Spacing[12],
		paddingVertical: Spacing[12],
	},
	choiceRow: {
		flexDirection: "row",
		flexWrap: "wrap",
		gap: Spacing[8],
	},
	choiceChip: {
		minHeight: 44,
		minWidth: 44,
		borderRadius: 999,
		borderWidth: StyleSheet.hairlineWidth,
		paddingHorizontal: 12,
		justifyContent: "center",
		alignItems: "center",
	},
	footer: {
		borderTopWidth: StyleSheet.hairlineWidth,
		paddingHorizontal: Spacing[16],
		paddingTop: Spacing[12],
		gap: Spacing[8],
	},
});
