import { Ionicons } from "@expo/vector-icons";
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
import Animated, { FadeIn, FadeInDown, ReduceMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { NativeDateTimeField } from "@/components/forms/native-date-time-field";
import { MediaPicker } from "@/components/media/media-picker";
import { UploadProgress } from "@/components/media/upload-progress";
import { ThemedText } from "@/components/themed-text";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { FontFamilies } from "@/constants/typography";
import { Motion, Spacing } from "@/constants/theme";
import { useMediaUpload } from "@/features/media/use-media-upload";
import { useMoments } from "@/features/moments/moments-context";
import { useSession } from "@/features/session/session-context";
import type { MomentType } from "@/features/moments/types";
import { useThemeColor } from "@/hooks/use-theme-color";

type MomentTypeOption = {
	value: MomentType;
	label: string;
	icon: keyof typeof Ionicons.glyphMap;
	description: string;
};

const MOMENT_TYPES: MomentTypeOption[] = [
	{ value: "note", label: "Note", icon: "create-outline", description: "A quick thought" },
	{ value: "milestone", label: "Milestone", icon: "trophy-outline", description: "Something important" },
	{ value: "date", label: "Date", icon: "heart-outline", description: "When we were together" },
	{ value: "media", label: "Media", icon: "camera-outline", description: "A photo or video" },
	{ value: "goal", label: "Goal", icon: "flag-outline", description: "Something we're working toward" },
];

const TYPE_ICON_SIZE = 22;

export default function NewMomentScreen() {
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const isIos = process.env.EXPO_OS === "ios";
	const { addMoment } = useMoments();
	const { user } = useSession();
	const { uploadImage, state: uploadState, progress: uploadProgress, error: uploadError, reset: resetUpload } = useMediaUpload();
	const border = useThemeColor({}, "border");
	const accent = useThemeColor({}, "accent");
	const onAccent = useThemeColor({}, "onAccent");
	const surface = useThemeColor({}, "surface");
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
	const [isSaving, setIsSaving] = useState(false);
	const [mediaUri, setMediaUri] = useState<string | null>(null);
	const [selectedMimeType, setSelectedMimeType] = useState("image/jpeg");

	const trimmedTitle = title.trim();
	const trimmedBody = body.trim();
	const isMedia = type === "media";
	const isGoal = type === "goal";
	const hasMedia = isMedia && !!mediaUri;
	const hasText = trimmedTitle.length > 0 || trimmedBody.length > 0;
	const canSubmit = hasText || hasMedia;

	const footerStyle = useMemo(
		() => [styles.footer, { paddingBottom: insets.bottom + Spacing[12] }],
		[insets.bottom],
	);

	const handleCancel = useCallback(() => {
		router.back();
	}, [router]);

	const handleSave = useCallback(async () => {
		if (!canSubmit) {
			setError("Add a title, note, or media before saving.");
			return;
		}

		setIsSaving(true);
		setError("");

		try {
			let mediaPreview: string | null = null;

			if (mediaUri) {
				const uploadedUrl = await uploadImage({ uri: mediaUri, mimeType: selectedMimeType });
				if (!uploadedUrl) {
					setError("Failed to upload media. Please try again.");
					setIsSaving(false);
					return;
				}
				mediaPreview = uploadedUrl;
			}

			await addMoment({
				type,
				title: trimmedTitle,
				body: trimmedBody,
				occurredAt: new Date().toISOString(),
				targetAt: isGoal && hasTargetDate ? targetAt.toISOString() : null,
				authorId: user?.id ?? "user_you",
				authorRole: "you",
				authorName: user?.displayName ?? "You",
				mediaPreview: mediaPreview ?? undefined,
			});

			router.back();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to save moment");
		} finally {
			setIsSaving(false);
		}
	}, [
		addMoment,
		canSubmit,
		hasTargetDate,
		isGoal,
		mediaUri,
		router,
		targetAt,
		trimmedBody,
		trimmedTitle,
		type,
		uploadImage,
		user,
		selectedMimeType,
	]);

	const handleMediaSelected = useCallback((selection: { uri: string; mimeType: string }) => {
		setMediaUri(selection.uri);
		setSelectedMimeType(selection.mimeType);
		setError("");
	}, []);

	const handleMediaClear = useCallback(() => {
		setMediaUri(null);
		setSelectedMimeType("image/jpeg");
		resetUpload();
	}, [resetUpload]);

	const handleTypeSelect = useCallback((option: MomentTypeOption) => {
		setType(option.value);
		if (option.value !== "goal") {
			setHasTargetDate(false);
		}
		if (option.value !== "media") {
			setMediaUri(null);
			resetUpload();
		}
		setError("");
	}, [resetUpload]);

	return (
		<>
			<Stack.Screen options={{ title: "Add moment" }} />
			<KeyboardAvoidingView
				behavior={isIos ? "padding" : undefined}
				style={[styles.root, { backgroundColor: background }]}
			>
				<ScrollView
					contentContainerStyle={styles.contentContainer}
					contentInsetAdjustmentBehavior="never"
					keyboardDismissMode="interactive"
					keyboardShouldPersistTaps="handled"
					showsVerticalScrollIndicator={false}
				>
					<Animated.View
						entering={true ? FadeInDown.duration(Motion.slow).reduceMotion(ReduceMotion.System) : undefined}
						style={styles.hero}
					>
						<ThemedText type="display" style={styles.heroTitle}>
							Capture a moment
						</ThemedText>
						<ThemedText type="body" style={{ color: muted }}>
							What kind of moment was it?
						</ThemedText>
					</Animated.View>

					<View style={styles.typeGrid}>
						{MOMENT_TYPES.map((option, index) => {
							const selected = option.value === type;
							return (
								<Animated.View
									entering={
										true
											? FadeInDown.duration(Motion.base)
													.delay(40 + index * 30)
													.reduceMotion(ReduceMotion.System)
											: undefined
									}
									key={option.value}
									style={[
										styles.typeCell,
										index === MOMENT_TYPES.length - 1 && styles.typeCellLast,
									]}
								>
									<Pressable
										accessibilityLabel={`Moment type ${option.label}`}
										accessibilityRole="button"
										onPress={() => handleTypeSelect(option)}
										style={[
											styles.typeCard,
											{
												borderColor: selected ? accent : border,
												backgroundColor: selected ? accent : surface,
											},
										]}
									>
										<Ionicons
											color={selected ? onAccent : muted}
											name={option.icon}
											size={TYPE_ICON_SIZE}
										/>
										<ThemedText
											type="body"
											style={[
												styles.typeLabel,
												{ color: selected ? onAccent : text },
											]}
										>
											{option.label}
										</ThemedText>
										<ThemedText
											type="caption"
											style={{ color: selected ? onAccent : muted }}
										>
											{option.description}
										</ThemedText>
									</Pressable>
								</Animated.View>
							);
						})}
					</View>

					<Animated.View
						entering={true ? FadeIn.duration(Motion.base).reduceMotion(ReduceMotion.System) : undefined}
						style={styles.contentWrap}
					>
						{isMedia ? (
							<>
								<MediaPicker
									disabled={isSaving}
									onClear={handleMediaClear}
									onMediaSelected={handleMediaSelected}
									selectedUri={mediaUri}
								/>
								<UploadProgress
									error={uploadError}
									progress={uploadProgress}
									state={uploadState}
								/>
							</>
						) : null}

						<Surface style={styles.contentSection}>
							<TextInput
								accessibilityLabel="Moment title"
								autoCapitalize="sentences"
								onChangeText={setTitle}
								placeholder="What was it?"
								placeholderTextColor={muted}
								style={[
									styles.titleInput,
									{
										backgroundColor: surface2,
										borderColor: border,
										color: text,
									},
								]}
								value={title}
							/>

							<TextInput
								accessibilityLabel="Moment note"
								autoCapitalize="sentences"
								multiline
								onChangeText={setBody}
								placeholder="The details you'll want later"
								placeholderTextColor={muted}
								style={[
									styles.noteInput,
									{
										backgroundColor: surface2,
										borderColor: border,
										color: text,
									},
								]}
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
										<Ionicons
											color={hasTargetDate ? onAccent : muted}
											name={hasTargetDate ? "calendar" : "calendar-outline"}
											size={18}
											style={styles.goalToggleIcon}
										/>
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
								Today · {new Date().toLocaleDateString("en-US")}
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
					</Animated.View>
				</ScrollView>

				<View
					style={[
						footerStyle,
						{ borderColor: border, backgroundColor: background },
					]}
				>
					<Button
						label={
							uploadState === 'uploading'
								? 'Uploading media…'
								: uploadState === 'confirming'
									? 'Confirming upload…'
									: isSaving
										? 'Saving…'
										: 'Save moment'
						}
						onPress={handleSave}
						disabled={isSaving}
					/>
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
		paddingTop: Spacing[24],
		paddingBottom: Spacing[40],
		gap: Spacing[16],
	},
	hero: {
		gap: Spacing[4],
		paddingBottom: Spacing[8],
	},
	heroTitle: {
		fontSize: 40,
		lineHeight: 46,
	},
	typeGrid: {
		flexDirection: "row",
		flexWrap: "wrap",
		gap: Spacing[8],
	},
	typeCell: {
		width: "48%",
	},
	typeCellLast: {
		flexGrow: 1,
	},
	typeCard: {
		minHeight: 88,
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: 20,
		padding: Spacing[12],
		gap: Spacing[4],
		justifyContent: "center",
	},
	typeLabel: {
		fontWeight: "600",
	},
	contentWrap: {
		gap: Spacing[16],
	},
	contentSection: {
		gap: Spacing[12],
	},
	titleInput: {
		minHeight: 52,
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: 14,
		paddingHorizontal: Spacing[12],
		paddingVertical: Spacing[12],
		fontFamily: FontFamilies.display,
		fontSize: 22,
		lineHeight: 28,
	},
	noteInput: {
		minHeight: 120,
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: 14,
		paddingHorizontal: Spacing[12],
		paddingVertical: Spacing[12],
	},
	goalSection: {
		gap: Spacing[8],
	},
	goalToggle: {
		flexDirection: "row",
		minHeight: 44,
		minWidth: 44,
		borderRadius: 999,
		borderWidth: StyleSheet.hairlineWidth,
		paddingHorizontal: Spacing[12],
		justifyContent: "center",
		alignItems: "center",
	},
	goalToggleIcon: {
		marginRight: 6,
	},
	footer: {
		borderTopWidth: StyleSheet.hairlineWidth,
		paddingHorizontal: Spacing[16],
		paddingTop: Spacing[12],
		gap: Spacing[12],
	},
});
