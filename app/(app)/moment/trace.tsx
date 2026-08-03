import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';

import { AudioPlayer } from '@/components/media/audio-player';
import { VoiceRecorder } from '@/components/media/voice-recorder';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { FontFamilies } from '@/constants/typography';
import { Spacing } from '@/constants/theme';
import { isStubMode } from '@/features/api-client';
import { useMediaUpload } from '@/features/media/use-media-upload';
import { useMoments } from '@/features/moments/moments-context';
import { useThemeColor } from '@/hooks/use-theme-color';

/**
 * Trace: the 5-second capture. No type picker, no title field, no
 * decisions — just whatever crossed your mind about them, kept.
 */
export default function TraceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isIos = process.env.EXPO_OS === 'ios';
  const { addMoment } = useMoments();
  const { uploadImage } = useMediaUpload();
  const accent = useThemeColor({}, 'accent');
  const border = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const background = useThemeColor({}, 'background');

  const [body, setBody] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [voiceUri, setVoiceUri] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const trimmedBody = body.trim();
  const hasContent = trimmedBody.length > 0 || Boolean(photoUri) || Boolean(voiceUri);

  const handlePickPhoto = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.8,
        exif: false,
      });

      if (!result.canceled && result.assets.length > 0) {
        setPhotoUri(result.assets[0].uri);
      }
    } catch {
      setError('Could not open the photo library.');
    }
  }, []);

  const uploadAsset = useCallback(
    async (uri: string, mimeType: string): Promise<string> => {
      if (isStubMode()) {
        return uri;
      }

      const uploadedUrl = await uploadImage({ uri, mimeType });

      if (!uploadedUrl) {
        throw new Error('Upload failed');
      }

      return uploadedUrl;
    },
    [uploadImage]
  );

  const handleSave = useCallback(async () => {
    if (!hasContent || isSaving) {
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      const mediaPreview = photoUri ? await uploadAsset(photoUri, 'image/jpeg') : undefined;
      const audioUri = voiceUri ? await uploadAsset(voiceUri, 'audio/m4a') : undefined;

      await addMoment({
        type: 'trace',
        title: '',
        body: trimmedBody,
        occurredAt: new Date().toISOString(),
        mediaPreview,
        audioUri: audioUri ?? null,
      });

      router.back();
    } catch {
      setError('Could not keep this trace. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [addMoment, hasContent, isSaving, photoUri, router, trimmedBody, uploadAsset, voiceUri]);

  const footerStyle = useMemo(
    () => [styles.footer, { paddingBottom: insets.bottom + Spacing[12] }],
    [insets.bottom]
  );

  return (
    <KeyboardAvoidingView
      behavior={isIos ? 'padding' : undefined}
      style={[styles.root, { backgroundColor: background }]}
    >
      <Stack.Screen options={{ title: 'Keep this' }} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: Spacing[16] }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <TextInput
          autoFocus
          multiline
          onChangeText={setBody}
          placeholder="What just crossed your mind about them?"
          placeholderTextColor={muted}
          style={[styles.input, { color: text }]}
          value={body}
        />

        {photoUri ? (
          <View style={[styles.photoRow, { borderColor: border }]}>
            <Image
              contentFit="cover"
              source={{ uri: photoUri }}
              style={styles.photoThumb}
            />
            <Pressable
              accessibilityLabel="Remove photo"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => setPhotoUri(null)}
            >
              <Ionicons color={muted} name="close-circle" size={22} />
            </Pressable>
          </View>
        ) : null}

        {voiceUri ? (
          <View style={styles.voiceRow}>
            <AudioPlayer uri={voiceUri} />
            <Pressable
              accessibilityLabel="Remove voice note"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => setVoiceUri(null)}
            >
              <Ionicons color={muted} name="close-circle" size={22} />
            </Pressable>
          </View>
        ) : (
          <VoiceRecorder disabled={isSaving} onRecorded={setVoiceUri} />
        )}

        {error ? (
          <ThemedText type="caption" style={{ color: accent, marginTop: Spacing[12] }}>
            {error}
          </ThemedText>
        ) : null}
      </ScrollView>

      <View style={[footerStyle, { backgroundColor: surface }]}>
        <Pressable
          accessibilityLabel="Attach a photo"
          accessibilityRole="button"
          disabled={isSaving || Boolean(photoUri)}
          onPress={() => void handlePickPhoto()}
          style={[styles.attachButton, { borderColor: border }, Boolean(photoUri) && styles.disabled]}
        >
          <Ionicons color={muted} name="camera-outline" size={20} />
        </Pressable>
        <View style={styles.saveButton}>
          <Button
            disabled={!hasContent || isSaving}
            label={isSaving ? 'Keeping it…' : 'Keep it'}
            onPress={() => void handleSave()}
          />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    gap: Spacing[16],
    paddingBottom: Spacing[16],
    paddingHorizontal: Spacing[16],
  },
  input: {
    fontFamily: FontFamilies.display,
    fontSize: 22,
    lineHeight: 32,
    minHeight: 120,
    paddingTop: Spacing[8],
    textAlignVertical: 'top',
  },
  photoRow: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: Spacing[12],
    padding: Spacing[8],
  },
  photoThumb: {
    borderRadius: 8,
    height: 64,
    width: 64,
  },
  voiceRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing[12],
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[12],
    paddingHorizontal: Spacing[16],
    paddingTop: Spacing[12],
  },
  attachButton: {
    alignItems: 'center',
    borderRadius: 22,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  disabled: {
    opacity: 0.4,
  },
  saveButton: {
    flex: 1,
  },
});
