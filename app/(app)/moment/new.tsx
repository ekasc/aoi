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
import { useMoments } from "@/features/moments/moments-context";
import { useSession } from "@/features/session/session-context";
import type { MomentType } from "@/features/moments/types";
import { useThemeColor } from "@/hooks/use-theme-color";

type MomentTypeOption = {
	value: MomentType;
	label: string;
	disabled?: boolean;
};

const MOMENT_TYPES: MomentTypeOption[] = [
	{ value: "note", label: "Note" },
	{ value: "milestone", label: "Milestone" },
	{ value: "date", label: "Date" },
	{ value: "goal", label: "Goal" },
	{ value: "media", label: "Media", disabled: true },
];

export default function NewMomentScreen() {
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const isIos = process.env.EXPO_OS === "ios";
	const { addMoment } = useMoments();
	const { user } = useSession();
	const border = useThemeColor({}, "border");
	const accent = useThemeColor({}, "accent");
	const onAccent = useThemeColor({}, "onAccent");
	const surface2 = useThemeColor({}, "surface2");
	const text = useThemeColor({}, "text");
	const muted = useThemeColor({}, "muted");
	const danger = useThemeColor({}, "danger");
	const background = useThemeColor({}, "background");
	const [type, setType] = useState<MomentType>("note");
	const [title, setTitle] = useState("");
	const [body, setBody] = useState("");
	const [hasTargetDate, setHasTargetDate] = useState(false);
	const [targetAt, setTargetAt] = useState(() => {
		const value = new Date();
		value.setMonth(value.getMonth() + 3);
		return value;
	});
	const [error, setError] = useState("");

	const trimmedTitle = title.trim();
	const trimmedBody = body.trim();
	const canSubmit = trimmedTitle.length > 0 || trimmedBody.length > 0;
	const isGoal = type === "goal";

	const inputStyle = useMemo(
		() => [
			styles.input,
			{
				backgroundColor: surface2,
				borderColor: border,
				color: text,
			},
		],
		[border, surface2, text],
	);
	const textAreaStyle = useMemo(
		() => [inputStyle, styles.textArea],
		[inputStyle],
	);
	const contentContainerStyle = useMemo(
		() => [
			styles.contentContainer,
			{ paddingBottom: insets.bottom + Spacing[24] },
		],
		[insets.bottom],
	);
	const footerStyle = useMemo(
		() => [styles.footer, { paddingBottom: insets.bottom + Spacing[12] }],
		[insets.bottom],
	);

	const handleCancel = useCallback(() => {
		router.back();
	}, [router]);

	const handleSave = useCallback(() => {
		if (!canSubmit) {
			setError("Add a title or note before saving.");
			return;
		}

		addMoment({
			type,
			title: trimmedTitle,
			body: trimmedBody,
			occurredAt: new Date().toISOString(),
			targetAt: isGoal && hasTargetDate ? targetAt.toISOString() : null,
			authorId: user?.id ?? "user_you",
			authorRole: "you",
			authorName: user?.displayName ?? "You",
		});

		router.back();
	}, [
		addMoment,
		canSubmit,
		hasTargetDate,
		isGoal,
		router,
		targetAt,
		trimmedBody,
		trimmedTitle,
		type,
		user,
	]);

	return (
		<>
			<Stack.Screen options={{ title: "Add moment" }} />
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
					<Surface variant="raised" style={styles.section}>
						<ThemedText type="meta">Type</ThemedText>
						<View style={styles.typeGrid}>
							{MOMENT_TYPES.map((option) => {
								const selected = option.value === type;
								return (
									<Pressable
										accessibilityLabel={`Moment type ${option.label}`}
										accessibilityRole="button"
										disabled={option.disabled}
										key={option.value}
										onPress={() => {
											setType(option.value);
											if (option.value !== "goal") {
												setHasTargetDate(false);
											}
											setError("");
										}}
										style={({ pressed }) => [
											styles.typeChip,
											{
												borderColor: selected
													? accent
													: border,
												backgroundColor: selected
													? accent
													: surface2,
											},
											option.disabled
												? styles.typeChipDisabled
												: undefined,
											pressed && !option.disabled
												? styles.typeChipPressed
												: undefined,
										]}
									>
										<ThemedText
											type="caption"
											style={[
												styles.typeLabel,
												{
													color: selected
														? onAccent
														: text,
												},
												option.disabled
													? styles.typeLabelDisabled
													: undefined,
											]}
										>
											{option.label}
										</ThemedText>
									</Pressable>
								);
							})}
						</View>
					</Surface>

					<Surface style={styles.section}>
						<ThemedText type="meta">Title</ThemedText>
						<TextInput
							accessibilityLabel="Moment title"
							autoCapitalize="sentences"
							onChangeText={setTitle}
							placeholder="What was it?"
							placeholderTextColor={muted}
							style={inputStyle}
							value={title}
						/>
						<ThemedText type="meta">Note</ThemedText>
						<TextInput
							accessibilityLabel="Moment note"
							autoCapitalize="sentences"
							multiline
							onChangeText={setBody}
							placeholder="The details you'll want later"
							placeholderTextColor={muted}
							style={textAreaStyle}
							textAlignVertical="top"
							value={body}
						/>

						{isGoal ? (
							<View style={styles.goalSection}>
								<Pressable
									accessibilityLabel="Toggle goal target date"
									accessibilityRole="button"
									onPress={() =>
										setHasTargetDate(
											(currentValue) => !currentValue,
										)
									}
									style={[
										styles.goalToggle,
										{
											borderColor: hasTargetDate
												? accent
												: border,
											backgroundColor: hasTargetDate
												? accent
												: surface2,
										},
									]}
								>
									<ThemedText
										type="caption"
										style={{
											color: hasTargetDate
												? onAccent
												: text,
										}}
									>
										{hasTargetDate
											? "Target date enabled"
											: "No target date (Someday)"}
									</ThemedText>
								</Pressable>

								{hasTargetDate ? (
									<NativeDateTimeField
										accessibilityLabel="Choose goal target date"
										label="Target date"
										mode="date"
										onChange={setTargetAt}
										value={targetAt}
									/>
								) : null}
							</View>
						) : null}

						<ThemedText type="caption" style={{ color: muted }}>
							Saved on {new Date().toLocaleDateString("en-US")}
						</ThemedText>
						{error ? (
							<ThemedText
								accessibilityRole="alert"
								type="caption"
								style={{ color: danger }}
							>
								{error}
							</ThemedText>
						) : null}
					</Surface>
				</ScrollView>

				<View
					style={[
						footerStyle,
						{ borderColor: border, backgroundColor: background },
					]}
				>
					<Button label="Save moment" onPress={handleSave} />
					<Button
						label="Cancel"
						onPress={handleCancel}
						variant="secondary"
					/>
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
	typeGrid: {
		flexDirection: "row",
		flexWrap: "wrap",
		gap: Spacing[8],
	},
	typeChip: {
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: 999,
		minHeight: 44,
		minWidth: 44,
		paddingHorizontal: 14,
		justifyContent: "center",
		alignItems: "center",
	},
	typeChipPressed: {
		opacity: 0.92,
	},
	typeChipDisabled: {
		opacity: 0.5,
	},
	typeLabel: {
		fontWeight: "600",
	},
	typeLabelDisabled: {
		textDecorationLine: "line-through",
	},
	input: {
		minHeight: 44,
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: 14,
		paddingHorizontal: Spacing[12],
		paddingVertical: Spacing[12],
	},
	textArea: {
		minHeight: 116,
	},
	goalSection: {
		gap: Spacing[8],
	},
	goalToggle: {
		minHeight: 44,
		minWidth: 44,
		borderRadius: 999,
		borderWidth: StyleSheet.hairlineWidth,
		paddingHorizontal: Spacing[12],
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
