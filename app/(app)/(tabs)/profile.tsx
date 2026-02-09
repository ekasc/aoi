import { useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
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

export default function ProfileScreen() {
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const { user, signOut } = useSession();
	const { space } = useSpace();
	const muted = useThemeColor({}, "muted");
	const background = useThemeColor({}, "background");
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

	const handleSignOut = useCallback(async () => {
		await signOut();
		router.replace("/(public)");
	}, [router, signOut]);

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
				<ThemedText type="body" style={{ color: muted }}>
					Your identity and relationship details.
				</ThemedText>
			</View>

			<Surface variant="raised" style={styles.card}>
				<ThemedText type="meta">Identity</ThemedText>
				<Divider style={styles.divider} />
				<ThemedText type="caption" style={{ color: muted }}>
					Name
				</ThemedText>
				<ThemedText type="body" selectable>
					{user?.displayName ?? "Unknown user"}
				</ThemedText>
				<ThemedText type="caption" style={{ color: muted }}>
					Email
				</ThemedText>
				<ThemedText type="body" selectable>
					{user?.email ?? "No email"}
				</ThemedText>
			</Surface>

			<Surface variant="raised" style={styles.card}>
				<ThemedText type="meta">Relationship</ThemedText>
				<Divider style={styles.divider} />
				<ThemedText type="caption" style={{ color: muted }}>
					Space
				</ThemedText>
				<ThemedText type="body" selectable>
					{space?.name ?? "No space configured"}
				</ThemedText>
				<ThemedText type="caption" style={{ color: muted }}>
					Partner
				</ThemedText>
				<ThemedText type="body" selectable>
					{space?.partnerName ?? "Not available"}
				</ThemedText>
				<ThemedText type="caption" style={{ color: muted }}>
					Since
				</ThemedText>
				<ThemedText type="body" selectable>
					{space
						? formatRelationshipDate(space.relationshipStartDate)
						: "Not available"}
				</ThemedText>
				<ThemedText type="caption" style={{ color: muted }}>
					Invite code
				</ThemedText>
				<ThemedText type="body" selectable>
					{space?.inviteCode ?? "Not available"}
				</ThemedText>
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
		gap: Spacing[12],
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
	divider: {
		marginVertical: Spacing[12],
	},
	actionStack: {
		gap: Spacing[8],
	},
});
