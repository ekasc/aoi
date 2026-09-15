import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
	MomentForm,
	type MomentFormValues,
} from "@/components/moments/moment-form";
import { ThemedText } from "@/components/themed-text";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { Spacing } from "@/constants/theme";
import { useMoments } from "@/features/moments/moments-context";
import { useMoment } from "@/features/moments/use-moment";
import { isOwnMoment } from "@/features/moments/ownership";
import { useThemeColor } from "@/hooks/use-theme-color";

export default function EditMomentScreen() {
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const { id, at } = useLocalSearchParams<{ id?: string; at?: string | string[] }>();
	const momentId = Array.isArray(id) ? id[0] : id;
	const atHint = Array.isArray(at) ? at[0] : at;
	const { isLoading: contextLoading } = useMoments();
	const { moment, isLoading: momentLoading } = useMoment(momentId, atHint ?? null);
	const { updateMoment } = useMoments();
	const background = useThemeColor({}, "background");
	const muted = useThemeColor({}, "muted");

	const isLoading = contextLoading || momentLoading;

	const handleCancel = useCallback(() => {
		router.back();
	}, [router]);

	const handleSubmit = useCallback(
		async (values: MomentFormValues) => {
			if (!moment) {
				return;
			}

			await updateMoment(moment.id, {
				type: values.type,
				title: values.title,
				body: values.body,
				targetAt: values.targetAt,
				mediaPreview: values.mediaPreview,
				audioUri: values.audioUri,
				mediaId: values.mediaId,
			});
			router.back();
		},
		[moment, router, updateMoment],
	);

	if (!moment) {
		return (
			<>
				<Stack.Screen options={{ title: "Edit moment" }} />
				<View
					style={[
						styles.loadingRoot,
						{
							backgroundColor: background,
							paddingBottom: insets.bottom + Spacing[24],
						},
					]}
				>
					<Surface style={styles.loadingCard}>
						{isLoading ? (
							<ThemedText type="body">Loading moment…</ThemedText>
						) : (
							<>
								<ThemedText type="title">
									This moment is no longer available
								</ThemedText>
								<ThemedText type="caption" style={{ color: muted }}>
									It may have been removed.
								</ThemedText>
							</>
						)}
					</Surface>
					<View style={styles.loadingFooter}>
						<Button
							label="Close"
							onPress={handleCancel}
							variant="secondary"
						/>
					</View>
				</View>
			</>
		);
	}

	if (!isOwnMoment(moment)) {
		return (
			<>
				<Stack.Screen options={{ title: "Edit moment" }} />
				<View
					style={[
						styles.loadingRoot,
						{
							backgroundColor: background,
							paddingBottom: insets.bottom + Spacing[24],
						},
					]}
				>
					<Surface style={styles.loadingCard}>
						<ThemedText type="title">
							Only {moment.authorName} can edit this
						</ThemedText>
						<ThemedText type="caption" style={{ color: muted }}>
							Moments can only be changed by the person who kept them.
						</ThemedText>
					</Surface>
					<View style={styles.loadingFooter}>
						<Button label="Done" onPress={handleCancel} />
					</View>
				</View>
			</>
		);
	}

	return (
		<>
			<Stack.Screen options={{ title: "Edit moment" }} />
			<MomentForm
				heroTitle="Edit this moment"
				heroSubtitle="The memory stays; the words can change."
				initialMoment={moment}
				onCancel={handleCancel}
				onSubmit={handleSubmit}
				submitLabel="Save changes"
				submittingLabel="Saving…"
			/>
		</>
	);
}

const styles = StyleSheet.create({
	loadingRoot: {
		flex: 1,
		paddingHorizontal: Spacing[16],
		paddingTop: Spacing[24],
		gap: Spacing[16],
	},
	loadingCard: {
		gap: Spacing[8],
	},
	loadingFooter: {
		gap: Spacing[12],
	},
});
