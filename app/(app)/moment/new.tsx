import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback } from "react";
import { StyleSheet } from "react-native";
import Animated, {
	useAnimatedKeyboard,
	useAnimatedStyle,
} from "react-native-reanimated";

import { InlineMemoryComposer } from "@/components/moments/inline-memory-composer";
import { useThemeColor } from "@/hooks/use-theme-color";

export default function NewMemoryScreen() {
	const router = useRouter();
	const background = useThemeColor({}, "background");
	const isIos = process.env.EXPO_OS === "ios";
	const { compose } = useLocalSearchParams<{ compose?: string | string[] }>();

	const handleIntentConsumed = useCallback(() => {
		router.setParams({ compose: undefined });
	}, [router]);

	// The sheet owns its chrome (Cancel/title/Save live in the composer),
	// so the navigator renders no header — see the static headerShown in
	// (app)/_layout. Keyboard avoidance tracks the reported keyboard
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
			<InlineMemoryComposer intent={compose} onIntentConsumed={handleIntentConsumed} />
		</Animated.View>
	);
}

const styles = StyleSheet.create({
	root: {
		flex: 1,
	},
});
