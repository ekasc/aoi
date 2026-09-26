import {
	useLocalSearchParams,
	useNavigation,
	useRouter,
	type NativeStackNavigationProp,
} from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import Animated, {
	useAnimatedKeyboard,
	useAnimatedStyle,
} from "react-native-reanimated";

import { InlineMemoryComposer } from "@/components/moments/inline-memory-composer";
import { useThemeColor } from "@/hooks/use-theme-color";

export default function NewMemoryScreen() {
	const router = useRouter();
	const navigation = useNavigation<NativeStackNavigationProp<Record<string, object | undefined>>>();
	const background = useThemeColor({}, "background");
	const isIos = process.env.EXPO_OS === "ios";
	const { compose } = useLocalSearchParams<{ compose?: string | string[] }>();
	const [presentationReady, setPresentationReady] = useState(process.env.EXPO_OS !== "ios");

	useEffect(() => {
		if (process.env.EXPO_OS !== "ios") return;
		const unsubscribe = navigation.addListener("transitionEnd", (event) => {
			if (event.data.closing) return;
			setPresentationReady(true);
		});
		return unsubscribe;
	}, [navigation]);

	const handleIntentConsumed = useCallback(() => {
		router.setParams({ compose: undefined });
	}, [router]);

	// The composer owns the editor body; iOS native sheet chrome supplies its
	// title and Cancel/Save actions, while Android/web keep the custom bar.
	// Keyboard avoidance tracks the reported keyboard
	// height directly: KeyboardAvoidingView derives its offset from layout
	// measurements that go stale during the sheet's detent animation
	// (controls end up under the keyboard and stick there), while the
	// animated height stays correct. Android resizes its window instead,
	// so the padding applies iOS-only.
	const keyboard = useAnimatedKeyboard();
	const keyboardStyle = useAnimatedStyle(() => ({
		paddingBottom: isIos ? keyboard.height.value : 0,
	}));

	return (
		<Animated.View
			style={[styles.root, { backgroundColor: background }, keyboardStyle]}
		>
			<InlineMemoryComposer
				intent={compose}
				onIntentConsumed={handleIntentConsumed}
				presentationReady={presentationReady}
			/>
		</Animated.View>
	);
}

const styles = StyleSheet.create({
	root: {
		flex: 1,
	},
});
