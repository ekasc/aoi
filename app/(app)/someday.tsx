import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Stack } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
	ActivityIndicator,
	KeyboardAvoidingView,
	Pressable,
	ScrollView,
	StyleSheet,
	TextInput,
	View,
} from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Button } from "@/components/ui/button";
import { Divider } from "@/components/ui/divider";
import { Surface } from "@/components/ui/surface";
import { Motion, Radii, Spacing } from "@/constants/theme";
import { useSomeday } from "@/features/someday/someday-context";
import type { SomedayCategory, SomedayItem } from "@/features/someday/types";
import { SOMEDAY_TITLE_MAX_LENGTH } from "@/features/someday/types";
import { useSpace } from "@/features/space/space-context";
import { useThemeColor } from "@/hooks/use-theme-color";

const CATEGORY_LABELS: Record<SomedayCategory, string> = {
	place: "Place",
	food: "Food",
	film: "Film",
	other: "Other",
};

const CATEGORY_ORDER: SomedayCategory[] = ["place", "food", "film", "other"];

const ROW_ANIMATION = FadeIn.duration(Motion.base).reduceMotion(
	ReduceMotion.System,
);

function formatCheckedDay(iso: string) {
	const date = new Date(iso);

	if (Number.isNaN(date.getTime())) {
		return "";
	}

	return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function OpenRow({
	item,
	border,
	muted,
	partnerName,
	text,
	onCheck,
}: {
	item: SomedayItem;
	border: string;
	muted: string;
	partnerName: string;
	text: string;
	onCheck: (itemId: string) => void;
}) {
	const addedBy =
		item.createdByRole === "you" ? "you" : partnerName;

	return (
		<Animated.View entering={ROW_ANIMATION}>
			<View style={styles.row}>
				<Pressable
					accessibilityLabel={`Check off: ${item.title}`}
					accessibilityRole="button"
					hitSlop={Spacing[8]}
					onPress={() => onCheck(item.id)}
					style={[styles.checkCircle, { borderColor: border }]}
				/>
				<View style={styles.rowTextBlock}>
					<ThemedText type="body" selectable style={{ color: text }}>
						{item.title}
					</ThemedText>
					{item.note ? (
						<ThemedText type="caption" style={{ color: muted }}>
							{item.note}
						</ThemedText>
					) : null}
					<ThemedText type="meta" style={{ color: muted }}>
						{CATEGORY_LABELS[item.category]} · added by {addedBy}
					</ThemedText>
				</View>
			</View>
		</Animated.View>
	);
}

function DoneRow({
	item,
	background,
	muted,
	partnerName,
	onUndo,
}: {
	item: SomedayItem;
	background: string;
	muted: string;
	partnerName: string;
	onUndo: (itemId: string) => void;
}) {
	const checkedDay = item.checkedAt ? formatCheckedDay(item.checkedAt) : "";
	const checkedLabel =
		item.checkedByRole === "partner"
			? `${partnerName} checked it off`
			: "You checked it off";

	return (
		<Animated.View entering={ROW_ANIMATION}>
			<Pressable
				accessibilityLabel={`Undo check-off: ${item.title}`}
				accessibilityRole="button"
				onPress={() => onUndo(item.id)}
				style={styles.row}
			>
				<View style={[styles.checkCircleDone, { backgroundColor: muted }]}>
					<Ionicons color={background} name="checkmark" size={14} />
				</View>
				<View style={styles.rowTextBlock}>
					<ThemedText
						type="body"
						style={{ color: muted, textDecorationLine: "line-through" }}
					>
						{item.title}
					</ThemedText>
					<ThemedText type="meta" style={{ color: muted }}>
						{checkedLabel}
						{checkedDay ? ` · ${checkedDay}` : ""}
					</ThemedText>
				</View>
			</Pressable>
		</Animated.View>
	);
}

/**
 * The Someday list: places to go, films to watch, tables for two. One shared
 * list for the two of you — add a wish, check it off together, undo without
 * drama when plans reopen.
 */
export default function SomedayScreen() {
	const insets = useSafeAreaInsets();
	const isIos = process.env.EXPO_OS === "ios";
	const {
		openItems,
		doneItems,
		isLoading,
		error,
		addItem,
		setChecked,
		reload,
	} = useSomeday();
	const { space } = useSpace();
	const accent = useThemeColor({}, "accent");
	const background = useThemeColor({}, "background");
	const border = useThemeColor({}, "border");
	const muted = useThemeColor({}, "muted");
	const onAccent = useThemeColor({}, "onAccent");
	const surface = useThemeColor({}, "surface");
	const text = useThemeColor({}, "text");
	const [draft, setDraft] = useState("");
	const [category, setCategory] = useState<SomedayCategory>("place");
	const [isSaving, setIsSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);

	const partnerName = space?.partnerName ?? "them";
	const trimmedDraft = draft.trim();
	const canSave = trimmedDraft.length > 0 && !isSaving;

	const handleAdd = useCallback(async () => {
		if (!canSave) {
			return;
		}

		setIsSaving(true);
		setSaveError(null);

		try {
			await addItem({ title: trimmedDraft, category });
			setDraft("");
		} catch {
			setSaveError("Couldn't add that one — try again in a moment.");
		} finally {
			setIsSaving(false);
		}
	}, [addItem, canSave, category, trimmedDraft]);

	const handleCheck = useCallback(
		(itemId: string) => {
			void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
			void setChecked(itemId, true);
		},
		[setChecked],
	);

	const handleUndo = useCallback(
		(itemId: string) => {
			void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
			void setChecked(itemId, false);
		},
		[setChecked],
	);

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
			<Stack.Screen options={{ title: "Someday" }} />
			<ScrollView
				contentContainerStyle={contentContainerStyle}
				keyboardShouldPersistTaps="handled"
				showsVerticalScrollIndicator={false}
			>
				<ThemedText type="caption" style={{ color: muted }}>
					Places to go, films to watch, tables for two.
				</ThemedText>

				<Surface style={styles.composer}>
					<TextInput
						maxLength={SOMEDAY_TITLE_MAX_LENGTH}
						onChangeText={setDraft}
						onSubmitEditing={() => void handleAdd()}
						placeholder="Something for someday…"
						placeholderTextColor={muted}
						returnKeyType="done"
						style={[styles.input, { color: text }]}
						value={draft}
					/>
					<ScrollView
						contentContainerStyle={styles.categoryRow}
						horizontal
						showsHorizontalScrollIndicator={false}
					>
						{CATEGORY_ORDER.map((value) => {
							const isActive = category === value;

							return (
								<Pressable
									accessibilityRole="button"
									accessibilityState={{ selected: isActive }}
									key={value}
									onPress={() => setCategory(value)}
									style={[
										styles.categoryChip,
										{
											backgroundColor: isActive ? accent : surface,
											borderColor: isActive ? accent : border,
										},
									]}
								>
									<ThemedText
										type="meta"
										style={{ color: isActive ? onAccent : muted }}
									>
										{CATEGORY_LABELS[value]}
									</ThemedText>
								</Pressable>
							);
						})}
					</ScrollView>
					{saveError ? (
						<ThemedText type="caption" style={{ color: muted }}>
							{saveError}
						</ThemedText>
					) : null}
					<Pressable
						accessibilityLabel="Add to the someday list"
						accessibilityRole="button"
						disabled={!canSave}
						onPress={() => void handleAdd()}
						style={[
							styles.addButton,
							{ backgroundColor: accent, opacity: canSave ? 1 : 0.4 },
						]}
					>
						<ThemedText type="meta" style={{ color: onAccent }}>
							Add it
						</ThemedText>
					</Pressable>
				</Surface>

				{isLoading ? (
					<View style={styles.center}>
						<ActivityIndicator color={accent} />
					</View>
				) : error && openItems.length === 0 && doneItems.length === 0 ? (
					<Surface style={styles.emptyCard}>
						<ThemedText type="caption" style={{ color: muted }}>
							{error}
						</ThemedText>
						<View style={styles.retrySpacer} />
						<Button label="Try again" onPress={() => void reload()} variant="secondary" />
					</Surface>
				) : (
					<>
						<ThemedText type="meta" style={styles.sectionHeader}>
							Someday
						</ThemedText>
						<Surface style={styles.listCard}>
							{openItems.length === 0 ? (
								<ThemedText type="caption" style={{ color: muted }}>
									Nothing here yet. What will the two of you do someday?
								</ThemedText>
							) : (
								openItems.map((item, index) => (
									<View key={item.id}>
										{index > 0 ? <Divider /> : null}
										<OpenRow
											border={border}
											item={item}
											muted={muted}
											onCheck={handleCheck}
											partnerName={partnerName}
											text={text}
										/>
									</View>
								))
							)}
						</Surface>

						{doneItems.length > 0 ? (
							<>
								<ThemedText type="meta" style={styles.sectionHeader}>
									Done together
								</ThemedText>
								<Surface style={styles.listCard}>
									{doneItems.map((item, index) => (
										<View key={item.id}>
											{index > 0 ? <Divider /> : null}
											<DoneRow
												background={background}
												item={item}
												muted={muted}
												onUndo={handleUndo}
												partnerName={partnerName}
											/>
										</View>
									))}
								</Surface>
							</>
						) : null}
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
	composer: {
		gap: Spacing[12],
		padding: Spacing[16],
	},
	input: {
		fontSize: 17,
		lineHeight: 24,
		minHeight: 40,
	},
	categoryRow: {
		gap: Spacing[8],
	},
	categoryChip: {
		borderRadius: Radii.pill,
		borderWidth: 1,
		paddingHorizontal: Spacing[12],
		paddingVertical: 6,
	},
	addButton: {
		alignItems: "center",
		borderRadius: Radii.pill,
		minHeight: 44,
		justifyContent: "center",
		paddingVertical: Spacing[12],
	},
	sectionHeader: {
		marginTop: Spacing[8],
	},
	listCard: {
		paddingHorizontal: Spacing[16],
		paddingVertical: Spacing[4],
	},
	emptyCard: {
		alignItems: "stretch",
		gap: Spacing[4],
		padding: Spacing[16],
	},
	retrySpacer: {
		height: Spacing[8],
	},
	center: {
		alignItems: "center",
		justifyContent: "center",
		paddingVertical: Spacing[40],
	},
	row: {
		alignItems: "center",
		flexDirection: "row",
		gap: Spacing[12],
		paddingVertical: Spacing[12],
	},
	rowTextBlock: {
		flex: 1,
		gap: 2,
	},
	checkCircle: {
		alignItems: "center",
		borderRadius: Radii.pill,
		borderWidth: 1.5,
		height: 26,
		justifyContent: "center",
		width: 26,
	},
	checkCircleDone: {
		alignItems: "center",
		borderRadius: Radii.pill,
		height: 26,
		justifyContent: "center",
		opacity: 0.7,
		width: 26,
	},
});
