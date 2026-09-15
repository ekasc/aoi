import frostTexture from '@/assets/images/frosted-backdrop.png';
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { useThemeColor } from '@/hooks/use-theme-color';

export function FrostedBackdrop() {
  const accent = useThemeColor({}, 'accent');
  return (
    <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.backdrop}>
      <Image accessibilityElementsHidden accessible={false} aria-hidden source={frostTexture} tintColor={accent} contentFit="cover" style={StyleSheet.absoluteFill} />
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, height: 440 },
});
