import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
	Linking,
	Pressable,
	ScrollView,
	StyleSheet,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemeSelector } from "@/components/theme/theme-selector";
import { ThemedText } from "@/components/themed-text";
import { ActionSheet } from "@/components/ui/action-sheet";
import { Button } from "@/components/ui/button";
import { Divider } from "@/components/ui/divider";
import { Spacing } from "@/constants/theme";
import { exportRawArchive } from "@/features/export/raw-export";
import { getLegalLinks } from "@/features/legal/legal-links";
import { useSession } from "@/features/session/session-context";
import { useSpace } from "@/features/space/space-context";
import { formatBytes } from "@/features/subscription/format";
import { useSubscription } from "@/features/subscription/subscription-context";
import { haptics } from "@/features/haptics/haptics";
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

function SectionHeading({
	title,
	muted,
	danger,
}: {
	title: string;
	muted: string;
	danger?: string;
}) {
	return (
		<ThemedText
			type="meta"
			style={[styles.sectionHeading, { color: danger ?? muted }]}
		>
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
 * Account: everything account-level that used to live in the Space hub's
 * Account segment, plus the relationship and data controls that no longer
 * belong on a tab. Appearance, Relationship, Data, Plus, Session, support &
 * legal, and deletion, in sections, not cards. Destructive confirmations
 * state exactly what the backend does (see domains/spaces.ts and
 * domains/auth.ts).
 */
export default function AccountScreen() {
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const { signOut, deleteAccount, user } = useSession();
	const { space, leaveSpace } = useSpace();
	const { isPlus, status: plusStatus, serverPlus } = useSubscription();
	const userId = user?.id;
	const muted = useThemeColor({}, "muted");
	const danger = useThemeColor({}, "danger");
	const border = useThemeColor({}, "border");

	const [signOutError, setSignOutError] = useState("");
	const [deleteError, setDeleteError] = useState("");
	const [leaveError, setLeaveError] = useState("");
	const [confirming, setConfirming] = useState<"delete" | "leave" | null>(null);
	const [isDeleting, setIsDeleting] = useState(false);
	const [isLeaving, setIsLeaving] = useState(false);
	const destructiveInFlight = useRef(false);
	const [isExporting, setIsExporting] = useState(false);
	const [exportMessage, setExportMessage] = useState("");

	const startDateLabel = formatRelationshipDate(space?.relationshipStartDate);

	const handleOpenLocalPhotos = useCallback(() => {
		router.push("/(app)/album/local-photos");
	}, [router]);

	const handleEditRelationship = useCallback(() => {
		router.push("/(app)/profile/edit-relationship");
	}, [router]);

	const handlePlus = useCallback(() => {
		router.push("/(app)/paywall");
	}, [router]);

	const handleSignOut = useCallback(async () => {
		haptics.tap();
		setSignOutError("");
		try {
			// signOut() quietly lets go of this device's push registration first
			// (single choke point — every sign-out path unregisters the token).
			await signOut();
			router.replace("/(public)");
		} catch {
			setSignOutError("Failed to sign out. Please try again.");
		}
	}, [router, signOut]);

	// Both destructive paths confirm in the app's own sheet rather than a
	// system alert: the copy is long, the sheet is themeable and announced as
	// a modal, and the row that opened it keeps its place underneath.
	const handleDeleteAccount = useCallback(() => {
		haptics.warning();
		setDeleteError("");
		setConfirming("delete");
	}, []);

	const handleLeaveSpace = useCallback(() => {
		haptics.warning();
		setLeaveError("");
		setConfirming("leave");
	}, []);

	const handleCloseConfirm = useCallback(() => {
		if (!destructiveInFlight.current) setConfirming(null);
	}, []);

	const handleConfirmDelete = useCallback(async () => {
		if (destructiveInFlight.current) return;
		destructiveInFlight.current = true;
		setDeleteError("");
		setIsDeleting(true);
		try {
			await deleteAccount();
			router.replace("/(public)");
		} catch {
			setDeleteError("Failed to delete account. Please try again.");
		} finally {
			setIsDeleting(false);
			destructiveInFlight.current = false;
		}
	}, [deleteAccount, router]);

	const handleConfirmLeave = useCallback(async () => {
		if (destructiveInFlight.current) return;
		destructiveInFlight.current = true;
		setLeaveError("");
		setIsLeaving(true);
		try {
			await leaveSpace();
			router.replace("/(auth)/space-setup");
		} catch {
			setLeaveError("Failed to leave space. Please try again.");
		} finally {
			setIsLeaving(false);
			destructiveInFlight.current = false;
		}
	}, [leaveSpace, router]);

	// Raw data export is intentionally never gated by Plus: it archives
	// whatever this account is currently authorized to read.
	const handleExportData = useCallback(async () => {
		if (isExporting || !userId) {
			return;
		}
		setIsExporting(true);
		setExportMessage("");
		try {
			const result = await exportRawArchive({ userId });
			if (result.status === "shared") {
				setExportMessage(
					result.mediaErrors > 0
						? `Archive shared, ${result.mediaErrors} media file(s) were unavailable (listed in manifest.json).`
						: "Archive shared, save it somewhere safe.",
				);
			} else if (result.status === "cancelled") {
				setExportMessage("Export cancelled.");
			} else {
				setExportMessage(`Export failed: ${result.error}`);
			}
		} catch {
			setExportMessage("Export failed. Please try again.");
		} finally {
			setIsExporting(false);
		}
	}, [isExporting, userId]);

	const legal = useMemo(() => getLegalLinks(), []);
	const legalRows = useMemo(() => {
		const rows: { label: string; url: string }[] = [];
		if (legal.privacyUrl) {
			rows.push({ label: "Privacy policy", url: legal.privacyUrl });
		}
		if (legal.termsUrl) {
			rows.push({ label: "Terms of service", url: legal.termsUrl });
		}
		if (legal.supportUrl) {
			rows.push({ label: "Contact support", url: legal.supportUrl });
		}
		return rows;
	}, [legal]);
	const openLegalLink = useCallback(async (url: string) => {
		try {
			await Linking.openURL(url);
		} catch {
			// Link failure is quiet tender-error policy: the row stays for retry.
		}
	}, []);

	return (
		<ScrollView
			style={styles.pageShell}
			contentContainerStyle={[
				styles.contentContainer,
				{ paddingBottom: insets.bottom + Spacing[40] },
			]}
			contentInsetAdjustmentBehavior="never"
			showsVerticalScrollIndicator={false}
		>
			<View style={styles.section}>
				<SectionHeading title="Appearance" muted={muted} />
				<ThemeSelector showDescriptions={false} />
			</View>

			<Divider />

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

			<View style={styles.section}>
				<SectionHeading title="Your data" muted={muted} />
				<ThemedText type="body">
					Download everything you can see right now, notes, photos, letters,
					plans, as one archive file. Free for everyone, before or without
					deleting anything.
				</ThemedText>
				<Button
					label={isExporting ? "Preparing…" : "Export my data"}
					variant="secondary"
					onPress={() => void handleExportData()}
					disabled={isExporting}
				/>
				{exportMessage ? (
					<ThemedText accessibilityRole="alert" type="caption">
						{exportMessage}
					</ThemedText>
				) : null}
				<View style={styles.group}>
					<NavRow
						label="Local photo copies"
						muted={muted}
						onPress={handleOpenLocalPhotos}
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

			<View style={styles.section}>
				<SectionHeading title="Session" muted={muted} />
				<Button label="Sign out" variant="secondary" onPress={handleSignOut} />
				{signOutError ? (
					<ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>
						{signOutError}
					</ThemedText>
				) : null}
				<ThemedText type="caption" style={{ color: muted }}>
					Signing out only ends this session, your space and history stay
					exactly as they are.
				</ThemedText>
			</View>

			{legalRows.length > 0 ? (
				<>
					<Divider />
					<View style={styles.section}>
						<SectionHeading title="Support & legal" muted={muted} />
						{legalRows.map((row) => (
							<Button
								key={row.label}
								label={row.label}
								variant="ghost"
								onPress={() => void openLegalLink(row.url)}
							/>
						))}
					</View>
				</>
			) : null}

			<Divider />

			<View style={styles.section}>
				<SectionHeading title="Danger zone" muted={muted} danger={danger} />
				<Button
					label="Leave space"
					variant="secondary"
					onPress={handleLeaveSpace}
				/>
				{leaveError ? (
					<ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>
						{leaveError}
					</ThemedText>
				) : null}
				<Button
					label="Delete account"
					variant="destructive"
					onPress={handleDeleteAccount}
				/>
				{deleteError ? (
					<ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>
						{deleteError}
					</ThemedText>
				) : null}
			</View>

			<ActionSheet
				busy={isLeaving}
				error={leaveError}
				actions={[
					{
						label: isLeaving ? "Leaving…" : "Leave this space",
						onPress: () => void handleConfirmLeave(),
						variant: "destructive",
					},
					{ label: "Cancel", onPress: handleCloseConfirm },
				]}
				description={`You will leave “${space?.name ?? "this space"}”. Your partner keeps the shared memories and can still read them, and leaving never deletes history. You lose access until you join or create another space. If you are the last member, the space closes.`}
				onClose={handleCloseConfirm}
				title="Leave this space?"
				visible={confirming === "leave"}
			/>

			<ActionSheet
				busy={isDeleting}
				error={deleteError}
				actions={[
					{
						label: isDeleting ? "Deleting…" : "Delete my account",
						onPress: () => void handleConfirmDelete(),
						variant: "destructive",
					},
					{ label: "Cancel", onPress: handleCloseConfirm },
				]}
				description="This permanently deletes your account and signs out every device. We erase your email, photo, login connections, preferences, location, and sessions. Your shared memories (notes, photos, letters, plans) stay with your partner. If you are the last member, the space closes. Backup copies age out automatically. This cannot be undone."
				onClose={handleCloseConfirm}
				title="Delete your account?"
				visible={confirming === "delete"}
			/>
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
		paddingTop: Spacing[8],
	},
	section: {
		gap: Spacing[12],
	},
	sectionHeading: {
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
});
