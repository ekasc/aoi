import { Stack } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	ActivityIndicator,
	KeyboardAvoidingView,
	ScrollView,
	StyleSheet,
	TextInput,
	View,
} from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { Motion, Radii, Spacing } from "@/constants/theme";
import { useQuestion } from "@/features/question/question-context";
import { WEEKLY_ANSWER_MAX_LENGTH } from "@/features/question/types";
import { useSpace } from "@/features/space/space-context";
import { useThemeColor } from "@/hooks/use-theme-color";

const REVEAL_ANIMATION = FadeIn.duration(Motion.slow).reduceMotion(
	ReduceMotion.System,
);

function AnswerCard({
  answer,
  label,
  labelColor,
}: {
  answer: string;
  label: string;
  labelColor: string;
}) {
  return (
    <Animated.View entering={REVEAL_ANIMATION}>
      <Surface style={styles.answerCard}>
        <ThemedText type="meta" style={{ color: labelColor }}>
          {label}
        </ThemedText>
        <ThemedText type="body" selectable>
          {answer}
        </ThemedText>
      </Surface>
    </Animated.View>
  );
}

/**
 * "One question this week" — an optional, never-nagging ritual. One
 * handcrafted question per ISO week; both partners answer privately, and the
 * answers reveal only when both are in. Until then the screen shows just your
 * own words and a soft note about the unlock — no badges, no pressure.
 */
export default function QuestionScreen() {
	const insets = useSafeAreaInsets();
	const isIos = process.env.EXPO_OS === "ios";
	const { state, isLoading, error, isSaving, submitAnswer, reload } =
		useQuestion();
	const { space } = useSpace();
	const accent = useThemeColor({}, "accent");
	const background = useThemeColor({}, "background");
	const muted = useThemeColor({}, "muted");
	const partnerAccent = useThemeColor({}, "partnerAccent");
	const text = useThemeColor({}, "text");
	const warning = useThemeColor({}, "warning");
	const [draft, setDraft] = useState("");
	const [isEditingRevealed, setIsEditingRevealed] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const adoptedWeekRef = useRef<string | null>(null);

	const partnerName = state?.partnerName ?? space?.partnerName ?? "them";
	const hasSavedAnswer = state?.yourAnswer != null;
	const showComposer = !state?.revealed || isEditingRevealed;

	// Adopt each fresh week exactly once: prefill the draft with the saved
	// answer and settle the reveal/edit mode. Re-loading the same week (app
	// focus) must never clobber what is being typed.
	useEffect(() => {
		if (!state || adoptedWeekRef.current === state.weekKey) {
			return;
		}

		adoptedWeekRef.current = state.weekKey;
		setDraft(state.yourAnswer ?? "");
		setIsEditingRevealed(false);
		setSaveError(null);
	}, [state]);

	const trimmedDraft = draft.trim();
	const canSave = trimmedDraft.length > 0 && !isSaving;

	const handleSave = useCallback(async () => {
		if (!canSave) {
			return;
		}

		setSaveError(null);

		try {
			await submitAnswer(trimmedDraft);
			setIsEditingRevealed(false);
		} catch {
			setSaveError(
				"Your answer couldn't be saved right now, try again in a moment.",
			);
		}
	}, [canSave, submitAnswer, trimmedDraft]);

	const handleEditRevealed = useCallback(() => {
		setIsEditingRevealed(true);
	}, []);

  const scrollContentStyle = useMemo(
    () => [
      styles.scrollContent,
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
      <Stack.Screen options={{ title: "This week" }} />
      <ScrollView
        contentContainerStyle={scrollContentStyle}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
				{isLoading && !state ? (
					<View style={styles.center}>
						<ActivityIndicator color={accent} />
					</View>
				) : error && !state ? (
					<Surface style={styles.errorCard}>
						<ThemedText type="caption" style={{ color: muted }}>
							{error}
						</ThemedText>
						<View style={styles.retrySpacer} />
						<Button
							label="Try again"
							onPress={() => void reload()}
							variant="secondary"
						/>
					</Surface>
				) : state ? (
					<>
						<View style={styles.promptBlock}>
							<ThemedText type="caption" style={{ color: muted }}>
								One question this week, answer whenever you like.
							</ThemedText>
							<ThemedText type="title" accessibilityRole="header">
								{state.question}
							</ThemedText>
						</View>

						{showComposer ? (
							<Surface style={styles.composer}>
								<TextInput
									accessibilityLabel="Your reflection answer"
									maxLength={WEEKLY_ANSWER_MAX_LENGTH}
									multiline
									onChangeText={setDraft}
									placeholder="Something small and true…"
									placeholderTextColor={muted}
									style={[styles.input, { color: text }]}
									textAlignVertical="top"
									value={draft}
								/>
								{saveError ? (
									<ThemedText type="caption" style={{ color: muted }}>
										{saveError}
									</ThemedText>
								) : null}
								<View style={styles.controlStack}>
									<Button
										disabled={!canSave}
										label={hasSavedAnswer ? "Update my answer" : "Keep my answer"}
										onPress={() => void handleSave()}
									/>
									{hasSavedAnswer && !state.revealed ? (
										<View style={styles.lockedRow}>
											<View style={[styles.lockedDot, { backgroundColor: warning }]} />
											<ThemedText type="caption" style={{ color: warning }}>
												Saved. It unlocks when {partnerName} has written too.
											</ThemedText>
										</View>
									) : null}
								</View>
							</Surface>
						) : (
							<View style={styles.revealGroup}>
								<AnswerCard
									answer={state.yourAnswer ?? ""}
									label="You"
									labelColor={accent}
								/>
								<AnswerCard
									answer={state.partnerAnswer ?? ""}
									label={partnerName}
									labelColor={partnerAccent}
								/>
								<View style={styles.editWrap}>
									<Button
										label="Edit my answer"
										onPress={handleEditRevealed}
										variant="ghost"
									/>
								</View>
							</View>
						)}
					</>
				) : null}
      </ScrollView>
    </KeyboardAvoidingView>
	);
}

const styles = StyleSheet.create({
	root: {
		flex: 1,
	},
	scrollContent: {
		flexGrow: 1,
		gap: Spacing[16],
		paddingHorizontal: Spacing[16],
	},
	center: {
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
	},
	promptBlock: {
		gap: Spacing[8],
	},
	errorCard: {
		alignItems: "stretch",
		gap: Spacing[4],
		padding: Spacing[16],
		borderRadius: Radii.lg,
	},
	retrySpacer: {
		height: Spacing[8],
	},
	composer: {
		gap: Spacing[12],
		padding: Spacing[16],
		borderRadius: Radii.lg,
	},
	input: {
		fontSize: 17,
		lineHeight: 24,
		minHeight: 112,
		textAlignVertical: "top",
	},
	controlStack: {
		gap: Spacing[8],
	},
	lockedRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: Spacing[8],
	},
	lockedDot: {
		width: 8,
		height: 8,
		borderRadius: Radii.pill,
		flexShrink: 0,
	},
	answerCard: {
		gap: Spacing[8],
		borderRadius: Radii.lg,
	},
	revealGroup: {
		gap: Spacing[12],
	},
	editWrap: {
		alignItems: "center",
	},
});
