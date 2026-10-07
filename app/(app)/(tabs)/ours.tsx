import { Ionicons } from "@expo/vector-icons";
import { useIsFocused, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
	ActivityIndicator,
	Pressable,
	ScrollView,
	Share,
	StyleSheet,
	useWindowDimensions,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fabBottomOffset } from "@/components/home/compact-sky-geometry";
import { OurLists } from "@/components/collections/our-lists";
import { compactSkyHeightForWindow, MemorySky } from "@/components/home/memory-sky";
import { ScreenHeader } from "@/components/ui/screen-header";
import { ThemedText } from "@/components/themed-text";
import { Button } from "@/components/ui/button";
import { GlassSurface } from "@/components/ui/glass-surface";
import { Surface } from "@/components/ui/surface";
import { Elevation, shadow, Spacing, withAlpha } from "@/constants/theme";
import { useSession } from "@/features/session/session-context";
import { useSpace } from "@/features/space/space-context";
import { inviteMessage } from "@/features/space/invite-code";
import { useMoments } from "@/features/moments/moments-context";
import { getDaysTogether } from "@/features/time-together/time-together";
import { useAoiTheme } from "@/features/theme/theme-context";
import { useThemeColor } from "@/hooks/use-theme-color";

function formatInviteExpiry(value: string | null | undefined) {
	if (!value) {
		return null;
	}
	const date = new Date(value);

	if (Number.isNaN(date.getTime())) {
		return null;
	}

	return date.toLocaleDateString("en-US", {
		month: "long",
		day: "numeric",
		year: "numeric",
	});
}

function InfoRow({
	label,
	value,
	caption,
	muted,
	dividerColor,
}: {
	label: string;
	value: string;
	caption?: string;
	muted: string;
	dividerColor?: string;
}) {
	return (
		<View
			style={[
				styles.infoRow,
				dividerColor
					? { borderTopWidth: StyleSheet.hairlineWidth, borderColor: dividerColor }
					: null,
			]}
		>
			<ThemedText type="caption" style={[styles.infoLabel, { color: muted }]}>
				{label}
			</ThemedText>
			<View style={styles.infoValue}>
				<ThemedText type="body" selectable>
					{value}
				</ThemedText>
				{caption ? (
					<ThemedText type="caption" selectable style={{ color: muted }}>
						{caption}
					</ThemedText>
				) : null}
			</View>
		</View>
	);
}

function GroupHeading({ title, color }: { title: string; color: string }) {
	return (
		<ThemedText type="subheading" style={{ color }}>
			{title}
		</ThemedText>
	);
}

/**
 * The Lists tab: the couple's own lists, and nothing else. The profile avatar
 * opens Account. While no partner has joined, the invite surfaces at the top
 * so waiting is never buried.
 */
export default function OursScreen() {
	const router = useRouter();
	const { mode } = useAoiTheme();
	const insets = useSafeAreaInsets();
	const { user } = useSession();
	const { space, status: spaceStatus, regenerateInvite, refreshSpace } = useSpace();
	const muted = useThemeColor({}, "muted");
	const background = useThemeColor({}, "background");
	const text = useThemeColor({}, "text");
	const accentInk = useThemeColor({}, "accentInk");
	const danger = useThemeColor({}, "danger");
	const accent = useThemeColor({}, "accent");
	const onAccent = useThemeColor({}, "onAccent");
	const shadowColor = useThemeColor({}, "shadow");
	const openCreate = useCallback(() => {
		if (__DEV__ && process.env.EXPO_OS === "web") {
			router.push({ pathname: "/dev-ours", params: { previewScreen: "new-list" } });
		} else {
			router.push("/(app)/collection/new");
		}
	}, [router]);
	const fabBottom = fabBottomOffset(insets.bottom, process.env.EXPO_OS === "ios");

	const isFocused = useIsFocused();
	const { height: windowHeight } = useWindowDimensions();
	const { moments } = useMoments();
	const daysTogether = useMemo(
		() => getDaysTogether(space?.relationshipStartDate, new Date()),
		[space?.relationshipStartDate],
	);

	const [inviteError, setInviteError] = useState("");
	const [isRegeneratingInvite, setIsRegeneratingInvite] = useState(false);
	const [isRetrying, setIsRetrying] = useState(false);

	const waitingForPartner = Boolean(space) && !space?.partnerJoined;
	const inviteCode = space?.inviteCode;
	const inviteExpiryLabel = formatInviteExpiry(space?.inviteExpiresAt);

	const handleShareInvite = useCallback(async () => {
		if (!inviteCode) {
			return;
		}
		setInviteError("");
		try {
			await Share.share({
				message: inviteMessage(
					inviteCode,
					user?.displayName?.trim() || "Your partner",
					space?.partnerName ?? null,
				),
			});
		} catch {
			setInviteError("Couldn't open sharing. Your code is shown above.");
		}
	}, [inviteCode, user, space]);

	const handleRegenerateInvite = useCallback(async () => {
		setInviteError("");
		setIsRegeneratingInvite(true);
		try {
			await regenerateInvite();
		} catch {
			setInviteError("Couldn't create a new code. Please try again.");
		} finally {
			setIsRegeneratingInvite(false);
		}
	}, [regenerateInvite]);

	const handleRetry = useCallback(async () => {
		setIsRetrying(true);
		try {
			await refreshSpace();
		} finally {
			setIsRetrying(false);
		}
	}, [refreshSpace]);

	if (spaceStatus === "loading") {
		return (
			<View style={[styles.pageShell, { backgroundColor: background }]}>
				<View
					style={[
						styles.contentContainer,
						styles.stateContainer,
						{
							paddingTop: insets.top + Spacing[8],
							paddingBottom: insets.bottom + Spacing[16],
						},
					]}
				>
					<View style={styles.center}>
						<ActivityIndicator color={accentInk} size="large" />
						<ThemedText
							type="caption"
							accessibilityLiveRegion="polite"
							style={{ color: muted, marginTop: Spacing[8] }}
						>
							Loading your space…
						</ThemedText>
					</View>
				</View>
			</View>
		);
	}

	if (spaceStatus === "error") {
		return (
			<View style={[styles.pageShell, { backgroundColor: background }]}>
				<View
					style={[
						styles.contentContainer,
						styles.stateContainer,
						{
							paddingTop: insets.top + Spacing[8],
							paddingBottom: insets.bottom + Spacing[16],
						},
					]}
				>
					<View style={styles.center}>
						<ThemedText
							type="title"
							accessibilityRole="alert"
							style={{ color: muted, marginBottom: Spacing[8] }}
						>
							Unable to load your lists
						</ThemedText>
						<ThemedText
							type="caption"
							style={{ color: muted, marginBottom: Spacing[16] }}
						>
							A network or server error occurred while loading your space data.
						</ThemedText>
						<Button
							label={isRetrying ? "Trying…" : "Try again"}
							onPress={() => void handleRetry()}
							disabled={isRetrying}
							variant="secondary"
						/>
					</View>
				</View>
			</View>
		);
	}

	return (
		<View style={[styles.pageShell, { backgroundColor: background }]}>
		<View style={{ height: compactSkyHeightForWindow(windowHeight) }}>
			<MemorySky compact daysTogether={daysTogether} focused={isFocused} moments={moments ?? []} startDate={space?.relationshipStartDate ?? null} />
			<View style={[styles.skyHeader, { paddingTop: insets.top + Spacing[8] }]}>
				<ScreenHeader title="Lists" showAvatar />
			</View>
		</View>
		<ScrollView
			style={[styles.pageShell, { backgroundColor: background }]}
			contentContainerStyle={[
				styles.contentContainer,
				{
					paddingTop: Spacing[8],
					paddingBottom: fabBottom + 56 + Spacing[24],
				},
			]}
			contentInsetAdjustmentBehavior="never"
			automaticallyAdjustKeyboardInsets
			keyboardShouldPersistTaps="handled"
			showsVerticalScrollIndicator={false}
		>
			{waitingForPartner ? (
				<Surface variant="card" style={styles.inviteCard}>
					<GroupHeading title="Invite your partner" color={text} />
					{inviteCode ? (
						<>
							<InfoRow
								label="Code"
								value={inviteCode}
								caption={
									inviteExpiryLabel ? `Expires ${inviteExpiryLabel}` : undefined
								}
								muted={muted}
							/>
							<Button label="Share invite" onPress={handleShareInvite} />
							<Button
								label={isRegeneratingInvite ? "Creating…" : "New invite code"}
								variant="secondary"
								onPress={handleRegenerateInvite}
								disabled={isRegeneratingInvite}
							/>
						</>
					) : (
						<>
							<ThemedText type="body" style={{ color: muted }}>
								Your invite is no longer active, it expired before being used.
							</ThemedText>
							<Button
								label={isRegeneratingInvite ? "Creating…" : "New invite code"}
								onPress={handleRegenerateInvite}
								disabled={isRegeneratingInvite}
							/>
						</>
					)}
					{inviteError ? (
						<ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>
							{inviteError}
						</ThemedText>
					) : null}
					<ThemedText type="caption" style={{ color: muted }}>
						Waiting for your partner to join. You can already save memories
						meanwhile.
					</ThemedText>
				</Surface>
			) : null}

			<View style={styles.section}>
				<OurLists onCreate={openCreate} />
			</View>
		</ScrollView>
		<Pressable
			accessibilityRole="button"
			accessibilityLabel="New list"
			accessibilityHint="Opens the list creation sheet"
			onPress={openCreate}
			style={({ pressed }) => [styles.fab, { bottom: fabBottom, boxShadow: shadow(Elevation.floating, shadowColor), opacity: pressed ? 0.85 : 1 }]}
		>
			<GlassSurface effect="clear" style={[styles.fabGlass, { backgroundColor: withAlpha(accent, process.env.EXPO_OS === "ios" ? 0.25 : 0.6) }]}>
				<Ionicons accessible={false} aria-hidden name="add" size={26} color={mode === "dark" ? onAccent : accentInk} />
			</GlassSurface>
		</Pressable>
		</View>
	);
}

const styles = StyleSheet.create({
	fab: {
		position: "absolute",
		right: Spacing[24],
		width: 56,
		height: 56,
		borderRadius: 28,
		alignItems: "center",
		justifyContent: "center",
	},
	fabGlass: {
		flex: 1,
		alignSelf: "stretch",
		alignItems: "center",
		justifyContent: "center",
		borderRadius: 28,
	},
	pageShell: {
		flex: 1,
	},
	contentContainer: {
		gap: Spacing[24],
		paddingHorizontal: Spacing[24],
	},
	stateContainer: {
		flex: 1,
		justifyContent: "center",
	},
	skyHeader: {
		position: "absolute",
		top: 0,
		left: 0,
		right: 0,
		paddingHorizontal: Spacing[24],
	},
	section: {
		gap: Spacing[12],
	},
	inviteCard: {
		gap: Spacing[12],
	},
	infoRow: {
		flexDirection: "row",
		alignItems: "flex-start",
		gap: Spacing[16],
		paddingVertical: Spacing[12],
	},
	infoLabel: {
		width: 92,
		flexShrink: 0,
		paddingTop: 2,
	},
	infoValue: {
		flex: 1,
		gap: Spacing[4],
	},
	center: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		paddingVertical: Spacing[56],
	},
});
