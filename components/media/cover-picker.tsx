import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { PhotoViewer } from '@/components/moments/photo-viewer';
import { ThemedText } from '@/components/themed-text';
import { IconButton } from '@/components/ui/icon-button';
import { ExpoButton } from '@/components/ui/expo-controls';
import { Radii, Spacing } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';

export function CoverPicker({ uri, disabled, onChange }: {
  uri: string | null;
  disabled?: boolean;
  onChange: (uri: string) => void;
}) {
  const window = useWindowDimensions();
  const [width, setWidth] = useState(window.width - Spacing[24] * 2);
  const [viewing, setViewing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const danger = useThemeColor({}, 'danger');
  const ink = useThemeColor({}, 'textPrimary');
  const unavailable = disabled || picking;
  const photos = useMemo(() => uri ? [{ uri, label: 'Cover image' }] : [], [uri]);

  const pick = useCallback(async () => {
    if (unavailable) return;
    setPicking(true);
    setError(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 0.8, exif: false });
      if (!result.canceled && result.assets.length) onChange(result.assets[0].uri);
    } catch {
      setError("Couldn't open your photos. Please try again.");
    } finally {
      setPicking(false);
    }
  }, [unavailable, onChange]);

  return (
    <View style={styles.container} onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}>
      {uri ? (
        <View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View cover image"
            accessibilityHint="Opens the full-screen photo viewer"
            accessibilityState={{ disabled: unavailable }}
            disabled={unavailable}
            onPress={() => setViewing(true)}
          >
            <Image accessible={false} source={{ uri }} contentFit="cover" style={[styles.image, { width }]} />
          </Pressable>
          <View style={styles.replace}>
            <IconButton label="Replace cover image" accessibilityHint="Opens your photo library" disabled={unavailable} onPress={() => void pick()} variant="secondary">
              <Ionicons name="pencil" size={18} color={ink} accessible={false} />
            </IconButton>
          </View>
        </View>
      ) : (
        <View style={styles.add}>
          <ExpoButton label="+" accessibilityLabel="Add cover image" accessibilityHint="Opens your photo library" disabled={unavailable} onPress={() => void pick()} variant="secondary" />
        </View>
      )}
      {error ? <ThemedText accessibilityRole="alert" type="caption" style={{ color: danger }}>{error}</ThemedText> : null}
      {viewing ? <PhotoViewer visible photos={photos} onClose={() => setViewing(false)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing[8] },
  image: { aspectRatio: 1.45, borderRadius: Radii.card },
  add: { alignSelf: 'flex-start' },
  replace: { position: 'absolute', right: Spacing[12], bottom: Spacing[12] },
});
