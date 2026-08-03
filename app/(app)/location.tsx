import * as Location from "expo-location";
import { Stack, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
	ActivityIndicator,
	ScrollView,
	StyleSheet,
	Switch,
	TextInput,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { Spacing } from "@/constants/theme";
import { isStubMode } from "@/features/api-client";
import { useLocation } from "@/features/location/location-context";
import { isPartnerLocationVisible } from "@/features/location/location-state";
import { useSpace } from "@/features/space/space-context";
import { useThemeColor } from "@/hooks/use-theme-color";

// Stub mode only: a fixed, plainly-simulated destination so "Until I
// arrive" can be tried offline. Never used when talking to the real API.
const SIMULATED_DESTINATION = {
	latitude: 35.65858,
	longitude: 139.74543,
};

const ARRIVAL_RADIUS_METERS = 200;

export default function LocationScreen() {
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const { space } = useSpace();
	const {
		isLoaded,
		youConsented,
		partnerConsented,
		bothConsented,
		setConsent,
		sharingMode,
		startSharing,
		stopSharing,
		requestPartnerLocation,
		requestSent,
		partnerLocation,
		error,
	} = useLocation();

	const accent = useThemeColor({}, "accent");
	const background = useThemeColor({}, "background");
	const muted = useThemeColor({}, "muted");
	const text = useThemeColor({}, "text");

	const [destinationName, setDestinationName] = useState("Home");
	const [isBusy, setIsBusy] = useState(false);

	const partnerName = space?.partnerName ?? "your partner";
	const partnerVisible = isPartnerLocationVisible(partnerLocation, Date.now());

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

	const handleToggleConsent = useCallback(
		async (nextValue: boolean) => {
			setIsBusy(true);
			try {
				await setConsent(nextValue);
			} finally {
				setIsBusy(false);
			}
		},
		[setConsent],
	);

	const handleStartLive = useCallback(async () => {
		setIsBusy(true);
		try {
			await startSharing("live");
		} finally {
			setIsBusy(false);
		}
	}, [startSharing]);

	const handleStartUntilArrive = useCallback(async () => {
		const name = destinationName.trim() || "Home";
		let latitude: number;
		let longitude: number;

		if (isStubMode()) {
			latitude = SIMULATED_DESTINATION.latitude;
			longitude = SIMULATED_DESTINATION.longitude;
		} else {
			try {
				const position = await Location.getCurrentPositionAsync({
					accuracy: Location.Accuracy.Balanced,
				});
				latitude = position.coords.latitude;
				longitude = position.coords.longitude;
			} catch {
				// A destination that cannot be placed simply doesn't start.
				return;
			}
		}

		setIsBusy(true);
		try {
			await startSharing("until_arrive", {
				name,
				latitude,
				longitude,
				radiusMeters: ARRIVAL_RADIUS_METERS,
			});
		} finally {
			setIsBusy(false);
		}
	}, [destinationName, startSharing]);

	const handleStop = useCallback(async () => {
		setIsBusy(true);
		try {
			await stopSharing();
		} finally {
			setIsBusy(false);
		}
	}, [stopSharing]);

	const handleAsk = useCallback(async () => {
		await requestPartnerLocation();
	}, [requestPartnerLocation]);

	const handleSeePartner = useCallback(() => {
		router.push("/(app)/partner-map");
	}, [router]);

	return (
		<ScrollView
			contentContainerStyle={contentContainerStyle}
			keyboardShouldPersistTaps="handled"
			showsVerticalScrollIndicator={false}
			style={{ backgroundColor: background }}
		>
			<Stack.Screen options={{ title: "Location" }} />

			{!isLoaded ? (
				<View style={styles.center}>
					<ActivityIndicator color={accent} />
				</View>
			) : (
				<>
					<ThemedText type="caption" style={{ color: muted }}>
						Optional, and off by default. Sharing shows your latest
						position only — never a trail or history, and it stops
						the moment you say so.
					</ThemedText>

					<Surface style={styles.card}>
						<View style={styles.toggleRow}>
							<View style={styles.toggleText}>
								<ThemedText type="body">Share my location</ThemedText>
								<ThemedText type="caption" style={{ color: muted }}>
									Works only when you both opt in. Stop anytime —
									one tap, no questions.
								</ThemedText>
							</View>
							<Switch
								accessibilityLabel="Share my location"
								disabled={isBusy}
								onValueChange={(value) => void handleToggleConsent(value)}
								thumbColor={youConsented ? background : undefined}
								trackColor={{ false: undefined, true: accent }}
								value={youConsented}
							/>
						</View>
						{youConsented ? (
							<ThemedText type="caption" style={{ color: muted }}>
								{partnerConsented
									? `${partnerName} has opted in too.`
									: `Waiting for ${partnerName} to opt in — nothing flows until you both do.`}
							</ThemedText>
						) : null}
					</Surface>

					{youConsented && bothConsented ? (
						<Surface style={styles.card}>
							<ThemedText type="meta" style={styles.cardHeading}>
								{sharingMode ? "Sharing" : "Ways to share"}
							</ThemedText>

							{sharingMode ? (
								<>
									<ThemedText type="caption" style={{ color: muted }}>
										{sharingMode === "live"
											? "Live — while sharing is on."
											: "Until you arrive — then it stops itself."}
									</ThemedText>
									<Button
										disabled={isBusy}
										label="Stop sharing"
										onPress={() => void handleStop()}
										variant="secondary"
									/>
								</>
							) : (
								<>
									<View style={styles.modeBlock}>
										<Button
											disabled={isBusy}
											label="Share live"
											onPress={() => void handleStartLive()}
											variant="secondary"
										/>
										<ThemedText type="caption" style={{ color: muted }}>
											While sharing is on. Live asks once for
											background access — decline it and live
											sharing simply works only while the app is
											open.
										</ThemedText>
									</View>
									<View style={styles.modeBlock}>
										<TextInput
											maxLength={80}
											onChangeText={setDestinationName}
											placeholder="Home"
											placeholderTextColor={muted}
											style={[styles.input, { color: text }]}
											value={destinationName}
										/>
										<Button
											disabled={isBusy}
											label="Until I arrive"
											onPress={() => void handleStartUntilArrive()}
											variant="secondary"
										/>
										<ThemedText type="caption" style={{ color: muted }}>
											Share until you reach this place (set to
											where you are now), then it stops itself.
										</ThemedText>
									</View>
									<ThemedText type="caption" style={{ color: muted }}>
										Or share nothing until asked — your partner
										can request a one-time position below.
									</ThemedText>
								</>
							)}
						</Surface>
					) : null}

					{youConsented && bothConsented ? (
						<Surface style={styles.card}>
							<ThemedText type="meta" style={styles.cardHeading}>
								{partnerName}
							</ThemedText>
							{partnerVisible ? (
								<Button
									label="See where they are"
									onPress={handleSeePartner}
									variant="secondary"
								/>
							) : (
								<View style={styles.modeBlock}>
									<Button
										disabled={isBusy || requestSent}
										label="Ask where they are"
										onPress={() => void handleAsk()}
										variant="secondary"
									/>
									<ThemedText type="caption" style={{ color: muted }}>
										{requestSent
											? "Asked — they'll share only if they want to."
											: "Sends a quiet ask. They share once, or not at all."}
									</ThemedText>
								</View>
							)}
						</Surface>
					) : null}

					{error ? (
						<ThemedText type="caption" style={{ color: muted }}>
							{error}
						</ThemedText>
					) : null}

					{isStubMode() ? (
						<ThemedText type="caption" style={{ color: muted }}>
							Offline mode: your partner&apos;s responses are simulated
							(a fixed place near the station) — nothing is sent
							anywhere.
						</ThemedText>
					) : null}
				</>
			)}
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	contentContainer: {
		gap: Spacing[16],
		paddingHorizontal: Spacing[16],
	},
	center: {
		alignItems: "center",
		justifyContent: "center",
		paddingVertical: Spacing[40],
	},
	card: {
		gap: Spacing[12],
	},
	cardHeading: {
		marginBottom: Spacing[4],
	},
	toggleRow: {
		alignItems: "center",
		flexDirection: "row",
		gap: Spacing[12],
	},
	toggleText: {
		flex: 1,
		gap: Spacing[4],
	},
	modeBlock: {
		gap: Spacing[8],
	},
	input: {
		fontSize: 17,
		lineHeight: 24,
	},
});
