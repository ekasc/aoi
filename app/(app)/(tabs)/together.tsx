import { FrostedBackdrop } from '@/components/ui/frosted-backdrop';
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useIsFocused, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	ActivityIndicator,
	AppState,
	Pressable,
	ScrollView,
	StyleSheet,
	View,
} from "react-native";
import Animated, {
	useAnimatedStyle,
	useReducedMotion,
	useSharedValue,
	withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MemorySky, SYSTEM_TAB_BAR_IOS_CLEARANCE } from "@/components/home/memory-sky";
import { ThemedText } from "@/components/themed-text";
import { Button } from "@/components/ui/button";
import { ScreenHeader } from "@/components/ui/screen-header";
import { Radii, Spacing } from "@/constants/theme";
import {
	findReadyLetter,
	isQuestionUnanswered,
} from "@/features/home/us-focal";
import { useLetters } from "@/features/letters/letters-context";
import { useMoments } from "@/features/moments/moments-context";
import { useQuestion } from "@/features/question/question-context";
import { useSqueeze } from "@/features/squeeze/squeeze-context";
import { useSpace } from "@/features/space/space-context";
import { getDaysTogether } from "@/features/time-together/time-together";
import { useThemeColor } from "@/hooks/use-theme-color";

type CaptureKind = "photo" | "note" | "voice";

const KEEP_TARGETS: ReadonlyArray<{
	kind: CaptureKind;
	label: string;
	icon: keyof typeof Ionicons.glyphMap;
	a11y: string;
}> = [
	{ kind: "photo", label: "Photo", icon: "camera", a11y: "Keep a photo memory" },
	{ kind: "note", label: "Note", icon: "pencil", a11y: "Keep a note memory" },
	{ kind: "voice", label: "Voice", icon: "mic", a11y: "Keep a voice memory" },
];

const SQUEEZE_SENT_VISIBLE_MS = 3000;
const SQUEEZE_THUMP_GAP_MS = 120;
const SQUEEZE_BOUNCE_FROM = 0.94;
const SQUEEZE_BOUNCE_MS = 400;


/**
 * Calm Us home: sky + caption stay untouched, then a centered Squeeze pill
 * as the main connection action, a single secondary Keep a memory toggle
 * with inline Photo/Note/Voice shortcuts to Memories on request (progressive disclosure), and a
 * quiet stacked Letters/Reflection pair with body typography and chevrons.
 * No focal hero, no duplicate question text, no capture trio until asked.
 * Press feedback stays instant (opacity + scale); squeeze send adds a
 * heartbeat double-thump plus a 0.94 to 1 bounce that sets instantly under
 * reduced motion. The clock refreshes on focus/app activation only; no
 * repeating timers.
 */
export default function TogetherScreen() {
	const router = useRouter();
	const isFocused = useIsFocused();
	const insets = useSafeAreaInsets();
	const muted = useThemeColor({}, "muted");
	const background = useThemeColor({}, "background");
	const primary = useThemeColor({}, "primary");
	const primaryPressed = useThemeColor({}, "primaryPressed");
	const primaryText = useThemeColor({}, "primaryText");
	const surface = useThemeColor({}, "surface");
	const borderStrong = useThemeColor({}, "borderStrong");
	const textPrimary = useThemeColor({}, "textPrimary");

	const {
		letters,
		isLoading: lettersLoading,
		error: lettersError,
		reload: reloadLetters,
	} = useLetters();
	const {
		state: questionState,
		isLoading: questionLoading,
		error: questionError,
		reload: reloadQuestion,
	} = useQuestion();
	const { moments } = useMoments();
	const { sendSqueeze, isSending: isSqueezeSending } = useSqueeze();
	const { space } = useSpace();
	const reduceMotion = useReducedMotion();
	const squeezeScale = useSharedValue(1);
	const squeezeBounceStyle = useAnimatedStyle(() => ({
		transform: [{ scale: squeezeScale.value }],
	}));

	const [now, setNow] = useState(() => new Date());
	const [squeezeMessage, setSqueezeMessage] = useState<string | null>(null);
	const [squeezeSent, setSqueezeSent] = useState(false);
	const [keepExpanded, setKeepExpanded] = useState(false);
	const sentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const squeezeThumpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useFocusEffect(
		useCallback(() => {
			setNow(new Date());
		}, []),
	);

	useEffect(() => {
		const subscription = AppState.addEventListener("change", (state) => {
			if (state === "active") {
				setNow(new Date());
			}
		});
		return () => subscription.remove();
	}, []);

	useEffect(() => {
		return () => {
			if (sentTimer.current) {
				clearTimeout(sentTimer.current);
			}
			if (squeezeThumpTimer.current) {
				clearTimeout(squeezeThumpTimer.current);
				squeezeThumpTimer.current = null;
			}
		};
	}, []);

	const safeLetters = useMemo(() => (Array.isArray(letters) ? letters : []), [letters]);
	const safeMoments = useMemo(() => (Array.isArray(moments) ? moments : []), [moments]);
	const daysTogether = useMemo(
		() => getDaysTogether(space?.relationshipStartDate, now),
		[space?.relationshipStartDate, now],
	);

	const readyLetter = useMemo(
		() => findReadyLetter(safeLetters, now),
		[safeLetters, now],
	);
	const reflectionSubtitle = useMemo(() => {
		if (!questionState) {
			return "This week";
		}
		if (questionState.revealed) {
			return "Answers are ready";
		}
		if (!isQuestionUnanswered(questionState)) {
			return "Waiting for your partner";
		}
		return "This week";
	}, [questionState]);

	const handleOpenLetters = useCallback(() => {
		router.push("/(app)/letters");
	}, [router]);
	const handleOpenQuestion = useCallback(() => {
		router.push("/(app)/question");
	}, [router]);
	const handleToggleKeep = useCallback(() => {
		setKeepExpanded((value) => !value);
	}, []);
	// Unified capture: Us never records or saves directly. Each Keep target
	// routes to Memories with a contextual composer intent (photo library,
	// note focus, voice option). Recording starts only from deliberate hold
	// inside Memories — never from a param.
	const handleCapture = useCallback(
		(capture: CaptureKind) => {
			const compose = capture === "photo" ? "photos" : capture;
			router.push({
				pathname: "/(app)/(tabs)/(memories)" as const,
				params: { compose },
			});
		},
		[router],
	);
	const handleSqueeze = useCallback(() => {
		if (isSqueezeSending) {
			return;
		}
		setSqueezeMessage(null);
		setSqueezeSent(false);
		if (sentTimer.current) {
			clearTimeout(sentTimer.current);
			sentTimer.current = null;
		}
		if (squeezeThumpTimer.current) {
			clearTimeout(squeezeThumpTimer.current);
			squeezeThumpTimer.current = null;
		}
		// Heartbeat double-thump: two Medium haptics ~120ms apart. Press
		// feedback stays instant (opacity + scale); the send bounce below
		// is the only spring, gated for reduced motion.
		void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
		squeezeThumpTimer.current = setTimeout(() => {
			squeezeThumpTimer.current = null;
			void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
		}, SQUEEZE_THUMP_GAP_MS);
		void Promise.resolve()
			.then(() => sendSqueeze())
			.then(() => {
				setSqueezeSent(true);
				if (reduceMotion) {
					squeezeScale.value = 1;
				} else {
					squeezeScale.value = SQUEEZE_BOUNCE_FROM;
					squeezeScale.value = withSpring(1, { duration: SQUEEZE_BOUNCE_MS });
				}
				if (sentTimer.current) {
					clearTimeout(sentTimer.current);
				}
				sentTimer.current = setTimeout(() => {
					setSqueezeSent(false);
					sentTimer.current = null;
				}, SQUEEZE_SENT_VISIBLE_MS);
			})
			.catch(() => {
				setSqueezeSent(false);
				setSqueezeMessage("Couldn't send the squeeze. Try again.");
			});
	}, [isSqueezeSending, reduceMotion, sendSqueeze, squeezeScale]);

	const contentContainerStyle = useMemo(
		() => [
			styles.contentContainer,
			{
				paddingTop: insets.top + Spacing[8],
				paddingBottom:
					insets.bottom +
					Spacing[24] +
					(process.env.EXPO_OS === 'ios'
						? SYSTEM_TAB_BAR_IOS_CLEARANCE
						: 0),
			},
		],
		[insets.bottom, insets.top],
	);

	const lettersLoadingEmpty = lettersLoading && safeLetters.length === 0;
	const lettersErrorEmpty = Boolean(lettersError) && safeLetters.length === 0;
	const questionLoadingEmpty = questionLoading && !questionState;
	const questionErrorEmpty = Boolean(questionError) && !questionState;

	return (
		<ScrollView
			style={[styles.pageShell, { backgroundColor: background }]}
			contentContainerStyle={contentContainerStyle}
			contentInsetAdjustmentBehavior="never"
			showsVerticalScrollIndicator={false}
		>
			<FrostedBackdrop />
			<ScreenHeader title="Us" />

			<MemorySky moments={safeMoments} daysTogether={daysTogether} startDate={space?.relationshipStartDate ?? null} focused={isFocused} />

			<View style={styles.squeezeWrap}>
				<Animated.View style={squeezeBounceStyle}>
				<Pressable
					accessibilityLabel="Send a squeeze to your partner"
					accessibilityRole="button"
					accessibilityState={{ disabled: isSqueezeSending }}
					disabled={isSqueezeSending}
					onPress={handleSqueeze}
					style={({ pressed }) => [
						styles.squeezePill,
						{
							backgroundColor:
								pressed && !isSqueezeSending ? primaryPressed : primary,
							borderColor: primary,
						},
						pressed && !isSqueezeSending ? styles.squeezePillPressed : undefined,
						isSqueezeSending ? styles.squeezePillDisabled : undefined,
					]}
				>
					<Ionicons color={primaryText} name="heart" size={16} />
					<ThemedText type="bodyEmphasis" style={{ color: primaryText }}>
						{isSqueezeSending
							? "Sending…"
							: squeezeSent
								? "Squeeze sent"
								: "Squeeze"}
					</ThemedText>
				</Pressable>
				</Animated.View>
			</View>
			{squeezeMessage ? (
				<ThemedText type="caption" style={{ color: muted }}>
					{squeezeMessage}
				</ThemedText>
			) : null}

			<View style={styles.keepSection}>
				<Button
					label="Keep a memory"
					variant="secondary"
					onPress={handleToggleKeep}
					accessibilityState={{ expanded: keepExpanded }}
					accessibilityHint={
						keepExpanded
							? "Hides photo, note, and voice options"
							: "Shows photo, note, and voice options"
					}
				/>
				{keepExpanded ? (
					<>
						<View style={styles.keepRow}>
							{KEEP_TARGETS.map((target) => {
								return (
									<Pressable
										key={target.kind}
										accessibilityLabel={target.a11y}
										accessibilityRole="button"
										onPress={() => handleCapture(target.kind)}
										style={({ pressed }) => [
											styles.keepTarget,
											{ backgroundColor: surface, borderColor: borderStrong },
											pressed ? styles.keepTargetPressed : undefined,
										]}
									>
										<Ionicons color={primary} name={target.icon} size={22} />
										<ThemedText type="label" style={{ color: textPrimary }}>
											{target.label}
										</ThemedText>
									</Pressable>
								);
							})}
						</View>
						<ThemedText type="caption" style={{ color: muted }}>
							Kept in Memories — voice records there
						</ThemedText>
					</>
				) : null}
			</View>

			<View style={styles.rows}>
				<View style={styles.rowBlock}>
					<Pressable
						accessibilityLabel="Letters"
						accessibilityRole="button"
						onPress={handleOpenLetters}
						style={({ pressed }) => [
							styles.row,
							{ backgroundColor: surface, borderColor: borderStrong },
							pressed ? styles.rowPressed : undefined,
						]}
					>
						<View style={styles.rowText}>
							<ThemedText type="body">Letters</ThemedText>
							{lettersLoadingEmpty ? (
								<ActivityIndicator accessibilityLabel="Loading" size="small" />
							) : lettersErrorEmpty || !readyLetter ? null : (
								<ThemedText type="caption" style={{ color: muted }}>
									Ready to open
								</ThemedText>
							)}
						</View>
						<Ionicons color={muted} name="chevron-forward" size={16} />
					</Pressable>
					{lettersErrorEmpty ? (
						<View style={styles.inlineError}>
							<ThemedText type="caption" style={{ color: muted }}>
								Letters aren&apos;t loading
							</ThemedText>
							<Button
								label="Try again"
								variant="secondary"
								size="sm"
								onPress={() => void reloadLetters?.()}
							/>
						</View>
					) : null}
				</View>

				<View style={styles.rowBlock}>
					<Pressable
						accessibilityLabel="Reflection"
						accessibilityRole="button"
						onPress={handleOpenQuestion}
						style={({ pressed }) => [
							styles.row,
							{ backgroundColor: surface, borderColor: borderStrong },
							pressed ? styles.rowPressed : undefined,
						]}
					>
						<View style={styles.rowText}>
							<ThemedText type="body">Reflection</ThemedText>
							{questionLoadingEmpty ? (
								<ActivityIndicator accessibilityLabel="Loading" size="small" />
							) : questionErrorEmpty ? null : (
								<ThemedText type="caption" style={{ color: muted }}>
									{reflectionSubtitle}
								</ThemedText>
							)}
						</View>
						<Ionicons color={muted} name="chevron-forward" size={16} />
					</Pressable>
					{questionErrorEmpty ? (
						<View style={styles.inlineError}>
							<ThemedText type="caption" style={{ color: muted }}>
								This week isn&apos;t loading
							</ThemedText>
							<Button
								label="Try again"
								variant="secondary"
								size="sm"
								onPress={() => void reloadQuestion?.()}
							/>
						</View>
					) : null}
				</View>
			</View>
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	pageShell: {
		flex: 1,
	},
	contentContainer: {
		gap: Spacing[16],
		paddingHorizontal: Spacing[16],
	},
	keepSection: {
		gap: Spacing[8],
	},
	keepRow: {
		flexDirection: "row",
		gap: Spacing[8],
	},
	keepTarget: {
		flex: 1,
		minWidth: 44,
		minHeight: 64,
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: Radii.lg,
		alignItems: "center",
		justifyContent: "center",
		gap: Spacing[4],
		paddingVertical: Spacing[12],
		paddingHorizontal: Spacing[8],
	},
	keepTargetPressed: {
		opacity: 0.9,
		transform: [{ scale: 0.96 }],
	},
	rows: {
		gap: Spacing[8],
	},
	rowBlock: {
		gap: Spacing[4],
	},
	row: {
		minWidth: 44,
		minHeight: 48,
		flexDirection: "row",
		alignItems: "center",
		gap: Spacing[12],
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: Radii.lg,
		paddingVertical: Spacing[12],
		paddingHorizontal: Spacing[12],
	},
	rowText: {
		flex: 1,
		gap: 2,
	},
	rowPressed: {
		opacity: 0.9,
		transform: [{ scale: 0.98 }],
	},
	inlineError: {
		gap: Spacing[4],
		paddingTop: Spacing[4],
	},
	squeezeWrap: {
		alignItems: "center",
		justifyContent: "center",
	},
	squeezePill: {
		minHeight: 44,
		minWidth: 44,
		alignSelf: "center",
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		gap: Spacing[8],
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: Radii.pill,
		paddingVertical: Spacing[8],
		paddingHorizontal: Spacing[16],
	},
	squeezePillPressed: {
		opacity: 0.95,
		transform: [{ scale: 0.98 }],
	},
	squeezePillDisabled: {
		opacity: 0.75,
	},
});
