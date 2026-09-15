import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
	ActivityIndicator,
	Pressable,
	ScrollView,
	Share,
	StyleSheet,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SpaceAccountPanel } from "@/components/space/space-account-panel";
import { ThemedText } from "@/components/themed-text";
import { Button } from "@/components/ui/button";
import { Divider } from "@/components/ui/divider";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Spacing } from "@/constants/theme";
import { useMoments } from "@/features/moments/moments-context";
import { useSession } from "@/features/session/session-context";
import { useSpace } from "@/features/space/space-context";
import { useSubscription } from "@/features/subscription/subscription-context";
import { formatBytes } from "@/features/subscription/format";
import {
	formatDaysTogether,
	getDaysTogether,
} from "@/features/time-together/time-together";
import { useThemeColor } from "@/hooks/use-theme-color";

function formatRelationshipDate(value: string | null | undefined) {
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

function SectionHeading({ title, muted }: { title: string; muted: string }) {
	return (
		<ThemedText type="meta" style={[styles.sectionHeading, { color: muted }]}>
			{title}
		</ThemedText>
	);
}

/** A tappable settings row: label + chevron, for navigation (not actions). */
function NavRow({
	label,
	onPress,
	muted,
	dividerColor,
}: {
	label: string;
	onPress: () => void;
	muted: string;
	dividerColor?: string;
}) {
	return (
		<Pressable
			accessibilityLabel={label}
			accessibilityRole="button"
			onPress={onPress}
			style={({ pressed }) => [
				styles.navRow,
				dividerColor
					? { borderTopWidth: StyleSheet.hairlineWidth, borderColor: dividerColor }
					: null,
				pressed ? styles.navRowPressed : null,
			]}
		>
			<ThemedText type="body">{label}</ThemedText>
			<Ionicons color={muted} name="chevron-forward" size={18} />
		</Pressable>
	);
}

/**
 * The Space hub: relationship/partner truth, invite/waiting state, account,
 * preferences, Plus, and destructive lifecycle actions, in sections, not
 * cards. Absent partner/date render as honest absence, never placeholders.
 * Leave/delete confirmations state exactly what the backend does (see the
 * contracts in domains/spaces.ts and domains/auth.ts).
 */
export default function SpaceScreen() {
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const { user } = useSession();
	const { space, status: spaceStatus, regenerateInvite } = useSpace();
	const { moments } = useMoments();
	const { isPlus, status: plusStatus, serverPlus } = useSubscription();
	const muted = useThemeColor({}, "muted");
	const background = useThemeColor({}, "background");
	const accent = useThemeColor({}, "accent");
	const danger = useThemeColor({}, "danger");
	const border = useThemeColor({}, "border");

	const [inviteError, setInviteError] = useState("");
	const [isRegeneratingInvite, setIsRegeneratingInvite] = useState(false);
	// One screen, two modes: profile vs account. No nested settings route.
	const params = useLocalSearchParams<{ tab?: string }>();
	const [tab, setTab] = useState<"space" | "account">(
		params.tab === "account" ? "account" : "space",
	);

	const todayKey = new Date().toDateString();
	const daysTogether = useMemo(
		() => getDaysTogether(space?.relationshipStartDate, new Date(todayKey)),
		[space?.relationshipStartDate, todayKey],
	);
	const momentsKept = moments.length;
	const startDateLabel = formatRelationshipDate(space?.relationshipStartDate);
	const inviteExpiryLabel = formatInviteExpiry(space?.inviteExpiresAt);
	const waitingForPartner = Boolean(space) && !space?.partnerJoined;
	const inviteCode = space?.inviteCode;

	const contentContainerStyle = useMemo(
		() => [
			styles.contentContainer,
			{
				paddingTop: Spacing[8],
				paddingBottom: insets.bottom + Spacing[16],
			},
		],
		[insets.bottom],
	);

	const handleEditRelationship = useCallback(() => {
		router.push("/(app)/profile/edit-relationship");
	}, [router]);

	const handlePlus = useCallback(() => {
		router.push("/(app)/paywall");
	}, [router]);

	const handleShareInvite = useCallback(async () => {
		if (!inviteCode) {
			return;
		}
		setInviteError("");
		try {
			await Share.share({
				message: `Join our Aoi space with invite code ${inviteCode}`,
			});
		} catch {
			setInviteError("Couldn't open sharing. Your code is shown above.");
		}
	}, [inviteCode]);

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

  if (spaceStatus === "loading") {
    return (
      <View
        style={[styles.pageShell, { backgroundColor: background }]}
      >
        <View
          style={[
            styles.contentContainer,
            styles.stateContainer,
            {
              paddingTop: Spacing[8],
              paddingBottom: insets.bottom + Spacing[16],
            },
          ]}
        >
          <View style={styles.center}>
            <ActivityIndicator color={accent} size="large" />
            <ThemedText type="caption" style={{ color: muted, marginTop: Spacing[8] }}>
              Loading your space…
            </ThemedText>
          </View>
        </View>
      </View>
    );
  }

  if (spaceStatus === "error") {
    return (
      <View
        style={[styles.pageShell, { backgroundColor: background }]}
      >
        <View
          style={[
            styles.contentContainer,
            styles.stateContainer,
            {
              paddingTop: Spacing[8],
              paddingBottom: insets.bottom + Spacing[16],
            },
          ]}
        >
          <View style={styles.center}>
            <ThemedText type="title" style={{ color: muted, marginBottom: Spacing[8] }}>
              Unable to load space
            </ThemedText>
            <ThemedText type="caption" style={{ color: muted, marginBottom: Spacing[16] }}>
              A network or server error occurred while loading your space data.
            </ThemedText>
            <Button
              label="Go back"
              onPress={() => router.back()}
              variant="secondary"
            />
          </View>
        </View>
      </View>
    );
  }

	return (
		<ScrollView
			style={[styles.pageShell, { backgroundColor: background }]}
			contentContainerStyle={contentContainerStyle}
			contentInsetAdjustmentBehavior="never"
			showsVerticalScrollIndicator={false}
		>
			<View style={styles.heroBlock}>
				<ThemedText type="meta" style={{ color: muted }}>
					Space
				</ThemedText>
				<ThemedText type="display" selectable style={styles.hero}>
					{space?.name ?? "Your space"}
				</ThemedText>
				{space?.photoUri ? (
					<Image
						source={{ uri: space.photoUri }}
						accessibilityLabel={`Photo for ${space.name}`}
						style={[styles.heroPhoto, { borderColor: border }]}
					/>
				) : null}
				{space ? (
					<ThemedText type="caption" selectable style={{ color: muted }}>
						{daysTogether !== null ? formatDaysTogether(daysTogether) : "Together"}
						{momentsKept > 0 ? ` · ${momentsKept} ${momentsKept === 1 ? "memory" : "memories"} kept` : ""}
					</ThemedText>
				) : null}
			</View>

			<SegmentedControl
				accessibilityLabel="Space sections"
				onChange={setTab}
				options={[
					{ value: "space", label: "Space" },
					{ value: "account", label: "Account" },
				]}
				value={tab}
			/>

			{tab === "space" ? (
				<>
			<View style={styles.section}>
				<SectionHeading title="Relationship" muted={muted} />
				<View style={styles.group}>
					{space?.partnerName ? (
						<InfoRow label="Partner" value={space.partnerName} muted={muted} />
					) : (
						<InfoRow label="Partner" value="Not added yet" muted={muted} />
					)}
					{startDateLabel ? (
						<InfoRow
							label="Started"
							value={startDateLabel}
							muted={muted}
							dividerColor={border}
						/>
					) : (
						<InfoRow
							label="Started"
							value="Not set"
							muted={muted}
							dividerColor={border}
						/>
					)}
				</View>
				<NavRow
					label="Edit relationship"
					onPress={handleEditRelationship}
					muted={muted}
				/>
			</View>

			<Divider />

			{waitingForPartner ? (
				<View style={styles.section}>
					<SectionHeading title="Invite your partner" muted={muted} />
					{space?.inviteCode ? (
						<>
							<InfoRow
								label="Code"
								value={space.inviteCode}
								caption={
									inviteExpiryLabel
										? `Expires ${inviteExpiryLabel}`
										: undefined
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
							{inviteError ? (
								<ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>
									{inviteError}
								</ThemedText>
							) : null}
						</>
					) : (
						<>
							<ThemedText type="body" style={{ color: muted }}>
								Your invite is no longer active, it expired before
								being used.
							</ThemedText>
							<Button
								label={isRegeneratingInvite ? "Creating…" : "New invite code"}
								onPress={handleRegenerateInvite}
								disabled={isRegeneratingInvite}
							/>
							{inviteError ? (
								<ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>
									{inviteError}
								</ThemedText>
							) : null}
						</>
					)}
					<ThemedText type="caption" style={{ color: muted }}>
						Waiting for your partner to join. You can already save
						memories meanwhile.
					</ThemedText>
				</View>
			) : (
				<View style={styles.section}>
					<SectionHeading title="Together" muted={muted} />
					<ThemedText type="body" style={{ color: muted }}>
						{space?.partnerName
							? `${space.partnerName} is in this space with you.`
							: "Your partner is in this space with you."}
					</ThemedText>
				</View>
			)}

			<Divider />

			<View style={styles.section}>
				<SectionHeading title="You" muted={muted} />
				<View style={styles.group}>
					<InfoRow
						label="Name"
						value={user?.displayName ?? "Not available"}
						caption={user?.email ?? undefined}
						muted={muted}
					/>
				</View>
			</View>

			<Divider />

			<View style={styles.section}>
				<SectionHeading title="Plus" muted={muted} />
				<ThemedText type="body">
					{serverPlus?.isPlus
						? `Plus is active on your shared Space, ${formatBytes(serverPlus.mediaUsedBytes)} of ${formatBytes(serverPlus.mediaLimitBytes)} media used.`
						: serverPlus
							? `Free Space, ${formatBytes(serverPlus.mediaLimitBytes)} media, ${serverPlus.futureLetterLimit ?? 1} future letter at a time.`
							: plusStatus === "loading"
								? "Checking your plan…"
								: plusStatus === "unavailable"
									? "Purchasing is currently unavailable."
									: isPlus
										? "You have Plus on this account."
										: "Plus brings more room, more future letters, and PDF keepsakes to your shared Space."}
				</ThemedText>
				<Button
					label={isPlus ? "View Plus" : "Unlock Plus"}
					variant={isPlus ? "secondary" : "primary"}
					onPress={handlePlus}
				/>
			</View>

			<Divider />

			{/*
				Everything account-level (appearance, data export, session,
				support & legal, leaving, deletion) is rendered by the Account
				segment of this same screen — one route, no nested settings.
			*/}
				</>
			) : (
				<SpaceAccountPanel />
			)}
		</ScrollView>
	);
}

const styles = StyleSheet.create({
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
	heroBlock: {
		gap: Spacing[8],
	},
	hero: {
		// Large type tightens: negative tracking, tighter leading.
		fontSize: 34,
		lineHeight: 38,
		letterSpacing: -0.6,
		fontWeight: "400",
		flexWrap: "wrap",
	},
	heroPhoto: {
		width: "100%",
		height: 184,
		borderRadius: 18,
		borderCurve: "continuous",
		borderWidth: StyleSheet.hairlineWidth,
		marginTop: Spacing[8],
	},
	section: {
		gap: Spacing[12],
	},
	sectionHeading: {
		// Group header: small, tracked, quiet.
		textTransform: "uppercase",
		letterSpacing: 1,
		fontSize: 12,
	},
	// Rows within a group sit flush so their hairline dividers read as one list.
	group: {},
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
	navRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: Spacing[12],
		minHeight: 52,
		paddingHorizontal: Spacing[16],
		borderRadius: 12,
		borderCurve: "continuous",
	},
	navRowPressed: {
		opacity: 0.6,
	},
	center: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		paddingVertical: Spacing[56],
	},
});
