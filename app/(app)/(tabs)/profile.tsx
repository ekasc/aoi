import { useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Button } from "@/components/ui/button";
import { Divider } from "@/components/ui/divider";
import { Surface } from "@/components/ui/surface";
import { Spacing } from "@/constants/theme";
import { useSession } from "@/features/session/session-context";
import { useSpace } from "@/features/space/space-context";
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

function InfoRow({ label, value, muted }: { label: string; value: string; muted: string }) {
	return (
		<View style={styles.infoRow}>
			<ThemedText type="caption" style={{ color: muted, width: 80 }}>
				{label}
			</ThemedText>
			<ThemedText type="body" selectable style={styles.infoValue}>
				{value}
			</ThemedText>
		</View>
	);
}

export default function ProfileScreen() {
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const { user, signOut } = useSession();
	const { space, status: spaceStatus } = useSpace();
	const muted = useThemeColor({}, "muted");
	const background = useThemeColor({}, "background");
	const accent = useThemeColor({}, "accent");
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
			<View style={styles.hero}>
				<ThemedText type="meta" style={{ color: muted }}>
					About you
				</ThemedText>
				<ThemedText type="title" selectable>
					Profile
				</ThemedText>
			</View>

			<Surface variant="raised" style={styles.card}>
				<ThemedText type="meta">You</ThemedText>
				<Divider style={styles.divider} />
				<InfoRow label="Name" value={user?.displayName ?? "Unknown user"} muted={muted} />
				<View style={styles.rowSpacer} />
				<InfoRow label="Email" value={user?.email ?? "No email"} muted={muted} />
			</Surface>

			<Surface variant="raised" style={styles.card}>
				<ThemedText type="meta">Your space</ThemedText>
				<Divider style={styles.divider} />
				<InfoRow label="Space" value={space?.name ?? "No space configured"} muted={muted} />
				<View style={styles.rowSpacer} />
				<InfoRow label="Partner" value={space?.partnerName ?? "Not available"} muted={muted} />
				<View style={styles.rowSpacer} />
				<InfoRow
					label="Since"
					value={space ? formatRelationshipDate(space.relationshipStartDate) : "Not available"}
					muted={muted}
				/>
				<View style={styles.rowSpacer} />
				<InfoRow label="Code" value={space?.inviteCode ?? "Not available"} muted={muted} />
			</Surface>

			<Surface style={styles.card}>
				<ThemedText type="meta">Actions</ThemedText>
				<Divider style={styles.divider} />
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
		gap: Spacing[8],
		marginBottom: Spacing[4],
	},
	card: {
		gap: Spacing[4],
	},
	infoRow: {
		flexDirection: "row",
		alignItems: "center",
	},
	infoValue: {
		flex: 1,
	},
	rowSpacer: {
		height: Spacing[8],
	},
	divider: {
		marginVertical: Spacing[12],
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
