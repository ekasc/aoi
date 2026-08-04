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

import {
	DestinationPicker,
	type DestinationCoordinate,
} from "@/components/location/destination-picker";
import { ThemedText } from "@/components/themed-text";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { Spacing } from "@/constants/theme";
import { isStubMode } from "@/features/api-client";
import { useLocation } from "@/features/location/location-context";
import { isPartnerLocationVisible } from "@/features/location/location-state";
import { useSpace } from "@/features/space/space-context";
import { useThemeColor } from "@/hooks/use-theme-color";

// Stub mode: a fixed, plainly-simulated destination so "Until I arrive"
// can be tried offline. Remote mode: only ever the fallback seed for the
// destination map when the current position cannot be found — the pin the
// user drops is what counts.
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
	const [isChoosingDestination, setIsChoosingDestination] = useState(false);
	const [pickerSeed, setPickerSeed] = useState<DestinationCoordinate | null>(
		null,
	);

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

		if (isStubMode()) {
			// Offline trial: a fixed simulated destination, plainly labeled.
			setIsBusy(true);
			try {
				await startSharing("until_arrive", {
					name,
					latitude: SIMULATED_DESTINATION.latitude,
					longitude: SIMULATED_DESTINATION.longitude,
					radiusMeters: ARRIVAL_RADIUS_METERS,
				});
			} finally {
				setIsBusy(false);
			}
			return;
		}

		// Remote: the destination is where they are HEADED, so they pick it on
		// a map. Seed the map near where they are now (fall back to the
		// simulated point only as a map center if positioning fails).
		let seed: DestinationCoordinate;
		try {
			const position = await Location.getCurrentPositionAsync({
				accuracy: Location.Accuracy.Balanced,
			});
			seed = {
				latitude: position.coords.latitude,
				longitude: position.coords.longitude,
			};
		} catch {
			seed = SIMULATED_DESTINATION;
		}

		setPickerSeed(seed);
		setIsChoosingDestination(true);
	}, [destinationName, startSharing]);

	const handleDestinationConfirm = useCallback(
		async (coordinate: DestinationCoordinate) => {
			setIsChoosingDestination(false);
			setIsBusy(true);
			try {
				await startSharing("until_arrive", {
					name: destinationName.trim() || "Home",
					latitude: coordinate.latitude,
					longitude: coordinate.longitude,
					radiusMeters: ARRIVAL_RADIUS_METERS,
				});
			} finally {
				setIsBusy(false);
			}
		},
		[destinationName, startSharing],
	);

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
		<>
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
											Share until you reach the place you pick —
											then it stops itself.
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

		{isChoosingDestination && pickerSeed ? (
			<DestinationPicker
				initialCoordinate={pickerSeed}
				name={destinationName.trim() || "Home"}
				onCancel={() => setIsChoosingDestination(false)}
				onConfirm={(coordinate) => void handleDestinationConfirm(coordinate)}
			/>
		) : null}
		</>
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
