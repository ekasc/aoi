import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Surface } from '@/components/ui/surface';
import { Spacing } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';

export type MediaSelection = {
  uri: string;
  mimeType: string;
};

export type MediaPickerProps = {
  onMediaSelected: (selection: MediaSelection) => void;
  onClear: () => void;
  selectedUri?: string | null;
  disabled?: boolean;
};

export function MediaPicker({
  onMediaSelected,
  onClear,
  selectedUri,
  disabled,
}: MediaPickerProps) {
  const accent = useThemeColor({}, 'accent');
  const onAccent = useThemeColor({}, 'onAccent');
  const surface2 = useThemeColor({}, 'surface2');
  const border = useThemeColor({}, 'border');
  const muted = useThemeColor({}, 'muted');

  const handlePick = useCallback(async () => {
    if (disabled) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.8,
      exif: false,
    });

    if (!result.canceled && result.assets.length > 0) {
      const asset = result.assets[0];
      onMediaSelected({
        uri: asset.uri,
        mimeType: asset.mimeType ?? (asset.uri.endsWith('.png') ? 'image/png' : 'image/jpeg'),
      });
    }
    // No permission error is possible here and that is the point: the system
    // picker hands back only what the reader chose, so the app never holds
    // standing access to their library. The old pre-request made this screen
    // ask for all of it, and its "permission denied" state was reachable only
    // because of that.
  }, [disabled, onMediaSelected]);

  if (selectedUri) {
    return (
      <Surface style={styles.container}>
        <ThemedText type="meta">Media</ThemedText>
        <View style={styles.previewContainer}>
          <View
            style={[
              styles.preview,
              { borderColor: border, backgroundColor: surface2 },
            ]}
          >
            <Image
              accessibilityLabel="Selected media preview"
              source={{ uri: selectedUri }}
              style={styles.previewImage}
            />
          </View>
          <Pressable
            accessibilityLabel="Remove selected media"
            accessibilityRole="button"
            disabled={disabled}
            onPress={onClear}
            style={({ pressed }) => [
              styles.removeButton,
              {
                borderColor: border,
                backgroundColor: surface2,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <ThemedText type="caption" style={{ color: muted }}>
              Remove
            </ThemedText>
          </Pressable>
        </View>
      </Surface>
    );
  }

  return (
    <Surface style={styles.container}>
      <ThemedText type="meta">Media</ThemedText>
      <Pressable
        accessibilityLabel="Select image from library"
        accessibilityRole="button"
        disabled={disabled}
        onPress={handlePick}
        style={({ pressed }) => [
          styles.pickButton,
          {
            borderColor: accent,
            backgroundColor: accent,
            opacity: pressed ? 0.92 : 1,
          },
        ]}
      >
        <ThemedText type="caption" style={{ color: onAccent, fontWeight: '600' }}>
          Pick from library
        </ThemedText>
      </Pressable>
    </Surface>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing[8],
  },
  previewContainer: {
    gap: Spacing[8],
  },
  preview: {
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  previewImage: {
    width: '100%',
    height: 200,
  },
  pickButton: {
    minHeight: 44,
    borderRadius: 999,
    paddingHorizontal: Spacing[16],
    justifyContent: 'center',
    alignItems: 'center',
  },
  removeButton: {
    minHeight: 44,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing[16],
    justifyContent: 'center',
    alignItems: 'center',
  },
});
