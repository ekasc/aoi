import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import {
	ActivityIndicator,
	Pressable,
	ScrollView,
	StyleSheet,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Surface } from "@/components/ui/surface";
import { Spacing } from "@/constants/theme";
import { useLocation } from "@/features/location/location-context";
import { isPartnerLocationVisible } from "@/features/location/location-state";
import { useMoments } from "@/features/moments/moments-context";
import { useSession } from "@/features/session/session-context";
import { useSpace } from "@/features/space/space-context";
import { useSqueeze } from "@/features/squeeze/squeeze-context";
import {
	formatDaysTogether,
	formatMomentsKept,
	getDaysTogether,
} from "@/features/time-together/time-together";
import { useThemeColor } from "@/hooks/use-theme-color";

function formatRelationshipDate(value: string) {
	const date = new Date(value);

	if (Number.isNaN(date.getTime())) {
		return "Not available";
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
}: {
	label: string;
	value: string;
	caption?: string;
	muted: string;
}) {
	return (
		<View style={styles.infoRow}>
			<ThemedText type="caption" style={{ color: muted, width: 80 }}>
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

export default function ProfileScreen() {
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const { user, signOut } = useSession();
	const { space, status: spaceStatus } = useSpace();
	const { sendSqueeze, isSending: isSqueezeSending } = useSqueeze();
	const { moments } = useMoments();
	const { sharingMode, partnerLocation } = useLocation();
	const muted = useThemeColor({}, "muted");
	const background = useThemeColor({}, "background");
	const accent = useThemeColor({}, "accent");
	const partnerAccent = useThemeColor({}, "partnerAccent");
	const todayKey = new Date().toDateString();
	const daysTogether = useMemo(
		() => getDaysTogether(space?.relationshipStartDate, new Date(todayKey)),
		[space?.relationshipStartDate, todayKey],
	);
	const momentsKept = moments.length;
	const contentContainerStyle = useMemo(
		() => [
			styles.contentContainer,
			{
				paddingTop: insets.top + Spacing[8],
				paddingBottom: insets.bottom + Spacing[16],
			},
		],
		[insets.bottom, insets.top],
	);

	const handleEditRelationship = useCallback(() => {
		router.push("/(app)/profile/edit-relationship");
	}, [router]);

	const handleImportMilestones = useCallback(() => {
		router.push("/(app)/profile/import-milestones");
	}, [router]);

	const handleLittleThings = useCallback(() => {
		router.push("/(app)/profile/little-things");
	}, [router]);

	const handleSomeday = useCallback(() => {
		router.push("/(app)/someday");
	}, [router]);

	const handleSqueeze = useCallback(() => {
		void sendSqueeze();
	}, [sendSqueeze]);

	const handleMemoryWall = useCallback(() => {
		router.push("/(app)/memory-wall");
	}, [router]);

	const handleQuestion = useCallback(() => {
		router.push("/(app)/question");
	}, [router]);

	const handleLocation = useCallback(() => {
		router.push("/(app)/location");
	}, [router]);

	// One quiet dot: visible exactly while you are actively sharing, so
	// nobody ever forgets it's on.
	const isSharing = sharingMode !== null;
	const partnerSharing = isPartnerLocationVisible(partnerLocation, Date.now());

	const handleLetters = useCallback(() => {
		router.push("/(app)/letters");
	}, [router]);

	const handleSignOut = useCallback(async () => {
		await signOut();
		router.replace("/(public)");
	}, [router, signOut]);

	if (spaceStatus === "loading") {
		return (
			<ScrollView
				style={{ backgroundColor: background }}
				contentContainerStyle={contentContainerStyle}
				contentInsetAdjustmentBehavior="never"
				showsVerticalScrollIndicator={false}
			>
				<View style={styles.center}>
					<ActivityIndicator color={accent} size="large" />
					<ThemedText type="caption" style={{ color: muted, marginTop: Spacing[8] }}>
						Loading your space…
					</ThemedText>
				</View>
			</ScrollView>
		);
	}

	if (spaceStatus === "error") {
		return (
			<ScrollView
				style={{ backgroundColor: background }}
				contentContainerStyle={contentContainerStyle}
				contentInsetAdjustmentBehavior="never"
				showsVerticalScrollIndicator={false}
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
			</ScrollView>
		);
	}

	return (
		<ScrollView
			style={{ backgroundColor: background }}
			contentContainerStyle={contentContainerStyle}
			contentInsetAdjustmentBehavior="never"
			showsVerticalScrollIndicator={false}
		>
			<ThemedText type="title" selectable style={styles.hero}>
				Profile
			</ThemedText>

			{daysTogether !== null ? (
				<Surface variant="raised" style={styles.card}>
					<ThemedText type="meta">Time together</ThemedText>
					<ThemedText type="title" selectable>
						{formatDaysTogether(daysTogether)}
					</ThemedText>
					{momentsKept > 0 ? (
						<ThemedText type="caption" style={{ color: muted }}>
							{formatMomentsKept(momentsKept)}
						</ThemedText>
					) : null}
				</Surface>
			) : null}

			<Surface variant="raised" style={styles.card}>
				<ThemedText type="meta" style={styles.cardHeading}>
					You
				</ThemedText>
				<InfoRow
					label="Name"
					value={user?.displayName ?? "Unknown user"}
					caption={user?.email ?? "No email"}
					muted={muted}
				/>
			</Surface>

			<Surface variant="raised" style={styles.card}>
				<ThemedText type="meta" style={styles.cardHeading}>
					Your space
				</ThemedText>
				<InfoRow
					label="Space"
					value={space?.name ?? "No space configured"}
					caption={
						space
							? `Together since ${formatRelationshipDate(space.relationshipStartDate)}`
							: undefined
					}
					muted={muted}
				/>
				<View style={styles.infoRow}>
					<ThemedText type="caption" style={{ color: muted, width: 80 }}>
						Partner
					</ThemedText>
					<ThemedText type="body" selectable style={styles.partnerName}>
						{space?.partnerName ?? "Not available"}
					</ThemedText>
					<IconButton
						accessibilityLabel={`Send a squeeze to ${space?.partnerName ?? "your partner"}`}
						disabled={isSqueezeSending}
						label="Send a squeeze"
						onPress={handleSqueeze}
						variant="ghost"
					>
						<Ionicons color={accent} name="heart" size={20} />
					</IconButton>
				</View>
				<InfoRow label="Invite" value={space?.inviteCode ?? "Not available"} muted={muted} />
				<Pressable
					accessibilityLabel="Location sharing settings"
					accessibilityRole="button"
					onPress={handleLocation}
					style={styles.locationRow}
				>
					<Ionicons color={muted} name="location-outline" size={18} />
					<ThemedText type="body" style={styles.locationLabel}>
						Location
					</ThemedText>
					{isSharing ? (
						<View
							accessibilityLabel="You are sharing your location"
							style={[styles.sharingDot, { backgroundColor: accent }]}
						/>
					) : partnerSharing ? (
						<View
							accessibilityLabel="Your partner is sharing their location"
							style={[styles.sharingDot, { backgroundColor: partnerAccent }]}
						/>
					) : null}
					<ThemedText type="caption" style={{ color: muted }}>
						{isSharing
							? "Sharing"
							: partnerSharing
								? `${space?.partnerName ?? "They"} sharing`
								: "Off"}
					</ThemedText>
				</Pressable>
			</Surface>

			<Surface style={styles.card}>
				<ThemedText type="meta" style={styles.cardHeading}>
					Actions
				</ThemedText>
				<View style={styles.actionStack}>
					<Button
						label="Edit relationship"
						onPress={handleEditRelationship}
						variant="secondary"
					/>
					<Button
						label="Import milestones"
						onPress={handleImportMilestones}
						variant="secondary"
					/>
					<Button
						label="The little things"
						onPress={handleLittleThings}
						variant="secondary"
					/>
					<Button
						label="Someday list"
						onPress={handleSomeday}
						variant="secondary"
					/>
					<Button
						label="Memory wall"
						onPress={handleMemoryWall}
						variant="secondary"
					/>
					<Button
						label="This week's question"
						onPress={handleQuestion}
						variant="secondary"
					/>
					<Button
						label="Letters"
						onPress={handleLetters}
						variant="secondary"
					/>
					<Button
						label="Sign out"
						onPress={handleSignOut}
						variant="secondary"
					/>
				</View>
			</Surface>
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	contentContainer: {
		gap: Spacing[16],
		paddingHorizontal: Spacing[16],
		paddingBottom: Spacing[24],
	},
	hero: {
		marginBottom: Spacing[4],
	},
	card: {
		gap: Spacing[12],
	},
	cardHeading: {
		marginBottom: Spacing[4],
	},
	infoRow: {
		flexDirection: "row",
		alignItems: "center",
	},
	infoValue: {
		flex: 1,
		gap: Spacing[4],
	},
	partnerName: {
		flex: 1,
	},
	locationRow: {
		alignItems: "center",
		flexDirection: "row",
		gap: Spacing[8],
	},
	locationLabel: {
		flex: 1,
	},
	sharingDot: {
		borderRadius: 4,
		height: 8,
		width: 8,
	},
	actionStack: {
		gap: Spacing[8],
	},
	center: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		paddingVertical: Spacing[56],
	},
});
