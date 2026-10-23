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
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Reveal } from '@/components/ui/reveal';
import { ThemedText } from "@/components/themed-text";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { Motion, Radii, Spacing } from "@/constants/theme";
import { Typography } from "@/constants/typography";
import { useQuestion } from "@/features/question/question-context";
import { WEEKLY_ANSWER_MAX_LENGTH } from "@/features/question/types";
import { useSpace } from "@/features/space/space-context";
import { useThemeColor } from "@/hooks/use-theme-color";
import { relationshipCopy } from "@/features/relationship/relationship-age";
import { useRelationshipAge } from "@/features/relationship/use-relationship-age";

const SAVE_COUNTER_VISIBLE_FROM = 400;

function AnswerCard({
  answer,
  label,
  labelColor,
  index,
}: {
  answer: string;
  label: string;
  labelColor: string;
  index: number;
}) {
  return (
    <Animated.View entering={Reveal.up(Motion.slow).delay(Reveal.stagger(index))}>
      <Surface style={styles.answerCard}>
        <ThemedText type="meta" style={{ color: labelColor }}>
          {label}
        </ThemedText>
        <ThemedText selectable style={styles.answerBody}>
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
	const copy = relationshipCopy(useRelationshipAge(space?.relationshipStartDate).tone);
	const accentInk = useThemeColor({}, "accentInk");
	const background = useThemeColor({}, "background");
	const muted = useThemeColor({}, "muted");
	const partnerAccentInk = useThemeColor({}, "partnerAccentInk");
	const text = useThemeColor({}, "text");
	const danger = useThemeColor({}, "danger");
	const [draft, setDraft] = useState("");
	const [isEditingRevealed, setIsEditingRevealed] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const adoptedWeekRef = useRef<string | null>(null);

	const partnerName = state?.partnerName ?? space?.partnerName ?? "your partner";
	const hasSavedAnswer = state?.yourAnswer != null;
	// The composer is only the writing surface: once your words are kept they
	// rest as read-only text (waiting) or beside your partner's (revealed)
	// until you choose to edit them again.
	const showComposer = !hasSavedAnswer || isEditingRevealed;

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

	const handleEditAnswer = useCallback(() => {
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
						<ActivityIndicator color={accentInk} />
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
								{copy.reflectionIntro}
							</ThemedText>
							<ThemedText type="title" accessibilityRole="header">
								{state.question}
							</ThemedText>
							{!hasSavedAnswer && !state.partnerAnswered ? (
								<ThemedText accessibilityLiveRegion="polite" type="caption" style={{ color: muted }}>
									No answers yet. Skipped weeks simply pass — the next question arrives whenever you like.
								</ThemedText>
							) : null}
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
								{draft.length >= SAVE_COUNTER_VISIBLE_FROM ? (
									<ThemedText type="caption" style={{ color: muted }}>
										{WEEKLY_ANSWER_MAX_LENGTH - draft.length} characters left
									</ThemedText>
								) : null}
								{saveError ? (
									<View style={styles.errorStack}>
										<ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>
											{saveError}
										</ThemedText>
										<Button
											disabled={!canSave}
											label="Try again"
											onPress={() => void handleSave()}
											size="sm"
											variant="secondary"
										/>
									</View>
								) : null}
								<View style={styles.controlStack}>
									<Button
										disabled={!canSave}
										label={hasSavedAnswer ? "Update my answer" : "Keep my answer"}
										onPress={() => void handleSave()}
									/>
								</View>
							</Surface>
						) : state.revealed ? (
							<View style={styles.revealGroup}>
								<ThemedText accessibilityLiveRegion="polite" type="caption" style={{ color: muted }}>
									Both answers are here.
								</ThemedText>
								<AnswerCard
									answer={state.yourAnswer ?? ""}
									label="You"
									labelColor={accentInk}
									index={0}
								/>
								<AnswerCard
									answer={state.partnerAnswer ?? ""}
									label={partnerName}
									labelColor={partnerAccentInk}
									index={1}
								/>
								<View style={styles.editWrap}>
									<Button
										label="Edit my answer"
										onPress={handleEditAnswer}
										variant="ghost"
									/>
								</View>
							</View>
						) : (
							<Surface style={styles.composer}>
								<ThemedText accessibilityLiveRegion="polite" type="body" style={{ color: text }}>
									Saved. It unlocks when {partnerName} has written too.
								</ThemedText>
								<ThemedText type="meta" style={{ color: accentInk }}>
									You
								</ThemedText>
								<ThemedText selectable style={styles.answerBody}>
									{state.yourAnswer ?? ""}
								</ThemedText>
								<Button
									label="Update my answer"
									onPress={handleEditAnswer}
									variant="secondary"
								/>
							</Surface>
						)}
					</>
				) : (
					<ThemedText accessibilityLiveRegion="polite" type="body" style={{ color: muted }}>
						No reflection available yet.
					</ThemedText>
				)}
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
		...Typography.inputDisplay,
		minHeight: 112,
		textAlignVertical: "top",
	},
	controlStack: {
		gap: Spacing[8],
	},
	errorStack: {
		gap: Spacing[8],
	},
	answerBody: {
		...Typography.readBody,
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
