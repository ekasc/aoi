import { Stack } from "expo-router";
import { useMemo } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PartnerMap } from "@/components/location/partner-map";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { isStubMode } from "@/features/api-client";
import { useLocation } from "@/features/location/location-context";
import {
	formatShareAgeLabel,
	isPartnerLocationVisible,
} from "@/features/location/location-state";
import { useSpace } from "@/features/space/space-context";
import { useThemeColor } from "@/hooks/use-theme-color";

/**
 * The partner view: one pin, one caption, nothing else. No trails, no
 * history — just "they'll be home soon".
 */
export default function PartnerMapScreen() {
	const insets = useSafeAreaInsets();
	const { space } = useSpace();
	const { partnerLocation } = useLocation();

	const background = useThemeColor({}, "background");
	const muted = useThemeColor({}, "muted");
	const partnerAccent = useThemeColor({}, "partnerAccent");

	const partnerName = space?.partnerName ?? "Your partner";
	const nowMs = Date.now();
	const visible = isPartnerLocationVisible(partnerLocation, nowMs);

	const caption = useMemo(() => {
		if (!partnerLocation) {
			return null;
		}

		switch (partnerLocation.mode) {
			case "on_request_granted":
				return "Shared once, just for you.";
			case "until_arrive":
				return partnerLocation.destination
					? `Heading to ${partnerLocation.destination.name}.`
					: "On their way.";
			case "live":
				return "Sharing while it's on.";
		}
	}, [partnerLocation]);

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
		<ScrollView
			contentContainerStyle={contentContainerStyle}
			showsVerticalScrollIndicator={false}
			style={{ backgroundColor: background }}
		>
			<Stack.Screen options={{ title: partnerName }} />

			{visible && partnerLocation ? (
				<>
					<PartnerMap
						partnerName={partnerName}
						pinColor={partnerAccent}
						share={partnerLocation}
					/>
					<View style={styles.captionRow}>
						<ThemedText type="body">{partnerName}</ThemedText>
						<ThemedText type="caption" style={{ color: muted }}>
							{caption} {formatShareAgeLabel(partnerLocation.reportedAt, nowMs)}
						</ThemedText>
						<ThemedText type="caption" style={{ color: muted }}>
							Only their latest position — never a trail.
						</ThemedText>
						{isStubMode() ? (
							<ThemedText type="caption" style={{ color: muted }}>
								Simulated for offline development.
							</ThemedText>
						) : null}
					</View>
				</>
			) : (
				<View style={styles.empty}>
					<ThemedText type="caption" style={{ color: muted }}>
						Nothing to show right now — they aren&apos;t sharing, or the
						share has quietly passed.
					</ThemedText>
				</View>
			)}
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	contentContainer: {
		gap: Spacing[16],
		paddingHorizontal: Spacing[16],
	},
	captionRow: {
		gap: Spacing[4],
	},
	empty: {
		paddingVertical: Spacing[40],
	},
});
